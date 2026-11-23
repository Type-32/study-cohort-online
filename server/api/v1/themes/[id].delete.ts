import { z } from "zod"
import { useServerAuth } from "#server/utils/core/useServerAuth"
import { HouseError } from "#server/utils/radioQueue"
import { deleteTheme } from "#server/utils/themes"
import { themeIdSchema } from "#shared/utils/theme"

const routeParamsSchema = z.object({ id: themeIdSchema })

export default defineEventHandler(async event => {
	await useServerAuth().requireUser(event, { minRole: "admin" })
	const { id } = await getValidatedRouterParams(event, routeParamsSchema.parse)
	try {
		await deleteTheme(id)
	} catch (error) {
		if (error instanceof HouseError) throw createError({ statusCode: 409, statusMessage: error.message })
		throw error
	}
	return null
})
