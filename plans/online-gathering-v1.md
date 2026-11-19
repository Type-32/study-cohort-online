# Online Gathering v1: implementation plan

Nov 18, 2026. Companion to `Online Gathering design and architecture handoff.md`. The handoff holds the product design; this file holds the build decisions and replaces the handoff's "Architecture" section wherever the two disagree.

Target: the handoff's first prototype, one house played with friends for two weeks.

## Decisions

| Topic | Decision | Replaces in the handoff |
| --- | --- | --- |
| Database | PostgreSQL through NuxtHub (`postgres-js` driver), direct (non-pooled) `DATABASE_URL` | SQLite |
| Assets | MEGA S4 through NuxtHub's `s3` blob driver | S3 (unchanged), Vercel Blob in the repo |
| Hosting | Vercel Functions with Fluid compute | One long-lived Node process in Docker |
| Realtime | Nitro v2 WebSockets (`nitro.experimental.websocket`), bridged to Vercel by a custom entry | Same handler, different host |
| Live state | Stored in Postgres, fanned out with `LISTEN/NOTIFY` | In memory |
| Sign-in | Invite link, then a display name, then a long-lived sealed cookie. Logto stays as an optional second path | Invite codes only |
| First admin | The first account created becomes `admin` | Not specified |
| Nuxt | Stay on 4.6.4 stable. Move to Nitro v3 when Nuxt 4.7 is released | Not specified |

## Why the architecture changed

Vercel pins each WebSocket to one function instance, does not guarantee that a reconnect reaches the same instance, and keeps old and new deployments alive side by side. Connections close when the function reaches its maximum duration: 300s on Hobby, up to 800s on Pro. Vercel's docs say to keep presence and room state in an external store. Sources: [WebSockets](https://vercel.com/docs/functions/websockets), [limits](https://vercel.com/docs/functions/limitations).

So the handoff's rule "the server never ticks and never streams" stays, and "live state stays in memory" goes:

- Every mutation is one transaction: write the row, then `pg_notify('house', <patch JSON>)`.
- Each instance holds one dedicated `postgres` connection that `LISTEN`s on `house` and forwards each payload to its local peers.
- Handlers never broadcast directly. The instance that wrote the change receives its own notification, so there is one broadcast path.
- A new or reconnecting socket gets a snapshot read from Postgres.
- When the listener connection reconnects it may have missed notifications, so it re-sends a snapshot to its local peers.

Because the radio and timer are timestamps, a reconnect every few minutes is invisible: the client keeps playing and counting from the values it already has.

`NOTIFY` payloads are capped at 8000 bytes. Patches are far smaller.

## Step 0: spike (do this before anything else)

The Vercel bridge is unproven on Nitro v2. `nitropack` 2.13.6 has no upgrade handling in its Vercel runtime; Nitro v3's preset does. The installed `crossws` 0.4.17 ships `crossws/adapters/vercel`, which reads the upgrade from Vercel's request context.

Built (Nov 18):

1. `nitro.experimental.websocket: true` in `nuxt.config.ts`; `crossws@^0.4.17` added as a direct dependency (h3 v1 and nitropack bundle 0.3.5, which has no Vercel adapter).
2. `server/vercel-entry.ts`: replaces nitropack's Vercel entry. It calls `vercelAdapter(nitroApp.h3App.websocket).handleNodeUpgrade(req, res)` and otherwise serves the request through `toNodeListener`. It drops nitropack's ISR URL rewrite; there are no `isr` route rules.
3. A `nitro:init` hook in `nuxt.config.ts` sets `nitro.options.entry` only when the resolved preset is `vercel`. Setting `nitro.entry` directly also replaced the prerenderer's entry and broke the build.
4. `server/api/ws.ts`: echo handler. `upgrade` returns a `401` Response when `getUserSession(request)` has no user.
5. `server/utils/bus.ts`: `addPeer`, `removePeer`, and `publish()` (`pg_notify` through the NuxtHub `db`, so later steps can call it inside a transaction). The `LISTEN` connection opens on the first peer and throws if `DATABASE_URL` is missing.
6. `POST /api/spike/notify` (session required) calls `publish()`.

Upgrades never enter h3's middleware stack, on Vercel or in dev, so `nuxt-security`'s rate limiter and headers do not apply to them. Vercel's Firewall and rate limits still do.

Verified locally against a real Postgres 18 (throwaway, not committed):

