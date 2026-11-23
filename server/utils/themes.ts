import { db, schema } from '@nuxthub/db'
import { blob } from 'hub:blob'
import { eq } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import { publish } from '#server/utils/bus'
import { HouseError } from '#server/utils/radioQueue'
import { BUILT_IN_THEMES } from '#shared/themes'
import { themeFiles, themePackSchema } from '#shared/utils/theme'
import type { ThemeInfo, ThemePack } from '#shared/utils/theme'
import type { HouseTheme } from '#shared/utils/realtime'
import type { User } from '#shared/types/db'

// Theme packs (plans/online-gathering-v1.md, step 12). Built-in packs ship with the app (JSON in
// `shared/themes/`, images in `public/themes/<id>/`). Uploaded packs: the JSON in `theme_pack`,
// the images in blob storage (MEGA S4 in production) under `themes/<id>/`.

const { themePack, houseState, memberState } = schema

/** A .zip upload: Vercel refuses request bodies over 4.5 MB, so packs stay under 4 MB. */
export const THEME_ZIP_LIMIT = 4 * 1024 * 1024
const CONTENT_TYPES: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
const contentType = (file: string) => CONTENT_TYPES[file.split('.').pop()!.toLowerCase()]!

/** A theme's pack and where its images are, or undefined if there's no such theme. */
export async function resolveTheme(id: string): Promise<ThemeInfo | undefined> {
	const builtIn = BUILT_IN_THEMES[id]
	if (builtIn) return { pack: builtIn, assetBase: `/themes/${id}/`, builtIn: true }
	const row = await db.query.themePack.findFirst({ where: eq(themePack.id, id) })
	return row && { pack: row.pack, assetBase: `/api/v1/themes/${id}/files/`, builtIn: false }
}

/** The house's theme as the snapshot carries it: its id, and a version that changes when it's re-uploaded. */
export async function houseTheme(id: string): Promise<HouseTheme> {
	if (BUILT_IN_THEMES[id]) return { id, version: 0 }
	const row = await db.query.themePack.findFirst({ columns: { uploadedAt: true }, where: eq(themePack.id, id) })
	return { id, version: row?.uploadedAt.getTime() ?? 0 }
}

export async function listThemes() {
	const uploaded = await db.select({ id: themePack.id, pack: themePack.pack, uploadedAt: themePack.uploadedAt }).from(themePack)
	return [
		...Object.values(BUILT_IN_THEMES).map((pack) => ({ id: pack.id, name: pack.name, builtIn: true, uploadedAtMs: null })),
		...uploaded.map((row) => ({ id: row.id, name: row.pack.name, builtIn: false, uploadedAtMs: row.uploadedAt.getTime() })),
	]
}

/** Puts the house in another theme. Seats belong to a theme, so everyone stands up. */
export async function setTheme(member: User, id: string, intent?: string) {
	if (member.role !== 'admin') throw new HouseError('Only the host can change the theme.')
	if (!(await resolveTheme(id))) throw new HouseError("That theme isn't in the house any more.")
	const theme = await houseTheme(id)
	await db.transaction(async (tx) => {
		await tx.insert(houseState).values({ id: 1, theme: id }).onConflictDoUpdate({ target: houseState.id, set: { theme: id } })
		await tx.update(memberState).set({ slot: null })
		await publish({ t: 'theme', theme, intent }, { tx })
	})
}

