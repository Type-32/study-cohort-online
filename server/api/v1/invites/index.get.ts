import {useServerInvites} from "#server/utils/core/useServerInvites";

export default defineEventHandler(async event => {
	return await useServerInvites().listInvitesHandler(event)
})
