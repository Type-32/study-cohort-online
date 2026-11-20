# Online Gathering v1: implementation plan

Nov 18, 2026. Companion to `Online Gathering design and architecture handoff.md`. The handoff holds the product design; this file holds the build decisions and replaces the handoff's "Architecture" section wherever the two disagree.

Target: the handoff's first prototype, one house played with friends for two weeks.

## Build order (revised Nov 19)

Steps 6 to 11 and 14 were added on Nov 19; the canvas and traces moved from 6 and 7 to 12 and 13. Each step's section has the design.

| Step | What | State | Needs |
| --- | --- | --- | --- |
| 0–5 | Transport, accounts, presence, timer, radio, doors | Done | |
| 6 | Single-use signup links | Done Nov 19 | Migration `0005` (applied) |
| 7 | Door sound settings (quieter or muffled) | Done Nov 19; levels need a listen | Client only |
| 8 | Suggestions and the queue | Done Nov 19 | Migration `0006` (applied) |
| 9 | The radio as an object (LCD, keys, knob, shelf) | Done Nov 19 | Client only |
| 10 | The tuner: a dial of every track played before | Done Nov 19 | No migration |
| 11 | Notes (text chat) | Planned | Migration `0007` |
| 12 | Canvas and theme packs | Planned | Skins the step 9 radio |
| 13 | Traces | Design after the two-week test | |
| 14 | Voice | Spike first, after the two-week test | Media infrastructure outside Vercel |

Steps 6, 7, 8 and 11 don't depend on each other and can be reordered. Step 9 needs step 8's data, and step 10 needs both. Every open design question was answered on Nov 19; the answers are recorded in the steps.

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

- `app/composables/useHouse.ts`: VueUse `useWebSocket` with exponential backoff (1s doubling to 30s), a JSON ping as the heartbeat (10s pong timeout), an immediate ping on connect for the clock offset (`serverMs - (clientMs + roundTrip / 2)`), and a reactive `HouseState`. One socket per call: call it once per page. (Replaced Nov 19 by the `house` Pinia store; see "Intents and optimistic UI" under step 5.)
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
- Playlist and "add a track" were deferred here; they are now step 8.

Verified against a throwaway Postgres 18 in `nuxt dev`: 10 protocol checks (play reaches others, pause freezes the position, a late joiner gets the paused state, resume keeps the position, no-op and invalid intents broadcast nothing, three concurrent pauses produce one broadcast, new track, stop, snapshot after stop). In a browser with two tabs: a tab joining 5s in was 0.37s from the first; after two pause/resume rounds from different tabs, drift was 0.05s and 0.08s; the tab with no click played muted and offered "Tap to listen"; an embedding-disabled video showed the error in both tabs and the next link recovered both; Turn off removed the player in both. The live-stream branch is untested: the test live stream refuses embedding (error 150).

### Keeping the tab awake (Nov 19)

Browsers discard (Chrome Memory Saver, Edge sleeping tabs) or freeze background tabs, which drops the member out of the house and stops the radio. Tabs playing audio are exempt, so `app/composables/useKeepAwake.ts` plays a 20 Hz tone at -60 dBFS: above Chromium's audibility threshold, inaudible in practice. It starts on the first click or key press (autoplay rules) and is on by default; the "Keep this tab awake" switch on the home page turns it off (localStorage). A Chromium tab restored after a discard with the switch off shows a toast pointing at the switch. Verified: the switch creates a running `AudioContext` and persists. Not verified: that browsers count the tone as audible (the tab's speaker icon or `chrome://discards` shows it).

## Step 5: doors and nooks (done Nov 19)

- `member_state` (migration `0004_doors`, applied to production Nov 19): `userId` (primary key), `door` (`open | ajar | closed`, default `open`), `updatedAt`. No row means open. The door is durable: it stays as you left it across visits. Presence stays in `connection`.
- `ClientMsg`: `{ t: 'door'; state }`. `MemberState` gains `door`; the server upserts it and publishes `member`, and joins and snapshots carry it (`presentMembers` left-joins `member_state`). Applied optimistically on the sender.
- Changed from the plan: `sit` / `slot` moved to the canvas step (now step 12). Slots come from the theme pack's scene, so there is nothing to sit in until the canvas exists.
- Door → sound, per client: open hears the radio at your volume, ajar at a quarter of it, closed muted. The player keeps playing in sync behind a closed door, so opening it is instant. A hint under the radio says why it is faint or silent.
- Door → how others see you: open "At their desk" (or "Focusing at their desk"), ajar "Lamp on" (dimmed), closed "Light under the door" (dimmer). Nobody disappears, and changes are not announced.
- `app/components/DoorSwitch.vue`: Open / Ajar / Closed, each with a tooltip saying what it means.

Verified against a throwaway Postgres 18 in `nuxt dev`: 9 protocol checks (default open, joins carry the door, closing reaches others without a `leave`, invalid door ignored, remembered across a reconnect and in the rejoin broadcast, ajar, snapshot shows every door). In a browser: open 60 → ajar 15 → closed muted (still playing) → open 60; the member list and hint follow each switch; the door was remembered across a reload.

### Intents and optimistic UI (Nov 19)

Clicks looked jumpy: the optimistic copy was written into the same state that broadcasts and snapshots overwrite, so anything arriving in between (most visibly, the broadcast of an earlier quick click) could flip a control back for a moment. A reconnect also reshuffled the member list (snapshot order) and could report your own `leave` after your rejoin.

