# Online Gathering: design and architecture handoff

Nov 18, 2026 · @TheyAreWaiting

## The idea

An Online Gathering is a small shared study space where friends hear the same music and work alongside each other. This doc records what was decided in one design conversation, so the work can continue in a new chat.

- **Target feeling:** being alone with people in the background. You have company without being in the conversation (parallel play, body doubling).
- **Second goal:** the space should feel like a gathering even when no friends are online.
- **Origin:** a lecture on how MMO convenience features removed the small inconveniences that bonded players.
- **Priority:** studying comes first. Social interaction is a side-product that must not pull people off their work.
- **Builder:** one person, a game designer and full-stack engineer who works in Nuxt 4, Nitro and Unity 6.

## Design principles

The product is a place, not a midpoint between a tool and a game. A library or a café holds tools and play on separate layers, and neither is diluted.

- **The tool is the skeleton.** Timer, music and presence must work even if the window is never looked at.
- **The play is the texture.** It rewards a glance and never asks for one. There are no goals, fail states or streak guilt, so it behaves like a toy.
- **Attention test for any feature:** it works at zero attention and gets nicer at five seconds. Anything needing thirty seconds belongs in a break.
- **Design it as a game, build it as a web app.** The two skill sets apply to different layers of the same project.

## Social model

A private room is a distance from the gathering, not a wall around it. Each member controls that distance with a door.

| Door state | What others see | What you hear |
| --- | --- | --- |
| Open | You at your desk | The living room's music |
| Ajar | Your lamp is on | The room, faintly |
| Closed | A light under the door | Nothing from the commons |

- **Nobody is ever invisible.** Someone alone in their nook still lights a window, so private rooms add to the gathering.
- **Structure:** one instance is a house. A house has one commons (the living room) and one nook per member.
- **Ownership:** whoever hosts the site hosts the gathering, and controls signups.
- **Break rhythm:** the focus timer is the game clock. Focus allows only one-tap gestures, such as sliding a note or refilling someone's tea. Richer interactions unlock on shared breaks.
- **Pull toward the commons:** the kettle sits in the living room. Moves between rooms are never announced, so retreating is not a statement.
- **Traces:** a warm lamp, a mug left out, or "Mina studied here 2h ago" give presence when nobody is there.
- **Upkeep as contribution:** members add tracks to the playlist, water plants, and earn props from collective study hours.
- **One deliberate inconvenience:** rooms could have open hours, or need someone to unlock them.
- **Scenario:** the setting (bar, library, cabin) is a theme pack the host picks.
- **Scale:** add houses, do not enlarge them. Cap a house at a few dozen people.

## Music

Version 1 plays YouTube only, as the room's shared radio. The audio cannot be unified across platforms, so the room syncs a track ID and a timestamp and each client plays locally.

| Platform | What it allows (checked November 2026) | Consequence |
| --- | --- | --- |
| YouTube | Embedded player only, at least 200 by 200 px. Scripted autoplay only once more than half the player is visible. | Usable by anyone. The player must stay on screen. |
| Spotify | Development-mode apps need a Premium developer and allow five authorized users. Extended quota is for organizations, with a threshold near 250k monthly active users. | Works for five friends, not for a public launch. |
| Apple Music | MusicKit on the web. Full tracks need an authorized user with an active subscription; others get previews. | Possible later, subscribers only. |

- **The visible player becomes an object in the room,** such as a TV or boombox.
- **One player instance at a time** keeps memory use down.
- **Spotify and Apple listeners** can show a "what's in my headphones" status instead of shared playback.
- **Not verified:** YouTube's policies are believed to forbid separating audio from video. This was stated from memory, not checked.

## Form decision

Build it as a Nuxt web app with a small 2D canvas for the room, not as a Unity game.

- **The music players are web SDKs and iframes.** A native Unity build would need an embedded webview just to play anything.
- **A Unity web build is heavy** in download size and memory for something meant to sit in a background tab.
- **The runtime state is small and slow-changing:** a door with three positions, a lamp, who sits where, a timer, and a track ID with a timestamp.
- **Unity would be warranted** if the design grows free movement through a 3D space, physics-driven objects, or heavily animated characters.
- **Later option:** wrap the same app in Tauri or Electron as a small always-on-top desktop window. DRM playback inside those webviews is unchecked.

## Architecture

