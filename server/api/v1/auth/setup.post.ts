import { z } from 'zod';
import {useServerInvites} from "#server/utils/core/useServerInvites";
import {usernameSchema} from "#shared/utils/schemas";

const bodySchema = z.object({
	username: usernameSchema,
})

export default defineEventHandler(async event => {
	const { username } = await readValidatedBody(event, bodySchema.parse)
	return await useServerInvites().setupHandler(event, username)
})
