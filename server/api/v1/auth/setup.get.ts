import {useServerInvites} from "#server/utils/core/useServerInvites";

export default defineEventHandler(async () => {
	return { needed: await useServerInvites().isSetupNeeded() }
})