The server never ticks and never streams. It stores timestamps and broadcasts changes, and every client derives the rest. This is a proposal that has not yet been reviewed.

**Deployment**

- One house is one long-lived Node process, shipped as a Docker image. Live state stays in memory.
- SQLite with Drizzle holds durable data. S3 holds theme-pack assets.
- Nitro's WebSockets also run on Deno, Bun and Cloudflare presets if hosting changes later.

**State**

|  | Durable (SQLite) | Ephemeral (memory) |
| --- | --- | --- |
| What | Users, nooks, theme, playlist, traces, study hours | Who is connected, door states, timer, now-playing |
| Changes | Rarely, over REST | Often, over WebSocket |
| On restart | Survives | Rebuilt as clients reconnect |

**Realtime**

- Nitro's built-in WebSocket handler, enabled in Nuxt 4 with `nitro.experimental.websocket: true` in `nuxt.config.ts`.
- Each peer subscribes to a topic. The commons is one topic.
- Clients send intents. The server validates and broadcasts.
- A new connection receives a full snapshot, then deltas.

```ts
// shared/types/realtime.ts
type ClientMsg =
  | { t: 'door'; state: 'open' | 'ajar' | 'closed' }
  | { t: 'sit'; slot: string }
  | { t: 'radio'; action: 'play' | 'pause' | 'skip'; videoId?: string }
  | { t: 'timer'; action: 'start' | 'stop'; minutes?: number }
  | { t: 'ping'; clientMs: number }

type ServerMsg =
  | { t: 'snapshot'; house: HouseState }
  | { t: 'patch'; path: string; value: unknown }
  | { t: 'pong'; clientMs: number; serverMs: number }
```

**Music and timer sync**

- Radio: store `{ videoId, startedAtServerMs, pausedAtMs | null }`. Each client computes `position = serverNow - startedAt` and calls `seekTo` only when drift passes about two seconds.
- Timer: store `endsAtServerMs`. Clients render the countdown locally.
- Clock offset: the ping and pong messages give each client its offset from the server.
- Late joiners compute from the same timestamps, with no special case.

**Rendering**

- A PixiJS canvas in a client-only Vue component draws the scene from a theme-pack JSON (backdrop, slots, object sprites).
- The YouTube iframe is a real DOM element positioned over the canvas at the theme's "TV" slot.
- Nuxt UI renders every panel, layered above the canvas.
- A YouTube embed's volume can change with door state, but it cannot be muffled, because the iframe's audio is not reachable from Web Audio. Ambient sound from the app's own files can be filtered.

**Auth**

- `nuxt-auth-utils` sealed-cookie sessions, with invite codes the host generates.
- The session is checked in the socket's upgrade hook.

## Build order

The first prototype is one room, played with friends for two weeks.

1. Socket, presence and snapshot/patch, with plain DOM rendering
2. Timer
3. Radio sync
4. Doors and nooks
5. Canvas and theme packs
6. Traces

## Open questions

The conversation stopped after the architecture proposal, before choosing which piece to detail first. The suggested starting point was the realtime protocol.

- [ ] Should everyone in a room hear the same music, or does each person bring their own?
- [ ] What does a member see in the first five seconds after opening it?
- [ ] Which piece gets detailed first: realtime protocol, data schema, radio sync, or theme-pack format?
- [ ] Is the long-lived Node process with SQLite acceptable, or is Postgres or another host preferred?
- [ ] What is the exact member cap per house?
- [ ] How do open hours or unlocking work, if they are kept?
- [ ] Does DRM playback work inside a Tauri or Electron window?
- [ ] Do YouTube's policies forbid audio-only playback, as assumed?

## Sources

These were found through web search in November 2026 and read as search excerpts, not full pages.

- [Spotify: Update on Developer Access and Platform Security](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
- [Spotify: February 2026 Web API migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Techzine: Spotify's stricter developer mode rules](https://www.techzine.eu/news/devops/138608/spotify-puts-the-brakes-on-developer-mode-with-stricter-api-rules)
- [YouTube API Services: Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters?csw=1)
- [Apple Developer Forums: MusicKit authorization without a subscription](https://developer.apple.com/forums/thread/704063)
- [Nitro WebSocket docs](https://nitro.build/docs/websocket)
- [NuxtHub: Realtime and WebSockets](https://hub.nuxt.com/docs/features/realtime)
