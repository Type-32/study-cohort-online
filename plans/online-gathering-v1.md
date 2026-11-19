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
| Sign-in | Invite link, then a display name, then a long-lived sealed cookie. No OAuth (Logto removed) | Invite codes only |
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

Preview deployment (Vercel, Fluid compute): reported working by the host on Nov 18, and step 2 was built on it. The individual checks were not recorded separately:

- [x] A signed-in browser connects to `/api/ws` and gets an echo (proves Vercel's real launcher matches the harness).
- [x] A signed-out upgrade is rejected.
- [x] A `POST /api/spike/notify` reaches a socket that has been idle for over 60 seconds.
- [x] The socket closes at the maximum duration and the client reconnects on its own.

Deploy notes:

- `DATABASE_URL` must be set for the build as well as at runtime: NuxtHub picks the database driver at build time and falls back to PGlite without it.
- Build on Vercel, not locally with `--prebuilt`: the function's `runtime` is taken from the building machine's Node version (`nodejs26.x` locally).
- `.env` verified (Nov 18): the database is PostgreSQL 16, a direct connection (same backend PID across queries, so not a transaction pooler), and `LISTEN/NOTIFY` works. Registering `LISTEN` takes about 1.6s from here. MEGA S4 accepts the S3 driver's path-style requests (PUT, GET, list, DELETE all succeeded); `aws4fetch` is installed, and with `S3_*` set NuxtHub picks the `s3` driver over Vercel Blob.
- The database has no tables yet. Apply the migrations (`bunx nuxt-db migrate`, which reads `.env`) before the preview, then open `/signin` and set up the house: the first account becomes the host.

If the first check fails, fall back to Server-Sent Events down (`createEventStream`) and `POST` up. The bus, the message types and the client store stay the same; only the transport file changes.

`server/api/spike/` was deleted in step 2.

## Step 1: accounts and housekeeping (done Nov 18)

**Schema.** No database had a migration applied yet, so `0000_nappy_blade` was replaced by a regenerated `0000_init` rather than stacking a second migration.

- `user.email` and `user.emailVerified` are gone, with Logto. Account ids are `randomUUID()`.
- `invite` table: `code` (primary key, 16 random bytes, base64url), `createdBy`, `userId` (nullable), `maxUses` (nullable), `uses`, `expiresAt` (nullable), `createdAt`.
  - `userId` empty: a signup link. One link can be shared in a group chat and used until `maxUses` or `expiresAt`.
  - `userId` set: a re-entry link for that member, single use, 7 days.

**Flows** (logic in `server/utils/core/useServerInvites.ts`)

- `/signin`: while no account exists, "Set up this house" creates an `admin`. Concurrent setups are serialized with an advisory lock; exactly one wins. Afterwards the page says the house is invite-only.
- `/join/[code]`: a signup link asks for a display name; a re-entry link shows "Welcome back, <name>" and a Continue button. A use is claimed by a conditional `UPDATE … RETURNING` in the same transaction as the account insert, so a failed join does not burn a use. Banned members are refused.
- `/`: the host sees invite links (create, copy, revoke) and members (create a re-entry link). Everyone sees "Sign in on another device", which copies a re-entry link for their own account, and a sign-out button.
- Endpoints: `GET/POST /api/v1/auth/setup`, `POST /api/v1/auth/join`, `GET /api/v1/invites/:code` (public), `GET /api/v1/invites` and `DELETE /api/v1/invites/:code` (admin, `inviteAbilities().manageInvites`). `POST /api/v1/invites`: signup links are admin-only; a re-entry link (`userId`) is allowed for the host for anyone, and for a member for themselves (`createReentryLink`).
- Known gap: a member signed out on every device needs the host for a re-entry link, and a host signed out everywhere has no way back in short of inserting an `invite` row in the database by hand.
- `POST /api/v1/auth/logout` returns JSON instead of a 302: the browser's fetch failed on the redirect, so sign-out cleared the cookie but never reloaded the page.

**Session.** `runtimeConfig.session.maxAge` is one year. The cookie holds `{ id, role }`.

**Housekeeping.** `routeRules['/'].prerender` removed (the page is auth-gated). `runtimeConfig.oauth` and the Logto variables in `.env.example` removed. `@vercel/blob` was swapped for S3 in a separate commit.

Verified against a throwaway Postgres 18: 35 API and page checks (setup race, use limits, expiry, revoke, re-entry, ban, admin-only endpoints, page redirects, socket auth), plus the re-entry, sign-out, signup and host-panel flows in a browser.

Still open from the original step 1:

- Dev needs `DATABASE_URL` too, pointing at a separate dev database. Without it NuxtHub falls back to PGlite, which the `LISTEN` connection cannot reach. Remove `@electric-sql/pglite` once dev runs on Postgres.

## Step 2: socket, presence, snapshot and patch (done Nov 18)

**Wire protocol** in `shared/utils/realtime.ts` (a `.ts` under `shared/utils`, not `shared/types`, because the client message schema is runtime zod). Patches replace a whole entity instead of carrying `path: string; value: unknown`: the entities are a few fields each, and this removes the path interpreter and keeps both ends typed.

```ts
type ClientMsg =
  | { t: 'ping'; clientMs: number }
  // later steps: 'timer', 'radio', 'door', 'sit'

type ServerMsg =
  | { t: 'snapshot'; house: HouseState; serverMs: number }
  | { t: 'member'; member: MemberState }   // { userId, username }
  | { t: 'leave'; userId: string }
  | { t: 'pong'; clientMs: number; serverMs: number }
  // later steps: 'timer', 'radio'
```

**Schema** (migration `0001_presence`). Changed from the original plan: presence is per socket, not per member, so a second tab or device does not make its member vanish when one of them closes.

- `connection`: `id` (the crossws peer id), `userId`, `lastSeenAt`, indexed on `(userId, lastSeenAt)`.
- `member_state` (door, slot) moves to step 5, where it first has columns.

**Server** (`server/api/ws.ts`, `server/utils/presence.ts`)

- `upgrade` and `open` both resolve the member from the session and the database; banned members are refused. State is not passed from `upgrade` to `open` because crossws 0.3 (dev) and 0.4 (Vercel) carry upgrade context differently.
- `open`: wait for `addPeer` (the instance is `LISTEN`ing), insert the connection row, publish `member`, send `snapshot`. Rows older than an hour are swept on each open.
- `ping` (every 20s, `PING_INTERVAL_MS`): refresh `lastSeenAt`, reply `pong`. No broadcast.
- `close`: delete the row; publish `leave` only if the member has no other fresh connection.
- Fresh = seen within 3 ping intervals (60s). Snapshots list members with any fresh connection.
- Invalid or unknown client messages are ignored; the socket stays open.

Known ceiling: an instance killed without running `close` leaves its members on other clients until those clients reconnect and get a snapshot, at most one maximum duration later. Snapshots already exclude the stale rows.

**Client**

- `app/composables/useHouse.ts`: VueUse `useWebSocket` with exponential backoff (1s doubling to 30s), a JSON ping as the heartbeat (10s pong timeout), an immediate ping on connect for the clock offset (`serverMs - (clientMs + roundTrip / 2)`), and a reactive `HouseState`. One socket per call: call it once per page.
- `/` shows "In the house" with a badge per present member, and "Connecting…" while the socket is down.

Verified against a throwaway Postgres 18, in `nuxt dev` and in a `vercel`-preset build under the launcher harness (13 checks each): snapshot contents, join and leave broadcasts, two tabs then one closing (no `leave`), last tab closing (`leave`), ping/pong and `lastSeenAt`, garbage messages ignored, stale rows excluded, banned and signed-out sockets refused, rows removed on close. In a browser: a second member appearing and leaving live, "Connecting…" while the server was down, and the list restored after it came back.

## Step 3: timer (done Nov 18)

- `house_state` (migration `0002_timer`): one row, enforced by `CHECK (id = 1)` and upserted on first write. Columns `timerEndsAt`, `timerMinutes`; both null when stopped. The radio adds its columns here in step 4.
- `ClientMsg`: `{ t: 'timer'; action: 'start' | 'stop'; minutes?: number }`, minutes an integer 1–180 and required for `start`. `ServerMsg`: `{ t: 'timer'; timer: { endsAtServerMs, minutes } | null }`. `HouseState` and the snapshot carry `timer`.
- Any member can start or stop it. The server computes `endsAt` from its own clock, writes, then publishes; it does nothing when the timer ends.
- `server/utils/house.ts` holds house-wide state (`setTimer`, `snapshot`); `presence.ts` keeps connections and `presentMembers()`.
- `app/components/FocusTimer.vue`: counts down from `endsAtServerMs` with the clock offset (VueUse `useNow`, 1s). States: running ("Focus" + mm:ss, Stop), ended ("Break", start buttons, Stop), stopped ("No timer"). Presets are 25 and 50 minutes. "Break" has no length yet; it lasts until someone starts the next focus.

Verified against a throwaway Postgres 18 in `nuxt dev`: 8 protocol checks (null before first start, start reaches every socket with the same `endsAt`, late joiner's snapshot matches, invalid intents ignored, stop broadcasts null, restart after stop). In a browser: two tabs, the second opened mid-countdown, within 1s of each other (each ticks on its own second boundary); Stop in one tab and Start in the other propagate; a countdown reaching zero switches to "Break".

## Step 4: radio sync (done Nov 19)

- `house_state` gains `radioVideoId`, `radioStartedAt`, `radioPausedAt` (migration `0003_radio`). State: `{ videoId, startedAtServerMs, pausedAtServerMs | null } | null`; position = `(pausedAt ?? serverNow) - startedAt`.
- `ClientMsg`: `{ t: 'radio'; action: 'play'; videoId }` or `{ t: 'radio'; action: 'pause' | 'resume' | 'stop' }`. Changed from the plan: `skip` is dropped (nothing to skip to without a playlist), `resume` and `stop` are added. `ServerMsg`: `{ t: 'radio'; radio }`; the snapshot carries `radio`.
- `shared/utils/radio.ts`: `nextRadio()` applies an intent; the server runs it under `SELECT … FOR UPDATE` and skips the broadcast when nothing changed, the client runs it for the optimistic update. `parseYouTubeId()` takes watch, youtu.be, shorts, live, embed and music links or a bare id; the server only accepts a validated 11-character id. Unit tests: `bun run test` (`tests/radio.test.ts`).
- `app/components/RadioPlayer.vue`: one YouTube IFrame player (`youtube-nocookie.com`, no controls, ≥200 px, always visible). Every 2s and on each state change it seeks only past 2s of drift, plays or pauses to match, and leaves ended videos alone. Live streams (`getVideoData().isLive`, undocumented) skip seeking.
- Autoplay: a page with no click yet cannot start with sound. After 3s stalled without sticky activation the player plays muted to stay in sync and shows "Tap to listen".
- The video itself is not clickable (`pointer-events: none` on the iframe), so YouTube's own overlay can't fight the shared state; the radio's buttons (with tooltips) control it, and "Open on YouTube" opens the track at the house's current position. While a track loads the video is covered by "Tuning in…" and the shared controls are disabled, so YouTube's paused-looking thumbnail doesn't invite a click.
- The home page sits behind a loading screen until the first snapshot arrives and, if the radio is on, the player shows the real state (8s cap).
- Migrations are applied by hand with `bunx nuxt-db migrate`, never at build. The first production deploy of this step ran without `0003_radio`: every snapshot failed to read `house_state`, so other devices saw the radio as off. Applied Nov 19.
- "The video stopped after 10–20 minutes" (Nov 19) had the same cause. The play intent failed on the server, so the radio only existed as the sender's optimistic state. Once `0003_radio` was applied, the next reconnect (Vercel closes sockets about every 5 minutes) brought a snapshot with `radio: null`, which removed the player. Fix: when an intent fails, the server logs it, sends the sender `{ t: 'error' }` (shown as a toast) and a fresh snapshot, so a failure shows at once instead of minutes later.
- Unplayable videos (embedding disabled, removed, private) show an error to everyone until someone plays another link.
- `app/components/HouseRadio.vue`: paste-a-link form, Pause/Resume and Turn off (shared), volume slider and mute (per browser, localStorage).
- CSP needed no change: `nuxt-security` sets no `frame-src` or `default-src`, its `script-src` uses `strict-dynamic`, and COEP is already off. No violations were reported in the browser.
- Playlist and "add a track" still deferred until the two-week test asks for it.

Verified against a throwaway Postgres 18 in `nuxt dev`: 10 protocol checks (play reaches others, pause freezes the position, a late joiner gets the paused state, resume keeps the position, no-op and invalid intents broadcast nothing, three concurrent pauses produce one broadcast, new track, stop, snapshot after stop). In a browser with two tabs: a tab joining 5s in was 0.37s from the first; after two pause/resume rounds from different tabs, drift was 0.05s and 0.08s; the tab with no click played muted and offered "Tap to listen"; an embedding-disabled video showed the error in both tabs and the next link recovered both; Turn off removed the player in both. The live-stream branch is untested: the test live stream refuses embedding (error 150).

### Keeping the tab awake (Nov 19)

Browsers discard (Chrome Memory Saver, Edge sleeping tabs) or freeze background tabs, which drops the member out of the house and stops the radio. Tabs playing audio are exempt, so `app/composables/useKeepAwake.ts` plays a 20 Hz tone at -60 dBFS: above Chromium's audibility threshold, inaudible in practice. It starts on the first click or key press (autoplay rules) and is on by default; the "Keep this tab awake" switch on the home page turns it off (localStorage). A Chromium tab restored after a discard with the switch off shows a toast pointing at the switch. Verified: the switch creates a running `AudioContext` and persists. Not verified: that browsers count the tone as audible (the tab's speaker icon or `chrome://discards` shows it).

## Step 5: doors and nooks (done Nov 19)

- `member_state` (migration `0004_doors`, applied to production Nov 19): `userId` (primary key), `door` (`open | ajar | closed`, default `open`), `updatedAt`. No row means open. The door is durable: it stays as you left it across visits. Presence stays in `connection`.
- `ClientMsg`: `{ t: 'door'; state }`. `MemberState` gains `door`; the server upserts it and publishes `member`, and joins and snapshots carry it (`presentMembers` left-joins `member_state`). Applied optimistically on the sender.
- Changed from the plan: `sit` / `slot` moved to step 6. Slots come from the theme pack's scene, so there is nothing to sit in until the canvas exists.
- Door → sound, per client: open hears the radio at your volume, ajar at a quarter of it, closed muted. The player keeps playing in sync behind a closed door, so opening it is instant. A hint under the radio says why it is faint or silent.
- Door → how others see you: open "At their desk" (or "Focusing at their desk"), ajar "Lamp on" (dimmed), closed "Light under the door" (dimmer). Nobody disappears, and changes are not announced.
- `app/components/DoorSwitch.vue`: Open / Ajar / Closed, each with a tooltip saying what it means.

Verified against a throwaway Postgres 18 in `nuxt dev`: 9 protocol checks (default open, joins carry the door, closing reaches others without a `leave`, invalid door ignored, remembered across a reconnect and in the rejoin broadcast, ajar, snapshot shows every door). In a browser: open 60 → ajar 15 → closed muted (still playing) → open 60; the member list and hint follow each switch; the door was remembered across a reload.

## Step 6: canvas and theme packs

- Add `pixi.js`. A client-only component draws the scene from a theme-pack JSON (backdrop, slots, object sprites) stored in S4.
- The YouTube iframe is positioned over the canvas at the theme's TV slot. Nuxt UI panels sit above.
- Seats (moved from step 5): `member_state.slot` and `{ t: 'sit'; slot }`, publishing `member`. Slot ids come from the theme pack; the server rejects a slot the theme doesn't have.
- First real use of the blob driver. MEGA S4's path-style support was confirmed in step 0.

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
