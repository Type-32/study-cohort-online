// Step 0 spike only: delete once the checks in plans/online-gathering-v1.md pass.
import { publish } from '#server/utils/bus'

export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const msg = { t: 'spike', sentAt: Date.now() }
	await publish(msg)
	return msg
})
