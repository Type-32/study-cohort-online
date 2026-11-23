import { themePackSchema } from '../utils/theme'
import type { ThemePack } from '../utils/theme'
import livingRoom from './living-room.json'

/** Packs shipped with the app; their images are in `public/themes/<id>/`. Parsed here, so a broken one fails at once. */
export const BUILT_IN_THEMES: Record<string, ThemePack> = Object.fromEntries(
	[livingRoom].map((json) => {
		const pack = themePackSchema.parse(json)
		return [pack.id, pack]
	}),
)