- `app/stores/house.ts` (Pinia setup store) owns the socket and keeps the server's state (`confirmed`) separate from this member's unanswered intents (`pending`). Components read `house`, which is `confirmed` with the pending intents applied on top, so nothing arriving in between can undo a click. Members are sorted by name. The home page calls `connect()` on mount and `disconnect()` on unmount; the header only reads.
- Every intent carries an `id`. The broadcast it causes carries the id back as `intent`, and the store drops the intent in the same tick it applies the broadcast. Errors carry the id too, and the intent is dropped as failed. With no answer after 10s, the intent is given up.
- `useHouseIntent()` wraps the store's `sendIntent` in a Pinia Colada `useMutation`: `isLoading` until the house answers (the radio's Play button shows it), plus a toast on failure.
- Server: each socket's messages run one after another (a promise chain per peer), and each change is published inside its own transaction, so notifications arrive in commit order. Together these mean the second of two quick clicks wins, and they come back in the order they were sent. A radio intent that changes nothing still broadcasts, so the sender gets an answer.
- `leave` is checked and sent in one statement (`pg_notify … where not exists (fresh connection)`), so it can't land after the same member's rejoin. The client also ignores a `leave` for itself while its socket is open.
- Radio phases (`RadioPhase`): `tuning`, `playing`, `paused`, `ended` (the house's position is past the end of the track) and `unavailable` (YouTube refused it). "Tuning in" now means only that the track is loading. A finished track shows "Track over" and is covered with a prompt to put on the next one. The player checks the position as soon as playback starts, so a finished track never plays out loud first.

Verified against a throwaway Postgres: 9 protocol checks (intent ids come back on door, timer and radio broadcasts; five rapid door intents come back in order and the last one wins; a no-op radio intent answers; a reconnect never ends with `leave`; a real leave is still sent). In a browser: five door clicks 40 ms apart pressed exactly Open → Ajar → Closed → Open → Ajar → Closed with no bounce. A dropped socket left the door and member list unchanged; only the member count hid while reconnecting. A track that ended two hours ago went Connecting → Tuning in → Track over, never On air. Turning the radio off showed Off / Nothing on, and Play went Tuning in… → title → On air.

## Step 6: single-use signup links (done Nov 19)

Before this step a signup link had no use limit unless one was passed (`maxUses` null), and nothing recorded who joined through it.

**Behaviour**

- A new signup link works once. The host can give it more uses (1 to 50) when creating it.
- Once its last use is taken the link is dead: `/join/<code>` says "This link has already been used. Ask the host for a new one." instead of the generic invalid-link message.
- The host's list shows who joined through each link, including links that still have uses left.
- A used-up link stays in the list for a day, then is removed.

**Schema** (migration `0005_invite_uses`, applied to production Nov 19; production had no invite rows, so the backfill changed nothing)

- `invite.maxUses` becomes `NOT NULL DEFAULT 1`. Existing rows without a limit get `greatest(uses, 1)`, so an unused old link becomes single-use and a used one is closed.
- `invite.usedUpAt` (nullable): set by the same `UPDATE` that claims the last use.
- `user.inviteCode` (nullable, references `invite.code`, `ON DELETE SET NULL`): the signup link that created the account.

**Server** (`server/utils/core/useServerInvites.ts`)

- `joinHandler`: the claiming `UPDATE` also sets `usedUpAt = now()` when `uses + 1` reaches `maxUses`; the account insert stores `inviteCode`. Still one transaction, so a failed join burns nothing.
- Removal needs no scheduler. `listInvitesHandler` first deletes links whose `usedUpAt` is more than a day old. The host's list is the only place a link is visible and `usable()` already refuses it on join, so deleting on read looks the same as deleting on time.
- Re-entry links work once, as now: the claiming `UPDATE` sets `usedUpAt` on their only use. Decided Nov 19: the same one-day rule removes used re-entry links, and links a day past `expiresAt` (an unused re-entry link expires after 7 days).
- `GET /api/v1/invites` returns each link with `joined: { id, username }[]`. `GET /api/v1/invites/:code` returns 410 for a used-up link and keeps 404 for an unknown one.
- `POST /api/v1/invites`: `maxUses` is an integer 1 to 50, default 1.

**Client** (`app/components/HostPanel.vue`)

- A "Uses" number field (default 1) beside "New signup link".
- Row states: unused ("0 of 3 used", copy, revoke); partly used (names so far); used up (dimmed, "Used" badge, "Mina, Kai and Jo joined", "removed in 14 h", no copy button, revoke removes it now).
- The panel's lists are Pinia Colada queries (`invites`, `users`). Create and re-entry are mutations that add the new row to the cached list; revoke is a mutation that removes the row at once and reloads the list if the server refuses.
- `/join/<code>` shows the server's reason: used, expired, or unknown or revoked.

**Notes**

- The record of who joined through a link goes when the link is removed. If "invited by" should outlive it, add `user.invitedBy`; not planned.
- The migration is safe to apply before deploying: the deployed code inserts without `maxUses` and gets the default.

**Checks:** a default link refuses a second join; a 3-use link lists three names and closes on the third; a join without a name burns no use and sets no `usedUpAt`; two simultaneous joins on a single-use link produce one account; a link used over a day ago (backdated in the test) is gone from the list; deleting a member removes their name and keeps the count.

Verified against a throwaway Postgres 18 in `nuxt dev`. The migration over legacy rows: an unlimited unused link became single-use and open, an unlimited link used twice became 2 of 2 and used up, a 3-use link with 1 use stayed open, a used single-use link was marked used up. 20 API checks: all of the above; four simultaneous joins on a single-use link gave one 200 and three 410s and one account; 51 uses refused; re-entry works once and is marked; links used up (signup and re-entry) or expired over a day ago are gone, one expired 2 h ago is still listed; an expired link is refused with its reason; a member keeps their account after their link is deleted. In a browser: the list reads "Ann and Cy joined · 3 of 3 used · removed in 24 h" with a Used badge; a 3-person link was created and listed as "0 of 3 used"; Remove took a row out at once. The join page (server-rendered, signed out) showed the right reason for a used, an expired and an unknown code.

## Step 7: door sound settings (done Nov 19)

Each listener chooses how the radio sounds through their own door. Stored in localStorage, like the volume.

| Door | Choices | Default |
| --- | --- | --- |
| Ajar | Quieter, Muffled | Quieter (today's behaviour) |
| Closed | Silent, Quieter, Muffled | Silent (today's behaviour, and the handoff's "nothing from the commons") |

**What "muffled" can be.** The YouTube iframe's audio can't be routed through Web Audio, so the music itself can't be low-pass filtered (handoff, "Rendering"). Muffled is therefore an effect laid over the music: the music is turned down further, and a quiet low noise bed plays on top to mask its high end, so it reads as coming through a wall. The bed is brown noise generated in Web Audio; no audio file.

Starting levels, to be tuned by ear. They live in one constants object.

| Door and choice | Music volume (of your slider) | Noise bed |
| --- | --- | --- |
| Ajar, quieter | 25% | Off |
| Ajar, muffled | 15% | Low |
| Closed, quieter | 8% | Off |
| Closed, muffled | 5% | Higher |
| Closed, silent | Muted | Off |

**Build**

- `doorSound(door, settings, volume)` in `shared/utils/radio.ts` returns `{ volume, muted, bed }`. It replaces `doorVolume` and `doorMuted` in `HouseRadio.vue` and gets a unit test in `tests/radio.test.ts`.
- `useDoorBed`: a looped 2 s brown-noise buffer through a gain node. The gain ramps over about 300 ms when the door or the setting changes. It plays only while the radio is `playing`, follows the listener's volume and mute, and shares one `AudioContext` (and its wait-for-a-click unlock) with `useKeepAwake`.
- UI: a settings button beside "Your door" opens a popover with the two choices above. The hint under the radio names the mode ("Your door is ajar, so the radio is muffled"). In step 9 this becomes a switch on the radio.
- No server change and no migration.

**Risk:** the noise bed may read as hiss rather than as muffling. Listen on speakers and on headphones before shipping. If it doesn't work, Muffled ships as "lower volume" only. Sound the app plays itself (voice in step 14, any ambient files) can be filtered for real.

**Built** (Nov 19)

- `shared/utils/radio.ts`: `DoorSoundSettings`, `DEFAULT_DOOR_SOUND`, `DOOR_SOUND_LEVELS` (the table above) and `doorSound()`. An unknown stored value falls back to the default. Unit test in `tests/radio.test.ts`.
- `app/composables/useAudioContext.ts`: the page's one `AudioContext`, created on the first click or key press. `useKeepAwake` now adds its tone to it instead of owning a context; turning keep-awake off stops the tone and leaves the context.
- `app/composables/useDoorSound.ts`: `useDoorSoundSettings()` (localStorage `house:door-sound`) and `useDoorBed(level)`: brown noise from a 2 s buffer, tilted so the loop doesn't click, through a 400 Hz low-pass and a gain that glides to each new level (time constant 0.1 s). Nothing is created until a level above 0 is asked for.
- `HouseRadio.vue`: volume, mute and the hint come from `doorSound()`. The bed plays only while the radio is on air and follows the listener's mute and volume.
- `DoorSwitch.vue`: a headphone button beside the door opens a popover with the two choices. The door buttons' tooltips name what you'll hear.

Verified in a browser (Chromium, `nuxt dev` on a throwaway Postgres) at slider 60, reading the player's volume and the bed's gain: open 60, no bed; ajar default 15; ajar muffled 9 with bed 0.03; closed default muted; closed quieter 5; closed muffled 5 with bed 0.048; paused bed 0; open again 60, bed 0. One `AudioContext`, one keep-awake oscillator, one bed reused across changes. The setting persisted. **Not verified:** how it sounds. The levels above are starting points; listen on speakers and headphones and adjust `DOOR_SOUND_LEVELS`.

## Step 8: suggestions and the queue (done Nov 19)

Members propose tracks; the host decides the order. This replaces "anyone pastes a link and it plays for everyone" (decided Nov 19): members can no longer put a link straight on air or turn the radio off. They suggest, and can still pause and resume.

| Action | Who |
| --- | --- |
| Suggest a link (up to 3 open at once), withdraw your own | Everyone |
| Pause, resume | Everyone (unchanged) |
| Play now, play next, move in or out of the queue, remove any suggestion, skip, turn off | Host and moderators |
| Move on when a track ends | Automatic, whether or not the host is in the house |
| Choose what happens when the queue and suggestions run out | Host |

**What plays next** (decided Nov 19)

1. The host's queue, in the host's order.
2. If the queue is empty, the oldest suggestion.
3. If there are no suggestions, the host's "when empty" setting decides:
   - **Shuffle:** a random station from the catalog (`radio_track`). It skips the track that just ended and stations marked unplayable. If no other station is left, the radio stops.
   - **Stop:** nothing plays; the radio shows "Track over".

The radio moves on by itself, so when the host leaves, the members keep hearing the queue and the suggestions, then whatever the setting says. While the host is in, they can step in at any time (play now, skip, reorder). A suggestion made while the radio is off or its track is over plays at once.

**The "when empty" setting**

- Stored on the server: `house_state.radioWhenEmpty`, `'shuffle' | 'stop'`, default `'stop'` (today's behaviour). It survives reloads, deploys and the host leaving.
- `ClientMsg`: `{ t: 'radioWhenEmpty'; mode }`, host only. `ServerMsg`: `{ t: 'radioWhenEmpty'; mode }`. The snapshot carries it (`HouseState.radioWhenEmpty`), so everyone can see it. It goes through the intent path, so the host's switch moves at once.
- Changing it doesn't touch what's playing. When the radio is already showing "Track over" and the host switches to Shuffle, a station starts at once, the same rule as a suggestion on an idle radio.
- A random pick is a normal start: `radio_track` gets `plays + 1`, and `RadioState.by` is `null`, which the LCD shows as `SHUFFLE` instead of a name.

**Unplayable stations.** With the host away, nobody can skip a video YouTube refuses, so shuffle mustn't get stuck on one. YouTube's errors 100 (removed or private) and 101 and 150 (the owner disallows embedding) are about the video, not the viewer. A client that gets one of them sends `{ t: 'radio'; action: 'unplayable'; videoId; startedAtServerMs }`. The server treats it like `ended` (it moves on only if that is still the current track), and sets `radio_track.unplayableAt`, so shuffle won't pick that station again. The host's station list shows it as unplayable, and playing it by hand clears the mark. Other errors (2 and 5, a bad id or a player error) are reported by nothing, as before.

**Schema** (migration `0006_radio_queue`)

- `radio_suggestion`: `id` (uuid generated by the client, so the optimistic row and the stored row are the same row), `userId` (cascade), `videoId`, `queuePosition` (integer; null means suggested and not queued), `createdAt`. A suggestion is deleted when it plays, is withdrawn, or is removed.
- `youtube_video`: what the server knows about a video, fetched once and shared by suggestions, the radio and the stations. `videoId` (primary key), `title`, `fetchedAt`; `title` is nullable. Suggestions and stations show its title instead of keeping their own. Chapters (see "Chapters, later") would add `durationMs`, `chapters` and `embeddable` here.
- `house_state` gains `radioTitle`, `radioSuggestedBy` and `radioWhenEmpty`. `RadioState` gains `title` and `by` (a username, or `null` for a shuffle pick), so every client shows the title before its player loads and who picked the track.
- `radio_track`, the catalog for step 10 and the pool for shuffle: `videoId` (primary key), `station` (unique integer), `plays`, `lastPlayedAt`, `addedBy` (the member whose pick first put it on air; set null on delete), `unplayableAt` (nullable). It is written in the transaction that puts a track on air: a new track gets the next station number (`max + 1`, safe under the `house_state` row lock) and a known one gets `plays + 1` and a new `lastPlayedAt`. `RadioState` also gains `station`. This is recorded from step 8 on, before the tuner exists, because play history can't be recovered later.

**Preview.** Thumbnail from `https://i.ytimg.com/vi/<id>/mqdefault.jpg` (the CSP's `img-src` already allows `https:`). The server fills `youtube_video` the first time a video is suggested or played, from YouTube's oEmbed endpoint, which needs no key. oEmbed answers, checked Nov 19:

| Video | oEmbed answer | Handling |
| --- | --- | --- |
| Normal | 200 with `title` and `author_name` | Store the title |
| No such id | 400 | Refuse the suggestion |
| The live stream that refused embedding in step 4 | 200 with no `title` | Store without a title; show "May not play here" |
| No answer within 3 s | | Store without a title |

oEmbed can't say for certain that a video will play in the embed, so an unplayable one can still reach the radio. It then shows "Can't play" as today, and the players' `unplayable` report moves the radio on (see "Unplayable stations").

**Wire protocol**

```ts
type ClientMsg =
  | { t: 'suggest'; suggestionId: string; videoId: string }
  | { t: 'unsuggest'; suggestionId: string }                          // your own; the host, anyone's
  | { t: 'queue'; suggestionId: string; to: 'next' | 'last' | 'off' } // host
  | { t: 'radio'; action: 'play'; suggestionId: string }              // host: play now
  | { t: 'radio'; action: 'play'; videoId: string }                   // host: the pasted link, now
  | { t: 'radio'; action: 'skip' | 'stop' }                           // host
  | { t: 'radio'; action: 'ended'; videoId: string; startedAtServerMs: number } // sent by the player
  | { t: 'radio'; action: 'unplayable'; videoId: string; startedAtServerMs: number } // sent by the player
  | { t: 'radio'; action: 'pause' | 'resume' }
  | { t: 'radio'; action: 'seek'; positionMs: number }                 // host
  | { t: 'radioWhenEmpty'; mode: 'shuffle' | 'stop' }                   // host

type ServerMsg =
  | { t: 'suggestion'; suggestion: Suggestion }   // new or changed
  | { t: 'unsuggest'; suggestionId: string }
  | { t: 'radioWhenEmpty'; mode: 'shuffle' | 'stop' }
// Suggestion: { id, videoId, title, userId, username, queuePosition }
// HouseState gains `suggestions` and `radioWhenEmpty`.
```

- One message per suggestion, not the whole list: a `NOTIFY` payload is capped at 8000 bytes, and three titled suggestions from each of a few dozen members don't fit.
- `queue`: `next` puts it ahead of the current first, `last` behind the current last, `off` returns it to the suggestions.

**Moving on without a ticking server.** Each client's player already knows when the track is over (phase `ended`). It then sends `ended`, naming the track it watched end. Under the `house_state` row lock the server moves on only if that is still the current track, so twenty clients reporting cause one change and a late report about an old track does nothing. Starting the next track, deleting its suggestion and publishing `radio` and `unsuggest` are one transaction. If nobody is connected nobody reports, and the first person back triggers the move.

- A client where the video is `unavailable` with error 2 or 5 reports nothing: that may be a problem in that browser only.
- Live streams never end; the host skips them, or they play until the host is back.
- `skip` with nothing in the queue or the suggestions follows the "when empty" setting: a random station, or the radio turns off.

**Limit of 3.** Counted and inserted in one transaction under a per-member advisory lock, so two tabs can't both take the third slot. Queued suggestions count. The host's own additions are not limited.

**No duplicates.** A video can be on the shelf once (unique index on `radio_suggestion.videoId`). Suggesting it again is refused with "That one is already on the shelf."

**Shared logic.** `nextUp(suggestions)` in `shared/utils/radio.ts`, unit-tested, used by the server and by the store's optimistic `applyIntent`. It returns a suggestion, `'whenEmpty'` or nothing. The random pick happens only on the server (`order by random()` over the eligible stations, under the row lock); the client shows "Tuning in" until the broadcast arrives.

**Permissions.** "Host" in steps 8 to 10 means the host and moderators (decided Nov 19). `radioAbilities().manageRadio` (`minRole: 'moderator'`) is checked on every host intent against the member re-read from the database, as the door intent does. A refusal answers with `error` and the intent id. The client hides host controls from members.

Making someone a moderator: the promote and demote endpoints exist but have no UI. Add "Make moderator" and "Remove moderator" to the members tab of the host panel. Today `promoteUser` and `demoteUser` allow any moderator, so a moderator could hand radio control to anyone; tighten both to `minRole: 'admin'` in this step.

**Seeking (host and moderators).** The host can move the playing track to any point.

- `{ t: 'radio'; action: 'seek'; positionMs }` goes through `nextRadio`, so the server and the sender's optimistic copy compute the same state. Playing: `startedAtServerMs = now - positionMs`. Paused: `startedAtServerMs = pausedAtServerMs - positionMs`, so the track stays paused at the new point.
- The server clamps `positionMs` to at least 0. It doesn't know the track's length, so the bar itself stops 1 s short of the end (the length comes from the player). A seek past the end anyway makes the track end, and the players' `ended` report moves the radio on as usual.
- Other clients need nothing new: the broadcast moves the shared position, and their players already jump to it when they drift more than 2 s. A seek of under 2 s is therefore not passed on; the bar moves in steps that make that rare.
- One intent per drag, sent when the thumb is let go. Arrow keys move 5 s per press and send once the keys rest for 300 ms.
- Live streams have no position, so they get no bar; the radio shows `LIVE`.

**Chapters, later (deferred Nov 19).** Not built now; the progress bar is built so they can be added without changing it. Chapters are the timestamps an uploader writes in a video's description (YouTube's rules: the first is `0:00`, at least three, in ascending order, each at least 10 s). Neither the embedded player nor oEmbed exposes the description; the YouTube Data API does (`videos.list`, `part=snippet,contentDetails,status`, 1 unit of a free 10,000 a day). To add them:

- Create a key (Google Cloud project, YouTube Data API v3) and set `NUXT_YOUTUBE_API_KEY`. Fill `youtube_video` from `videos.list` instead of oEmbed, adding `durationMs`, `chapters` (jsonb, `{ startMs, title }[]`) and `embeddable` (refuse non-embeddable suggestions).
- `parseChapters(description, durationMs)` applies YouTube's rules and drops a set that breaks one rather than guessing. Chapters YouTube generates automatically aren't in the description.
- `GET /api/v1/radio/videos/:videoId` returns them; not the snapshot or the socket, since a long mix can have hundreds and a `NOTIFY` payload is capped at 8000 bytes.
- Pass them to the bar's `chapters` prop.

**Progress bar**

- Everyone sees it: the position, updated each second from `radioPositionMs`, and the length, with `12:04 / 48:10` beside it.
- The bar takes an optional `chapters` prop (`{ startMs, title }[]`). Nothing supplies it yet. When given, the bar is split into segments at the chapter starts, like YouTube's, the current chapter's title shows beside the time, and hovering or focusing a segment shows its title and start time. Build and test this with a hard-coded list, so turning chapters on later is only the data side above.
- For the host and moderators, the thumb can be dragged and focused. While dragging, a label shows the target time and chapter, and nothing is sent until release. After release, the pending intent keeps the bar at the new point until the broadcast confirms it, so it doesn't jump back. For members the bar is read-only and has no thumb.
- Built on `USlider` with the chapter gaps drawn behind its track, so keyboard and screen-reader support come with it. `aria-valuetext` reads "12 minutes 4 seconds of 48 minutes 10 seconds", plus ", chapter: Rainy night" when there are chapters.

**UI** (plain rows; step 9 moves them onto the radio)

- Two lists under the radio: "Up next" and "Suggestions". A row has the thumbnail, the title and who suggested it.
- Host buttons per row: Play now, Play next, Remove. Your own rows: Withdraw. All with tooltips.
- The link box. Member: "Suggest a track", with "2 of 3 left", disabled at 3. Host: "Play now" or "Add to queue".
- Host: a "When the list runs out" choice, Shuffle stations or Stop, with a tooltip. Members see the current mode as a line under the lists ("Then: shuffle stations").
- The progress bar sits under the video, above the controls.

**Risk:** `ended` and `unplayable` are taken on trust. A member's modified client could end a track early or mark one unplayable. Accepted among invited friends; the server can't know a video's length or embeddability without a YouTube Data API key.

**Checks:** a fourth suggestion is refused, also from two tabs at once; withdraw frees a slot; a member's `queue`, `skip`, `stop`, direct `play` and `radioWhenEmpty` are refused with an error; host order is respected; `ended` from three sockets moves on once; a stale `ended` does nothing; the queue runs dry into the oldest suggestion; then, with Stop, the radio shows "Track over", and with Shuffle a station other than the last track plays, with `by: null`; with the host's sockets closed the radio still moves on; switching to Shuffle on an idle radio starts a station; Shuffle with only the just-ended track in the catalog stops; `unplayable` moves on and shuffle never picks that station again; the setting survives a server restart and is in a late joiner's snapshot; a suggestion on an idle radio plays at once; a bad id is refused.

Moderator checks: a moderator's `queue`, `skip`, direct `play`, `seek` and `radioWhenEmpty` succeed; a demoted moderator is refused on their next intent without reconnecting; a moderator can no longer promote anyone.

Seek checks: a member's `seek` is refused; a host seek moves a second tab's player within one 2 s tick; a seek while paused stays paused at the new point; the dragged bar doesn't jump back before the broadcast; given a hard-coded `chapters` list, the bar shows segments and the current chapter; a live stream shows no bar.

### Built (Nov 19)

Files: `server/utils/radioQueue.ts` (the shelf, the catalog, moving on, oEmbed, permissions), `shared/utils/radio.ts` (`RadioState` gains `title`, `by`, `station`; `seek`; `shelfOrder`, `nextUp`, `queuePositionFor`), `shared/utils/realtime.ts` (the intents), `app/stores/house.ts` (shelf state and optimistic shelf intents; `report()` for player reports), `app/components/RadioShelf.vue`, `RadioProgress.vue`, `HouseRadio.vue`, `RadioPlayer.vue` (reports and length), `HostPanel.vue` (make or remove moderators). Migration `0006_radio_queue`: the three tables and the `house_state` columns; the track on air when it ran became station 1. Applied to production Nov 19 (production's track on air became station 1).

Changed from the design above:

- **A refusal skips a track only when every member present was refused.** In the browser test, a second member on a different address (`[::1]` instead of `localhost`) got error 150 for videos that played fine for the host, so their player alone skipped tracks for everyone and marked them unplayable. YouTube's "embedding not allowed" can depend on the viewer (region, the page's address), not just the video. `house_state.radioUnplayableBy` collects the members whose player refused the track on air; the radio moves on, and the station is marked, only once every member present is in it. A member who can't play a track sees "Can't play" while the others keep listening.
- **`house_state.radioEndedAt`**: set when the players report the track over and nothing follows (Stop). That's how the server knows the radio is idle, so the next suggestion, or switching to Shuffle, starts a track at once.
- **One lock instead of a per-member advisory lock.** Every shelf and radio change runs under the `house_state` row lock, which also serializes the limit of 3.
- **The intent id rides on the last message an intent causes** (play from the shelf publishes `unsuggest` then `radio`), so the sender's optimistic copy is dropped only once all of it has arrived. An intent that changes nothing is answered with the radio as it is.
- **Wire names**: `{ t: 'radio'; action: 'playSuggestion'; suggestionId }` (not `play` with a `suggestionId`); `skip` and `stop` are separate shapes; `suggest` takes `queue: true` for the host's "Add to the queue". Player reports carry no intent id and get no answer.
- **Refusals read as sentences** ("That one is already on the shelf.", "Only the host and moderators can do that."): `HouseError` is shown as is, without the snapshot that follows an unexpected failure.
- **oEmbed**: 400 or 404 refuses the link; 401 and 403 keep it without a title; a timeout or network error keeps it without a title and doesn't cache, so the next try asks again.
- **Promote and demote are host only**, and demote only applies to moderators.
- **The progress bar**: one seek per drag or per burst of arrow keys (250 ms). Not done: `aria-valuetext` on the thumb; `USlider` doesn't expose the thumb's attributes.
- **Player cover**: the "Tuning in…" / "Track over" cover now fades with CSS. With `AnimatePresence`, a quick phase change left an invisible "Tuning in…" in the page's live region.

Verified against a throwaway Postgres 18 (UTF-8; the default Windows-locale cluster is WIN1252 and refused a Korean title, production is UTF8) in `nuxt dev` on port 3001: 53 protocol checks, all passing. They cover every check listed above, plus: one refused player doesn't skip, all present refused does, and the refusal list resets per track; a non-Latin title is stored; a replayed track keeps its station and counts the play. 7 unit tests (`bun run test`). In a browser with the host on `localhost` and a member on `[::1]`: the host saw Skip, Turn off, Play now, Add to the queue and per-row Play now / Play next / Take out of the queue / Remove; the member saw only Pause, Open on YouTube, Mute, Suggest and Withdraw on their own row, with "2 of 3 suggestions left". The member's player refused the track (error 150) and the radio stayed on air for the host. The host pressed End on the bar; the track ended and the queue's next track came on air in both tabs. A throwaway page with hard-coded chapters showed the segments, "1:47 · Rainy night" on hover, a read-only bar without a thumb, and `LIVE` for a live stream.

## Step 9: the radio as an object (done Nov 19)

The radio section becomes one object that looks and works like a radio and holds everything from steps 7 and 8. It is built in DOM and CSS, not on the canvas: it has real controls (keyboard, screen readers) and the YouTube iframe has to be a DOM element anyway. In step 12 the canvas only places it at the theme's radio slot and reskins it.

```
┌───────────────────────────────────────────────────────────────┐
│ ┌──────────────────────────────┐  ┌────────────────────────┐  │
│ │                              │  │ ● ON AIR               │  │
│ │        SCREEN                │  │ LOFI BEATS TO STUDY…   │  │
│ │   (the YouTube player)       │  │ 12:04 / 48:10          │  │
│ │                              │  │ PICKED BY MINA         │  │
│ │                              │  │ NEXT ▸ RAIN SOUNDS     │  │
│ │                              │  │ DOOR AJAR·MUFFLED  Q 3 │  │
│ └──────────────────────────────┘  └────────────────────────┘  │
│                                     (VOLUME)   [DOOR SOUND]    │
│ [PAUSE] [SKIP] [OFF] [MUTE] [↗ YOUTUBE]                        │
│ ▸ insert a YouTube link ____________________________________   │
└───────────────────────────────────────────────────────────────┘
  SHELF  [NEXT 1 ▫ title · Kai] [NEXT 2 ▫ …] [▫ title · Mina] …
```

| Part | What it is | Who uses it |
| --- | --- | --- |
| Screen | The YouTube player. It must stay visible and at least 200×200. Covered by "Tuning in…" or "Track over" as today. | Everyone sees it; nobody clicks it |
| Progress bar | Step 8's bar, under the screen, chapter segments marked like a tape counter's scale | Host and moderators drag it; members read it |
| LCD | A text display: status, title, position, who picked it, what's next, your door, queue length | Read only |
| Keys | Pause/Resume; Skip and Off; Mute; Open on YouTube | Everyone; host only; just you; just you |
| When-empty switch | Step 8's setting: `SHUFFLE` or `STOP` | Host moves it; members see where it stands |
| Volume knob | Your volume | Just you |
| Door-sound switch | Step 7's choice for your current door | Just you |
| Tape slot | The link box. Members suggest ("2 of 3 left"); the host plays now or queues | Everyone |
| Shelf | Step 8's rows as cassettes: thumbnail label, title, who. Queued ones first, numbered | Host orders; members withdraw their own |

**LCD by state**

| State | Line 1 | Other lines |
| --- | --- | --- |
| Connecting | `CONNECTING…` | |
| Off | `OFF` | `INSERT A LINK` |
| Tuning | `TUNING…` | Title (known from step 8 before the player loads) |
| On air | `● ON AIR` | Title, scrolling if it doesn't fit; `12:04 / 48:10`; when chapters exist, `CH 3/12 RAINY NIGHT`; `PICKED BY MINA` (or `SHUFFLE`); `NEXT ▸ <title>`, or `NEXT ▸ SHUFFLE` / `NEXT ▸ —` when the lists are empty |
| Paused | `PAUSED` | Title; the position, blinking |
| Track over | `TRACK OVER` | `NEXT ▸ <title>`, or `INSERT A LINK` when the setting is Stop |
| Can't play | `NO SIGNAL` | Title |

The bottom line always shows the door (`DOOR AJAR · MUFFLED`) and the queue length (`Q 3`). While the knob turns it shows volume bars instead.

**Build**

- Position comes from `radioPositionMs` on a 1 s `useNow`; length from `youtube_video.durationMs`, or from the player (`RadioPlayer` emits it) when that's unknown. A live stream shows `LIVE` instead of times.
- LCD type: the app's mono font styled in CSS. Add one self-hosted pixel font only if that doesn't read as an LCD.
- The title scrolls only when it overflows. The LCD's text is decoration for screen readers (`aria-hidden`); the status and title stay in a real heading, as now.
- Knob: a styled wrapper over a native range input, so keyboard and screen-reader support come with it. Drag up or down, or use the wheel.
- Keys: `UButton`s with a pressed-in motion (`whilePress`) and tooltips, disabled while tuning. Members don't see the host keys.
- Grille: bars that move while on air. CSS only; the audio can't be read.
- `prefers-reduced-motion` stops the scrolling title, the blinking and the grille.
- Flat by default: the app's palette, no textures or gradients until a theme pack supplies them.
- At 390 px: the screen is full width, the LCD sits under it, the keys wrap, the shelf scrolls sideways, and every target is at least 44 px.
- Files: `HouseRadio.vue` (cabinet, keys, slot), `RadioLcd.vue`, `RadioKnob.vue`, `RadioShelf.vue`. `RadioPlayer.vue` is unchanged. No protocol change.

**Outline for theme packs.** The radio's look comes from CSS custom properties on its root: `--radio-body`, `--radio-trim`, `--radio-key`, `--radio-lcd-bg`, `--radio-lcd-fg`, `--radio-grille`, `--radio-radius`. Their defaults are Nuxt UI tokens, so light and dark work. In step 12 the theme pack's JSON gains `radio: { slot, skin, frame? }`: where it stands in the scene, values for those properties, and an optional sprite around it. A theme changes the look (boombox, TV, jukebox), never the layout or the controls.

**Checks:** every LCD state in a browser; the whole radio operated by keyboard only; a 390 px screenshot; reduced motion; light and dark.

### Built (Nov 19)

Files: `HouseRadio.vue` (the cabinet: screen, LCD, knob, grille, progress bar, keys, when-empty switch, door-sound switch, tape slot; the theme variables), `RadioLcd.vue`, `RadioKnob.vue`, `RadioShelf.vue` (cassettes), `RadioPlayer.vue`, `DoorSwitch.vue`. `formatTrackTime()` moved to `shared/utils/radio.ts`. No protocol or schema change.

Changed from the design above:

- **The door-sound choice lives only on the radio** now: the switch offers the choices for the door you have now (ajar: Quieter or Muffled; closed: Silent, Quieter or Muffled). The headphone popover by "Your door" is gone. With the door open the switch reads "Your door is open: you hear the radio at your volume."
- **The when-empty switch moved onto the cabinet**, next to the keys. Members see it disabled, with a tooltip saying the host chooses.
- **No `CH 3/12` line**: nothing supplies chapters yet (see step 8, "Chapters, later").
- **LCD type is the app's mono font** (JetBrains Mono); it reads as an LCD, so no pixel font was added.
- **Refusals show on the screen.** When YouTube refuses a track, the screen's cover shows the reason ("No signal here: this video's owner doesn't allow it outside YouTube.") over YouTube's own "Video unavailable" page, and the LCD reads `NO SIGNAL`. The red alert under the screen is gone.
- **Light mode LCD text is primary 700**: the default primary (500) on the pale LCD was too faint (lightness 0.70 on 0.95). Dark mode keeps primary.

Bugs found and fixed while building:

- The LCD and knob column pushed out of the cabinet on wide screens (reported by the host with a screenshot): grid columns sized `3fr 2fr` are at least as wide as their longest unbroken line, the LCD's title. Columns are now `minmax(0, …)`.
- At 390 px the screen stuck out: YouTube's 200 px minimum height at 16:9 is 356 px wide, wider than the cabinet. The single phone column is `minmax(0, 1fr)`, so the screen takes the column's width and stays 200 px tall (YouTube letterboxes it).
- After a reload with a track on air, the player never mounted and the radio sat at "Tuning", keys disabled, behind the loading screen: the server-rendered "off" panel's exit under `AnimatePresence mode="wait"` never finished. The screen now swaps without an exit animation. (The third time `AnimatePresence` held a stale element in this app; prefer fade-ins or CSS transitions for things that change quickly.)
- The knob's indicator used `bg-highlighted`, which isn't a Nuxt UI utility, so it didn't render; now `bg-inverted`.

Verified in a browser (`nuxt dev` on port 3001, throwaway UTF-8 Postgres): LCD lines for Off, Tuning, On air (`● ON AIR`, title, `0:04 / 3:33`, `PICKED BY WILSON`, `NEXT ▸ —`), Paused, Track over (`INSERT A LINK` with Stop and an empty shelf), No signal, and the bottom line (`DOOR AJAR · MUFFLED`, `Q 1`, `VOL ▮▮▮▮▮▮▯▯▯▯ 63` while the knob turns). Keyboard only: the knob's arrow keys changed the volume with a visible focus ring; Tab went progress bar → Pause → Skip → Turn off → Mute → Open on YouTube → Shuffle → Stop → link; Enter paused and resumed; typing a link and Space on "Add to the queue" queued it twice. Tooltips still show on the pressable keys. At desktop width and in a 390 px frame no part sticks out of the cabinet, and every radio button is at least 44 px. Light and dark colors read correctly. Reduced motion: the rules that stop the scrolling title, the blinking and the grille are in the page; the test browser can't emulate the preference, so they weren't seen switching. Screenshots of the whole radio couldn't be taken in this browser (they time out above its small window); the host's own screenshots were used for the overflow and the refusal.

## Step 10: the tuner (done Nov 19)

On an old radio the tuner is not a separate device. It is a lit window with a printed frequency scale and a needle, moved by a knob you twist. So it is added to the step 9 radio: the dial window along the top of the cabinet and a tuning knob beside the volume knob.

Every track that has been on air is a station with its own frequency. The stations are stored on the server, in the Postgres table `radio_track` (created in step 8), so every member and every device sees the same dial, and it survives reloads and deploys. Browsers only cache the list. Turning the dial browses the stations. It never changes what the house hears. From a station, a member suggests the track and the host plays or queues it. The LCD shows the frequency of whatever is on air.

```
┌───────────────────────────────────────────────────────────────┐
│ 88 ·  |  · 92 · | |  · 96 ·  |  · 100 | ·  · 104 · |  · 108   │
│                 ▲ on air          ▼ needle                    │
├───────────────────────────────────────────────────────────────┤
│  screen, LCD and keys as in step 9                            │
│                        (VOLUME) (TUNING) [ADD] [STATION LIST] │
└───────────────────────────────────────────────────────────────┘
```

**Frequencies**

- `radio_track.station` is a plain number: 1 for the first track the house ever played, 2 for the next. It never changes.
- `stationFrequency(station)` in `shared/utils/radio.ts` turns it into a place on the FM band, 87.5 to 108.0 in steps of 0.1 (206 places). Places are handed out spread across the band, not left to right (bit-reversed order: 87.5, 100.3, 93.9, 106.7, …), so five stations cover the dial instead of crowding its left edge. Unit test: 206 stations get 206 different places, and a station always gets the same one.
- Ceiling: 206 stations fill the band. The function already returns a band number, so station 207 is the first on `FM 2`; the band switch is built when the house gets there.
- Shown as `94.3 FM` (decided Nov 19: FM rather than wavelength).

**Server**

- `GET /api/v1/radio/stations` (members) reads `radio_track` joined with `youtube_video` and returns `{ videoId, title, station, plays, lastPlayedAt, addedBy }[]`. The list is fetched over HTTP rather than sent in the snapshot or on the socket, because it can be hundreds of rows and changes only when a new track goes on air.
- `RadioState.station` tells every client which station is on air. A client that doesn't know that station yet refetches the list.
- Adding from the catalog uses step 8's intents with the station's `videoId`: `suggest` for a member (it counts toward their 3), `play` or a queued suggestion for the host. The video is already in `youtube_video`, so YouTube isn't asked again.
- `DELETE /api/v1/radio/stations/:videoId` (host): removes a station. If that track goes on air again it gets a new station.
- When a track becomes a station (decided Nov 19): the moment it goes on air, even if it turns out to be a wrong link or a video YouTube won't play here. The host removes those from the station list. Waiting until a track played to the end would keep them off the dial, but a long mix that someone skips halfway would then never become a station.
- Stations stay forever (decided Nov 19).

**Radio**

- Dial window: a lit scale from 88 to 108 with a tick for each station and a needle. A marker shows the on-air station, and the needle rests there.
- Tuning knob: steps from station to station. It snaps, so the needle is never between stations. Like the volume knob it wraps a native range input, so arrow keys work. Dragging along the dial snaps to the nearest station.
- While browsing, the LCD shows the station under the needle: `▸ 97.1 FM`, the title, `PLAYED 6× · 3 DAYS AGO`, `FIRST PLAYED BY MINA`.
- `ADD` key. Member: suggests it ("2 of 3 left"). Host: Play now or Queue. Disabled when the track is on air or already on the shelf, or the member has 3 open suggestions.
- After 10 seconds without input, or on Escape, the needle goes back to the on-air station and the LCD back to step 9's display.
- On air, the LCD's first line gains the frequency: `● ON AIR 94.3 FM`.
- Station list: a button beside the dial opens a searchable list of every station (title, frequency, plays). The dial is for a glance; finding one track among two hundred needs search. Choosing a row moves the needle there.
- Empty catalog: no ticks, and the LCD says `NO STATIONS YET`.
- Pinia Colada: `useQuery` for the stations, `useMutation` for the host's removal.
- Files: `RadioDial.vue`. `RadioKnob.vue` is reused and `RadioLcd.vue` gains the browsing display.

**Checks:** a track played twice keeps its station and counts 2 plays; the on-air LCD shows that station's frequency; browsing sends nothing to the server and changes nothing for a second tab; a member's add becomes a suggestion and is refused at 3; a track already on the shelf can't be added; the host's remove takes the tick off the dial; a new track appears on a second tab's dial without a reload; the dial works by keyboard only; signed out, the stations endpoint returns 401.

### Built (Nov 19)

Files: `RadioDial.vue` (the window), `RadioStationList.vue` (the searchable list in a modal, with the host's remove), `RadioKnob.vue` (gains `valueText` for `aria-valuetext`, `wheelStep`, `disabled`), `RadioLcd.vue` (browsing display, frequency on air), `HouseRadio.vue` (the tuner's state). Server: `listStations()` and `removeStation()` in `server/utils/radioQueue.ts`; routes `server/api/v1/radio/stations/index.get.ts` and `[videoId].delete.ts`. Shared: `Station`, `stationFrequency()`, `formatFrequency()` in `shared/utils/radio.ts`, with a unit test. No migration and no protocol change.

Changed from the design above:

- **Two add keys for the host** beside the dial, Play now and Queue, plus one Suggest key for a member, then the station list key. The layout has the keys beside the dial window, not beside the knobs: the knob row has no room for four controls and the grille. On phones the keys go under the dial.
- **`NO STATIONS YET` is in the dial window**, not on the LCD: with no stations nothing has ever played, so the LCD says `OFF / INSERT A LINK`.
- **The list refetches whenever a track goes on air**, not only when the station is unknown, so play counts stay right. `ponytail:` the whole list per track change; send only the changed station if the catalog gets big. Another tab sees a removal at its next track change or window focus.
- **The LCD's status line** under a browsed station says `ON AIR NOW`, `ON THE SHELF`, `3 OF 3 SUGGESTIONS WAITING` or `NO SIGNAL LAST TIME`. It also explains a disabled add key, because a disabled key shows no tooltip.
- **Removing the newest station frees its number**: station numbers are `max + 1`, so the next new track takes it (and its frequency). An older removed number is never reused. A counter that never goes back would need a migration; not worth it for a host-only edge.
- **The on-air station can't be removed** (409, "That one is on air. Skip it first, then remove it."); its remove key is disabled. A track that's over can be.
- **Signed out or banned: 401** on both routes; a member removing: 403.
- **Bands**: the dial shows the band the needle is on; the knob steps through every station on every band in order. Nothing else of the band switch is built.

Bugs found and fixed while building:

- With the second knob the grille's 12 bars and fixed gaps couldn't shrink and stuck out past the cabinet (reported by the host with a screenshot). The grille is now `min-w-0` with shrinkable bars and no gap.
- The station list kept its last search when reopened; choosing a row now clears it.

Verified against a throwaway Postgres 18 (UTF-8) in `nuxt dev` on port 3001: 22 protocol checks, all passing. They cover every check above except the browser ones, plus a bad id (400), a removed station's replay (new row, 1 play), and an older removed number not being reused. 8 unit tests. In a browser, host on `localhost`, member on `[::1]`:

- on air `● ON AIR 103.5 FM` for station 6, needle and marker at the same place;
- with the keyboard only, the tuning knob's arrows moved the needle station to station, and the LCD showed `▸ 93.9 FM`, the title, `PLAYED 1× · JUST NOW`, `FIRST PLAYED BY WILSON`, `ON THE SHELF`; Escape and a 10 s wait both brought it back; no socket message was sent while browsing;
- the host queued a station from the dial (`Q 3` → `Q 4`), the member suggested one and reached `3 OF 3 SUGGESTIONS WAITING` with Suggest disabled;
- a new link played by the host put a 7th tick (`97.1 FM`) on the member's dial 0.3 s later, without a reload;
- the station list searched by title (`funk`) and by frequency (`93.9`), choosing a row moved the needle, the on-air row's remove was disabled, and removing a station took the row and the tick away (server list `[1, 3, 5, 6, 7]`);
- a click on the dial at 101.6 snapped to 103.5;
- at 390 px the dial fills the width with 44 px keys under it, and nothing sticks out of the cabinet.

Test-browser note: its shared pane sometimes stops running animation frames (0 frames a second while reporting `visible`). motion-v then never lifts the loading screen or fades the sections in. A fresh tab ran at 53 frames a second and lifted it in 7 s; this is the test browser, not the app.

## Step 11: notes (text chat)

Not in the handoff. Its rules still apply: studying comes first, focus allows only one-tap gestures "such as sliding a note", and richer interaction belongs to breaks. So chat is notes left on the table, and it stays quiet. Notes come before the canvas because they only need the socket; in step 12 they become paper on the table (decided Nov 19).

- `note` (migration `0007_notes`): `id` (client-generated uuid), `userId`, `text` (1 to 280 characters), `createdAt`. Each note is deleted 24 hours after it was sent (decided Nov 19). Without a scheduler that takes three parts: every insert deletes rows older than 24 hours; the snapshot returns only notes younger than 24 hours (the last 50); and each client drops a note from its list when it turns 24 hours old, using the clock offset. So a note disappears on time even if nobody writes for days, and the rows are gone by the next note.
- `ClientMsg`: `{ t: 'note'; noteId; text }`. `ServerMsg`: `{ t: 'note'; note }`. It uses the existing intent path, so a note shows at once and is confirmed by its broadcast.
- Limit: one note a second per socket, counted in memory (a socket lives on one instance).
- Plain text only, rendered by interpolation. No markdown, no clickable links yet.
- Quiet rules: never a sound, a toast, or a panel that opens itself.

  | When | What you see |
  | --- | --- |
  | Break | An unread count on the notes button |
  | Focus | A dot, no count |
  | Your door is closed | Nothing, until you open the door or the panel |

- Sending during focus is allowed and shown quietly (decided Nov 19).
- UI: a slideover opened from the header's controls pill, built with Nuxt UI's `UChatMessages` and `UChatPrompt`. They are installed but made for AI chat; check when building that they suit messages between people (names, no streaming states). The read marker lives in localStorage.
- In step 12 the notes become paper on the table. The data doesn't change.

**Checks:** a note reaches the others and a late joiner's snapshot; 281 characters and an empty note are refused; a burst is limited; a note sent 24 hours ago (backdated in the test) is missing from the snapshot, drops off an open client's list without a reload, and its row is deleted by the next insert; markup shows as text; no badge behind a closed door.

## Step 12: canvas and theme packs

- Add `pixi.js`. A client-only component draws the scene from a theme-pack JSON (backdrop, slots, object sprites) stored in S4.
- The step 9 radio (which contains the YouTube iframe) is positioned over the canvas at the theme's radio slot and skinned by the theme pack (`radio: { slot, skin, frame? }`). Nuxt UI panels sit above.
- Seats (moved from step 5): `member_state.slot` and `{ t: 'sit'; slot }`, publishing `member`. Slot ids come from the theme pack; the server rejects a slot the theme doesn't have.
- First real use of the blob driver. MEGA S4's path-style support was confirmed in step 0.

## Step 13: traces

- Study hours and "studied here 2h ago" from `member_state` history. Design this after the two-week test.

## Step 14: voice (spike first, after the two-week test)

Not in the handoff, and the only item here that needs infrastructure outside Vercel and Postgres. Decide after the two-week test whether the house wants it at all.

**Constraints**

- Vercel functions can't carry audio. The existing socket can carry the call setup (signalling); the audio itself goes over WebRTC.
- Two ways to carry it:

  | | Peer to peer (mesh) | Media server (SFU, such as LiveKit) |
  | --- | --- | --- |
  | How | Every speaker sends to every listener | Everyone sends once, to the server |
  | Good for | About 6 people (rule of thumb, not measured) | A full house |
  | Needs | A TURN relay for networks that block direct connections | A hosted service, or a server next to the database |

**Proposed shape**

- Voice lives at the kettle in the commons, and by default only during breaks.
- The microphone is off until you press it. Nothing joins you to a call by itself.
- Doors apply: open, you are in the room; ajar, you hear it faintly and can't speak; closed, nothing. WebRTC audio can go through Web Audio, so an ajar door can muffle voices for real, unlike the radio.

**Spike questions**

- Mesh with a cap of 6 ("the kettle seats six"), or a media server?
- Which TURN relay, and what it costs. Not checked.
- Does a call survive the socket reconnecting about every 5 minutes? Signalling is only needed at setup, so it should.
- Mobile Safari.
- Echo: the browser cancels the other voices from your microphone but not the YouTube audio from your speakers. Probably turn the radio down while someone talks.

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
