import { useServerAuth } from "#server/utils/core/useServerAuth"
import { HouseError } from "#server/utils/radioQueue"
import { readThemeZip, saveTheme } from "#server/utils/themes"

/** Uploads a theme pack: a .zip of `theme.json` and its images, as the form field `pack`. Host only. */
export default defineEventHandler(async event => {
	const member = await useServerAuth().requireUser(event, { minRole: "admin" })
	const upload = (await readMultipartFormData(event))?.find((part) => part.name === "pack" && part.filename)
	if (!upload) throw createError({ statusCode: 400, statusMessage: "Choose a .zip with the theme in it." })
	try {
		const { pack, files } = readThemeZip(upload.data)
		await saveTheme(member, pack, files)
		return { id: pack.id, name: pack.name }
	} catch (error) {
		if (error instanceof HouseError) throw createError({ statusCode: 422, statusMessage: error.message })
		throw error
	}
})
