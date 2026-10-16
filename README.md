# BLASTWATER

**Last one above water wins.** A single-player, third-person bomb arena for desktop and landscape mobile browsers. Eight combatants land on a small island, loot bombs, fight each other, and race the rising tide.

Built during the Twigpine Project Treetop Games round, 9–16 October 2026.

## Play locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. For a production bundle, run `npm run build`; the output is a Cloudflare Worker artifact in `dist/` that serves the game and a global leaderboard API. Local Vite development serves the game UI but does not provide the database API.

The published game's **Source Code** link downloads `source.zip`, a snapshot of the original source files and dependency lockfile.

## Controls

| Action | Control |
| --- | --- |
| Move / look | WASD / mouse |
| Sprint / crouch / hop | Shift / C or Ctrl / F |
| Charge and throw | Hold and release left click |
| Switch bomb | 1 / 2, Q / E, or scroll |
| Radar pulse | Space |
| Pause | Esc |

On a phone, rotate to landscape. The left stick moves; drag on the right side to look. Hold **THROW** to charge and release to fire. On-screen buttons handle sprint, crouch, hop, radar, and bomb switching.

Standard controllers: left stick moves, right stick looks, RT charges/throws, X pulses radar, Y switches bombs, LB sprints, A hops, B crouches, and Start pauses.

Click **Drop into the island** to capture the mouse pointer. If capture is released, use **Resume** to return to the match.

The first match opens a short **How to Play** guide before the game starts. A field guide in the HUD then walks through moving, throwing, radar, and restocking. Press **H** during a match or choose **How to Play** from the pause menu to see the guide again.

## Game rules

- Timer bombs bounce and explode after a short fuse. Impact bombs explode on contact.
- A direct hit is lethal. Nearby blast damage falls with distance; large rocks block blasts.
- Glowing crates restock bombs. Eliminated opponents drop chips to collect.
- Radar reveals opponents for two seconds and broadcasts your position to nearby bots. It recharges in eight seconds.
- The tide rises every 60 seconds, dealing damage to anyone caught below it.
- The final survivor wins. Restart is immediate, and the best score is saved in local storage.
- At the end of a match, enter a nickname to post points to the global top-ten leaderboard. Points are seconds survived + 80 per kill + 30 per chip + 400 for victory. The leaderboard retains each device's best submitted score.

## Implementation

Three.js renders a procedural low-poly island and characters. The game loop, bot combat, projectile motion, explosion checks, audio effects, and HUD are implemented in original JavaScript. Art uses procedural geometry and colors; sound is synthesized with Web Audio. The first version uses lightweight custom collision and steering to stay fast in a browser. No account is needed to play. A small Worker and D1 database store posted leaderboard scores. Score posts use a browser-generated device ID and a nickname; competitive anti-cheat is outside this prototype.

## Credits and rights

- Game design and code: BLASTWATER project.
- 3D engine: [Three.js](https://threejs.org/) (MIT license).
- Build tool: [Vite](https://vite.dev/) (MIT license).
- Art and audio assets: original procedural graphics and synthesized sound; no third-party asset files.

The game contains no characters, logos, or music from other games.
