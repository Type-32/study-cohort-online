import { z } from 'zod';
import {useServerInvites} from "#server/utils/core/useServerInvites";
import {usernameSchema} from "#shared/utils/schemas";

const bodySchema = z.object({
	code: z.string().min(1),
	username: usernameSchema.optional(),
})

export default defineEventHandler(async event => {
	const { code, username } = await readValidatedBody(event, bodySchema.parse)
	return await useServerInvites().joinHandler(event, code, username)
})
