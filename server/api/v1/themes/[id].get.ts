import { z } from "zod"
import { useServerAuth } from "#server/utils/core/useServerAuth"
import { resolveTheme } from "#server/utils/themes"
import { themeIdSchema } from "#shared/utils/theme"
import { satisfies } from "#shared/utils/roles"

const routeParamsSchema = z.object({ id: themeIdSchema })

/** A theme's pack and where its images are. */
export default defineEventHandler(async event => {
	const member = await useServerAuth().getUser(event)
	if (!member || !satisfies(member)) throw createError({ statusCode: 401, statusMessage: "Sign in first." })
	const { id } = await getValidatedRouterParams(event, routeParamsSchema.parse)
	const theme = await resolveTheme(id)
	if (!theme) throw createError({ statusCode: 404, statusMessage: "There's no such theme." })
	return theme
})