- `nuxt dev`: signed-out upgrade rejected; signed-in upgrade echoes; one `notify` reaches two sockets through `LISTEN`; unauthenticated `notify` returns 401.
- `nuxt build` with the `vercel` preset: the function bundle contains the bridge. Run under a harness that mimics Vercel's launcher (`@vercel/request-context` with `upgradeWebSocket()` returning `{ req, socket, head }`), the same four checks pass and plain page requests still return 200.

Pass criteria still open, on a Vercel preview deployment with Fluid compute on:

- [ ] A signed-in browser connects to `/api/ws` and gets an echo (proves Vercel's real launcher matches the harness).
- [ ] A signed-out upgrade is rejected.
- [ ] A `POST /api/spike/notify` reaches a socket that has been idle for over 60 seconds.
- [ ] The socket closes at the maximum duration and the client reconnects on its own.

Deploy notes:

- `DATABASE_URL` must be set for the build as well as at runtime: NuxtHub picks the database driver at build time and falls back to PGlite without it.
- Build on Vercel, not locally with `--prebuilt`: the function's `runtime` is taken from the building machine's Node version (`nodejs26.x` locally).
- Until step 1, blob storage resolves to Vercel Blob on Vercel builds; nothing uses it yet.

If the first check fails, fall back to Server-Sent Events down (`createEventStream`) and `POST` up. The bus, the message types and the client store stay the same; only the transport file changes.

Delete `server/api/spike/` once the checks pass.

## Step 1: accounts and housekeeping

**Schema** (one new migration)

- `user.email` becomes nullable. It stays unique. Invite accounts have no email.
- New `invite` table: `code` (primary key, random), `createdBy`, `userId` (nullable), `maxUses` (nullable), `uses`, `expiresAt` (nullable), `createdAt`.
  - `userId` empty: a signup link. One link can be shared in a group chat and used until `maxUses` or `expiresAt`.
  - `userId` set: a single-use re-entry link for that member, for a lost cookie or a new device.

**Flows**

- `/join/[code]`: shows a display-name field and a "Use Neo ID" button. A valid signup code creates the account; a re-entry code signs in the bound account.
- Logto can sign in an existing account at any time. It creates a new account only when a valid signup code is present (carried through the redirect in a short-lived cookie). Without one it redirects to `/signin?error=invite_required`. This keeps the handoff's rule that the host controls signups.
- No accounts yet: `/signin` offers "Set up this house", and that account gets `role: 'admin'`.
- Admin endpoints: create, list and revoke invites; create a re-entry link for a member. Guarded with the existing `defineAbility` pattern in `shared/abilities/`.

**Session**

- Set `runtimeConfig.session.maxAge` to one year. The cookie is the identity for invite accounts.
- `nuxt-auth-utils` 0.6 seals the session with `appSecret` and ignores `session.password`. Replace `NUXT_SESSION_PASSWORD` with `NUXT_APP_SECRET` in `.env.example`.

**Housekeeping**

- Remove `routeRules['/'].prerender`. The page is auth-gated and cannot be prerendered.
- Blob: add `aws4fetch`, remove `@vercel/blob`, replace `BLOB_READ_WRITE_TOKEN` in `.env.example` with `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`. The endpoint has the form `https://s3.<region>.megas4.com`.
- Dev needs `DATABASE_URL` too, pointing at a separate dev database. Without it NuxtHub falls back to PGlite, which the `LISTEN` connection cannot reach. Remove `@electric-sql/pglite` once dev runs on Postgres.

Check: a second browser profile joins through an invite link and lands on `/`; a signed-out visitor without a code cannot create an account by either path.

## Step 2: socket, presence, snapshot and patch

**Wire protocol** in `shared/types/realtime.ts`. One change from the handoff: patches replace a whole entity instead of carrying `path: string; value: unknown`. The entities are a few fields each, and this removes the path interpreter and keeps both ends typed.

```ts
type ClientMsg =
  | { t: 'ping'; clientMs: number }
  // later steps: 'timer', 'radio', 'door', 'sit'

type ServerMsg =
  | { t: 'snapshot'; house: HouseState; serverMs: number }
  | { t: 'member'; member: MemberState }
  | { t: 'leave'; userId: string }
  | { t: 'pong'; clientMs: number; serverMs: number }
  // later steps: 'timer', 'radio'
```

**Schema**

- `member_state`: `userId` (primary key, references `user`), `lastSeenAt`. Later steps add `door` and `slot`.

**Server**

- `open`: upsert `lastSeenAt = now()`, publish `member`, send `snapshot`.
- `ping`: update `lastSeenAt`, reply `pong`. No broadcast.
- `close`: clear `lastSeenAt`, publish `leave`.
- The snapshot lists members with `lastSeenAt` inside the last 60 seconds.
- Local peers live in a module-level `Set` in `server/utils/bus.ts`. That set is a list of open sockets, not state.

Known ceiling: an instance killed without running `close` leaves a ghost member on other clients until their next snapshot, at most one maximum duration later. Acceptable for the prototype; fix with a client-side staleness check if it shows.

**Client**

- `app/composables/useHouse.ts`: VueUse `useWebSocket` with `autoReconnect` and `heartbeat`, a reactive `HouseState`, and the clock offset from `pong` (`serverMs - (clientMs + roundTrip / 2)`).
- `/` renders the member list as plain DOM.

Check: two browsers see each other join and leave; killing one tab removes it from the other within the heartbeat window; a forced reconnect restores the list.

## Step 3: timer

- `house_state`: single row. Column `timer` holds `{ endsAtServerMs, minutes } | null`.
- `ClientMsg`: `{ t: 'timer'; action: 'start' | 'stop'; minutes?: number }`. `ServerMsg`: `{ t: 'timer'; timer }`.
- The client renders the countdown from `endsAtServerMs` and its clock offset. The server does nothing when the timer ends.

Check: two browsers show the same remaining time within a second, including one that joins mid-countdown.

## Step 4: radio sync

- `house_state.radio`: `{ videoId, startedAtServerMs, pausedAtMs | null } | null`.
- `ClientMsg`: `{ t: 'radio'; action: 'play' | 'pause' | 'skip'; videoId?: string }`. `ServerMsg`: `{ t: 'radio'; radio }`.
- One YouTube IFrame player, at least 200 by 200 px and on screen. The client calls `seekTo` only when drift passes about two seconds.
- CSP in `nuxt.config.ts`: allow the YouTube iframe (`frame-src`) and its API script (`script-src`).
- Playlist table and "add a track" come here if the two-week test needs more than pasting a link.

Check: a late joiner starts within two seconds of the others; pause and resume stay aligned.

## Step 5: doors and nooks

- `member_state` gains `door` (`open | ajar | closed`, default `open`) and `slot`.
- `ClientMsg`: `{ t: 'door'; state }`, `{ t: 'sit'; slot }`. Both publish `member`.
- Door state sets the YouTube volume on that client. Moves between rooms are not announced.

## Step 6: canvas and theme packs

- Add `pixi.js`. A client-only component draws the scene from a theme-pack JSON (backdrop, slots, object sprites) stored in S4.
- The YouTube iframe is positioned over the canvas at the theme's TV slot. Nuxt UI panels sit above.
- First real use of the blob driver. Confirm here that MEGA S4 accepts the path-style URLs the driver sends (`endpoint/bucket/key`).

## Step 7: traces

- Study hours and "studied here 2h ago" from `member_state` history. Design this after the two-week test.

## Later

- **Nitro v3:** when Nuxt 4.7 is on npm, add `nitro` to `package.json`, delete `server/vercel-entry.ts` and the `nitro:init` hook, and re-run the step 0 checks.
- **Passkeys:** `nuxt-auth-utils` supports WebAuthn. Add it if re-entry links become a chore.

## Risks

- **The bridge is untested.** Step 0 exists to find out, and has a fallback.
- **First account is admin.** Anyone who reaches a fresh deployment before the host takes the house. Create the host account immediately after the first deploy.
- **Two prototype instances can exist briefly** after each deploy. `LISTEN/NOTIFY` covers it; this is the reason live state is not in memory.
- **Database connections:** each warm instance holds the NuxtHub pool plus one listener. Watch the connection limit of the Postgres plan.
- **Function region:** set the Vercel function region next to the database. Every socket message is a query.

## Not in this plan

- The unused `Layout/Header.vue` (it references a missing `UtilityAuthState` and routes that do not exist).
- CI calls `bun run lint`, and `package.json` has no `lint` script.
- `@nuxtjs/i18n` is installed with no locales.
- The stock README.

## Open questions carried over from the handoff

- [x] Node process with SQLite, or Postgres on another host? Postgres on Vercel.
- [x] Which piece gets detailed first? The realtime transport (step 0).
- [ ] Same music for everyone, or does each person bring their own? This plan assumes the shared radio.
- [ ] What does a member see in the first five seconds?
- [ ] Exact member cap per house.
- [ ] Open hours or unlocking, if kept.
- [ ] Do YouTube's policies forbid audio-only playback?
- [ ] Does DRM playback work inside Tauri or Electron?
