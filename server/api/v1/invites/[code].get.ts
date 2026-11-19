import { z } from 'zod';
import {useServerInvites} from "#server/utils/core/useServerInvites";

const routeParamsSchema = z.object({
	code: z.string()
})

export default defineEventHandler(async event => {
	const { code } = await getValidatedRouterParams(event, routeParamsSchema.parse)
	return await useServerInvites().getInviteInfo(code)
})
