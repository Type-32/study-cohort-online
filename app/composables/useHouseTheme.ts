import { BUILT_IN_THEMES } from "#shared/themes";
import type { ThemeInfo } from "#shared/utils/theme";

/**
 * The house's theme pack. Built-in packs are in the bundle, so the first render (server included)
 * already has the layout; an uploaded one is fetched once the socket says which it is.
 */
export function useHouseTheme() {
	const { house, loaded } = storeToRefs(useHouseStore());
	const theme = computed(() => house.value.theme);
	const builtIn = computed<ThemeInfo | undefined>(() => {
		const pack = BUILT_IN_THEMES[theme.value.id];
		return pack && { pack, assetBase: `/themes/${pack.id}/`, builtIn: true };
	});
	const { data: uploaded } = useQuery({
		key: () => ["theme", theme.value.id, theme.value.version],
		query: () => $fetch<ThemeInfo>(`/api/v1/themes/${encodeURIComponent(theme.value.id)}` as string),
		enabled: () => loaded.value && !builtIn.value,
		staleTime: Infinity,
	});
	const info = computed(() => builtIn.value ?? uploaded.value);
	/** An image of the pack; uploaded packs' URLs carry the version, so a replaced pack isn't read from cache. */
	const asset = (file: string) => `${info.value?.assetBase ?? ""}${file}${theme.value.version ? `?v=${theme.value.version}` : ""}`;
	return { info, asset };
}
