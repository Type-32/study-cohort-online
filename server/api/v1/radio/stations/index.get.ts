import { useServerAuth } from "#server/utils/core/useServerAuth"
import { listStations } from "#server/utils/radioQueue"
import { satisfies } from "#shared/utils/roles"

// Over HTTP rather than the socket: it can be hundreds of rows and changes only when a new track
// goes on air (clients refetch when the radio names a station they don't know).
export default defineEventHandler(async event => {
	const member = await useServerAuth().getUser(event)
	if (!member || !satisfies(member)) throw createError({ statusCode: 401, statusMessage: "Sign in to see the stations." })
	return listStations()
})
