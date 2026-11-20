// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
	modules: [
		'@nuxt/ui',
		'@type32/nuxt-ui-extras',
		'@nuxt/image',
		'@nuxtjs/i18n',
		'nuxt-auth-utils',
		'nuxt-authorization',
		'@type32/nuxt-cs-utils',
		'@nuxthub/core',
		'@vueuse/nuxt',
		'nuxt-security',
		'motion-v/nuxt',
		'vue3-pixi-nuxt',
		'@pinia/colada-nuxt',
		'@pinia/nuxt'
	],

	devtools: {
		enabled: true
	},

	vite: {
		optimizeDeps: {
			include: [
				'zod',
				'@internationalized/date',
			]
		},
	},

	nitro: {
		experimental: {
			websocket: true,
		},
	},

	hooks: {
		// nitropack 2's Vercel runtime has no WebSocket upgrade; this entry adds it.
		// Set here, not in `nitro.entry`, so the prerenderer keeps its own entry.
		'nitro:init'(nitro) {
			if (nitro.options.preset === 'vercel') {
				nitro.options.entry = fileURLToPath(new URL('./server/vercel-entry.ts', import.meta.url))
			}
		},
	},

	hub: {
		db: {
			dialect: 'postgresql',
			applyMigrationsDuringBuild: false,
			applyMigrationsDuringDev: false,
		},
		blob: true,
	},

	css: ['~/assets/css/main.css'],

	security: {
		headers: {
			contentSecurityPolicy: {
				'img-src': ["'self'", 'data:', 'https:', 'blob:'],
			},
			crossOriginEmbedderPolicy: false, // TODO: Find a better solution than disabling this security measure.
		},
		rateLimiter: {
			interval: 100000,
		}
	},

	icon: {
		// Ship every icon the source uses in the client bundle; otherwise each one is fetched
		// from the server on first render and pops in late (menus, toasts, badges).
		clientBundle: { scan: true },
	},

	image: {
		domains: [],
		provider: 'none', // or configure ipx with a custom fetchAdapter
	},

	runtimeConfig: {
		session: {
			// The cookie is the identity for invite accounts; losing it needs a re-entry link.
			maxAge: 60 * 60 * 24 * 365,
		},
		public: {
			siteName: '',
			siteUrl: '',
		},
	},

	compatibilityDate: '2026-06-05',
})
