import { useServerAuth } from "#server/utils/core/useServerAuth"
import { listThemes } from "#server/utils/themes"
import { satisfies } from "#shared/utils/roles"

export default defineEventHandler(async event => {
	const member = await useServerAuth().getUser(event)
	if (!member || !satisfies(member)) throw createError({ statusCode: 401, statusMessage: "Sign in first." })
	return listThemes()
})
