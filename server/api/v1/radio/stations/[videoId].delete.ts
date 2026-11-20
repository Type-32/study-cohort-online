import { z } from "zod"
import { useServerAuth } from "#server/utils/core/useServerAuth"
import { HouseError, managesRadio, removeStation } from "#server/utils/radioQueue"
import { youtubeIdSchema } from "#shared/utils/radio"
import { satisfies } from "#shared/utils/roles"

const routeParamsSchema = z.object({ videoId: youtubeIdSchema })

export default defineEventHandler(async event => {
	const member = await useServerAuth().getUser(event)
	if (!member || !satisfies(member)) throw createError({ statusCode: 401, statusMessage: "Sign in first." })
	if (!managesRadio(member)) throw createError({ statusCode: 403, statusMessage: "Only the host and moderators can remove stations." })
	const { videoId } = await getValidatedRouterParams(event, routeParamsSchema.parse)
	try {
		await removeStation(videoId)
	} catch (error) {
		if (error instanceof HouseError) throw createError({ statusCode: 409, statusMessage: error.message })
		throw error
	}
	return null
})
