import { z } from "zod"
import { blob } from "hub:blob"
import { useServerAuth } from "#server/utils/core/useServerAuth"
import { themeIdSchema } from "#shared/utils/theme"
import { satisfies } from "#shared/utils/roles"

const routeParamsSchema = z.object({ id: themeIdSchema, file: z.string().regex(/^[\w-]+\.(svg|png|webp|jpe?g)$/i) })

/**
 * An uploaded pack's image, from blob storage. Sandboxed: an SVG opened on its own, rather than
 * drawn by the scene, can't run anything in the house's origin. URLs carry the pack's version, so
 * they're cached for good.
 */
export default defineEventHandler(async event => {
	const member = await useServerAuth().getUser(event)
	if (!member || !satisfies(member)) throw createError({ statusCode: 401, statusMessage: "Sign in first." })
	const { id, file } = await getValidatedRouterParams(event, routeParamsSchema.parse)
	setResponseHeaders(event, {
		"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "private, max-age=31536000, immutable",
	})
	return blob.serve(event, `themes/${id}/${file}`)
})
