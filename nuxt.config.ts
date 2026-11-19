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
		'vue3-pixi-nuxt'
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

	routeRules: {
		'/': {prerender: true}
	},

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

	image: {
		domains: [],
		provider: 'none', // or configure ipx with a custom fetchAdapter
	},

	runtimeConfig: {
		oauth: {
			github: {
				clientId: '',
				clientSecret: ''
			}
		},
		public: {
			siteName: '',
			siteUrl: '',
		},
	},

	compatibilityDate: '2026-06-05',
})