/** The pack in a .zip: `theme.json` and its images, at the root or in one folder. Refuses in words. */
export function readThemeZip(bytes: Uint8Array): { pack: ThemePack; files: Map<string, Uint8Array> } {
	if (bytes.byteLength > THEME_ZIP_LIMIT) throw new HouseError('That .zip is over 4 MB. Shrink the images (SVG is smallest) and try again.')
	let entries: Record<string, Uint8Array>
	try {
		entries = unzipSync(bytes)
	} catch {
		throw new HouseError("That file isn't a .zip the house can open.")
	}
	const jsonPath = Object.keys(entries).filter((path) => !path.startsWith('__MACOSX/') && /(^|\/)theme\.json$/.test(path)).sort((a, b) => a.length - b.length)[0]
	if (!jsonPath) throw new HouseError('The .zip has no theme.json.')
	const folder = jsonPath.slice(0, -'theme.json'.length)
	let json: unknown
	try {
		json = JSON.parse(new TextDecoder().decode(entries[jsonPath]))
	} catch {
		throw new HouseError("theme.json isn't valid JSON.")
	}
	const parsed = themePackSchema.safeParse(json)
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!
		throw new HouseError(`theme.json: ${issue.path.join('.') || 'the file'}: ${issue.message}`)
	}
	const pack = parsed.data
	if (BUILT_IN_THEMES[pack.id]) throw new HouseError(`"${pack.id}" is a theme that ships with the app. Give yours another id.`)
	const files = new Map<string, Uint8Array>()
	for (const name of themeFiles(pack)) {
		const data = entries[folder + name]
		if (!data) throw new HouseError(`theme.json names ${name}, but the .zip has no ${name} next to it.`)
		// Images are drawn, never opened as pages, and are served sandboxed; a script in one is still a mistake.
		if (name.toLowerCase().endsWith('.svg') && /<script|<foreignObject|\son\w+\s*=/i.test(new TextDecoder().decode(data)))
			throw new HouseError(`${name} contains a script or event handler. Theme images can't run code.`)
		files.set(name, data)
	}
	return { pack, files }
}

/** Stores an uploaded pack: its images under `themes/<id>/` (stale ones removed), its JSON in `theme_pack`. */
export async function saveTheme(member: User, pack: ThemePack, files: Map<string, Uint8Array>) {
	const prefix = `themes/${pack.id}/`
	for (const [name, data] of files) await blob.put(prefix + name, data, { contentType: contentType(name) })
	const { blobs } = await blob.list({ prefix, limit: 1000 })
	const stale = blobs.map((b) => b.pathname).filter((path) => !files.has(path.slice(prefix.length)))
	if (stale.length) await blob.del(stale)
	const [row] = await db.insert(themePack)
		.values({ id: pack.id, pack, uploadedBy: member.id, uploadedAt: new Date() })
		.onConflictDoUpdate({ target: themePack.id, set: { pack, uploadedBy: member.id, uploadedAt: new Date() } })
		.returning({ uploadedAt: themePack.uploadedAt })
	// The house's own theme was replaced: everyone loads the new one, and seats that are gone empty.
	const current = await db.query.houseState.findFirst({ columns: { theme: true } })
	if (current?.theme === pack.id) {
		const seats = new Set(pack.seats.map((s) => s.id))
		await db.transaction(async (tx) => {
			const seated = await tx.select({ userId: memberState.userId, slot: memberState.slot }).from(memberState)
			for (const m of seated) if (m.slot && !seats.has(m.slot)) await tx.update(memberState).set({ slot: null }).where(eq(memberState.userId, m.userId))
			await publish({ t: 'theme', theme: { id: pack.id, version: row!.uploadedAt.getTime() }, keepSeats: true }, { tx })
		})
	}
}

/** Removes an uploaded pack and its images. The house's own theme can't be removed. */
export async function deleteTheme(id: string) {
	if (BUILT_IN_THEMES[id]) throw new HouseError('Themes that ship with the app stay.')
	const current = await db.query.houseState.findFirst({ columns: { theme: true } })
	if ((current?.theme ?? 'living-room') === id) throw new HouseError("That's the house's theme. Pick another one first, then remove it.")
	const { blobs } = await blob.list({ prefix: `themes/${id}/`, limit: 1000 })
	if (blobs.length) await blob.del(blobs.map((b) => b.pathname))
	await db.delete(themePack).where(eq(themePack.id, id))
}
