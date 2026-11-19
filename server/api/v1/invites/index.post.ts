import { z } from 'zod';
import {useServerInvites} from "#server/utils/core/useServerInvites";

const bodySchema = z.object({
	userId: z.string().optional(),
	maxUses: z.number().int().positive().optional(),
	expiresAt: z.coerce.date().optional(),
})

export default defineEventHandler(async event => {
	const body = await readValidatedBody(event, bodySchema.parse)
	return await useServerInvites().createInviteHandler(event, body)
})
