import { z } from 'zod'

/**
 * A theme pack: the room's look (step 12). A `theme.json` plus the images it names, all in one
 * folder (or at the root of the uploaded .zip). Every position and size is in the pack's design
 * units (`size`); the scene scales them to fit the window. Format notes: plans/online-gathering-v1.md, step 12.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #2b2433')
/** An image beside `theme.json`: a plain file name, no folders. */
const file = z.string().regex(/^[\w-]+\.(svg|png|webp|jpe?g)$/i, 'an image file name like door.svg (svg, png, webp or jpg)')
const rect = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })
export const slotIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/, 'a seat id like sofa-left')
export const themeIdSchema = z.string().regex(/^[a-z0-9-]{2,40}$/, 'an id like living-room')

/** The radio cabinet's colours (step 9's `--radio-*` variables); any left out keep the app's defaults. */
const radioSkin = z.object({ body: hex, trim: hex, key: hex, lcdBg: hex, lcdFg: hex, grille: hex, needle: hex }).partial()

export const themePackSchema = z.object({
	format: z.literal(1),
	id: themeIdSchema,
	name: z.string().trim().min(1).max(60),
	/** The design size. The scene keeps this shape and fits the window, `background` filling the rest. */
	size: z.object({ width: z.number().int().min(640).max(4096), height: z.number().int().min(360).max(4096) }),
	background: hex,
	/** Drawn first, at 0,0 and the full design size. */
	backdrop: file,
	/** Furniture and decoration, drawn over the backdrop in order of `z` (then as listed). */
	objects: z.array(rect.extend({ id: z.string().min(1).max(40), src: file, z: z.number().int().optional() })).max(100).default([]),
	/** Where members whose door is open sit: the centre of their avatar. Members pick one. */
	seats: z.array(z.object({ id: slotIdSchema, x: z.number(), y: z.number() })).min(1).max(60),
	/** Avatars: a circle with an initial, `size` across. */
	avatar: z.object({ size: z.number().min(16).max(200), color: hex }),
	/** The row of members' nook doors along a wall: one door per member present, sized to fit. */
	nooks: rect.extend({ door: file, light: hex, label: hex }),
	radio: z.object({
		/** Where the radio cabinet stands. It's real page content, at least 420 units wide. */
		slot: rect.refine((r) => r.width >= 420, 'the radio slot needs at least 420 units of width'),
		skin: z.object({ light: radioSkin.optional(), dark: radioSkin.optional(), radius: z.number().min(0).max(48).optional() }).optional(),
	}),
	/** Where the timer and the door controls float: top-left corner and width (at least 320). */
	panel: z.object({ x: z.number(), y: z.number(), width: z.number().min(320) }),
}).superRefine((pack, ctx) => {
	const ids = pack.seats.map((s) => s.id)
	if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['seats'], message: 'seat ids must be unique' })
})

export type ThemePack = z.infer<typeof themePackSchema>
export type RadioSkin = z.infer<typeof radioSkin>

/** Every image a pack names, once. */
export const themeFiles = (pack: ThemePack) => [...new Set([pack.backdrop, pack.nooks.door, ...pack.objects.map((o) => o.src)])]

/** The theme a new house starts with, shipped with the app. */
export const DEFAULT_THEME = 'living-room'

/** A theme as clients get it: the pack, and the URL its images are under. */
export interface ThemeInfo {
	pack: ThemePack
	/** Ends in a slash: `${assetBase}door.svg`. */
	assetBase: string
	builtIn: boolean
}

/**
 * Who sits where in the commons: members whose door is open, in their chosen seat when it's in this
 * room and nobody earlier in the list took it, otherwise in the next free seat in the pack's order.
 * Anyone left over (more members than seats) stands in their nook's doorway. Pure: the scene and the
 * tests share it.
 */
export function seatMembers<M extends { userId: string; door: string; slot: string | null }>(seats: { id: string }[], members: M[]) {
	const open = members.filter((m) => m.door === 'open')
	const seated = new Map<string, M>()
	const ids = new Set(seats.map((s) => s.id))
	const waiting: M[] = []
	for (const m of open) {
		if (m.slot && ids.has(m.slot) && !seated.has(m.slot)) seated.set(m.slot, m)
		else waiting.push(m)
	}
	const free = seats.filter((s) => !seated.has(s.id))
	for (const m of waiting.splice(0, free.length)) seated.set(free.shift()!.id, m)
	return { seated, standing: waiting }
}
