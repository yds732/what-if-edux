# ECHO: Between Two Worlds

A ten-minute first-person story for ages 11–14, set in 2080. You volunteer to test **Echo**, an AI companion headset, for one school week. In **Haven** your companion Lumi adores everything you do; in the real world a classmate, Jamie, sometimes disagrees with you. On Friday you help your city decide who should get Echo.

Built for EduX 2026 UK, Track 4 (*Immersive Worlds for Future Citizenship*). The script, its three decisions and its "no score" rule come from the team's design document; the learning frame is Gilligan's ethics of care.

Runs in a desktop browser (mouse and keyboard), on phones and tablets (touch), and in a WebXR headset.

**Play it:** https://echo-between-two-worlds.vercel.app

## Run it

Needs [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run dev        # http://127.0.0.1:5173/
npm run build      # type-check, then bundle to dist/ (static files, host anywhere over HTTPS)
```

| Input | Walk | Look | Use / throw | Next line | Take headset off | Pause |
|---|---|---|---|---|---|---|
| Keyboard + mouse | WASD / arrows | mouse | `E` or click; hold and release to throw | `Space` | `Q` | `P` / `Esc` |
| Touch | left thumb | right thumb drag | tap the thing; hold and release to throw | tap | tap | button, top right |
| VR controllers | left stick | head; right stick snap-turns | trigger (point with the right hand) | `A` | `B` | take the headset off |

Graphics start on a tier picked for the device (headsets and phones low; tablets and laptops on integrated graphics medium; otherwise high) and the internal resolution adapts to hold the frame rate. The tier also picks how heavy the models are: the three worlds come to about 12 MB on low, 22 MB on medium and 47 MB on high, fetched as each world is first entered. Each game of the arcade fetches its own code and one to four megabytes of models the first time its gate is stepped through. Settings has the override. Players who ask their device for reduced motion get softer flashes and camera kicks.

WebXR needs a secure origin: the deployed site has one; a copy you host needs HTTPS (or `localhost`) for *Play in VR* to appear in a headset's browser. To try a Quest against the dev server on your own machine, connect it by USB, run `adb reverse tcp:5173 tcp:5173`, and open `http://localhost:5173` in the headset's browser.

The site deploys itself: every push to `main` that touches `echo/` runs `.github/workflows/deploy-echo.yml`, which deploys to Vercel using the `VERCEL_TOKEN` repository secret (`vercel.json` holds the build settings). To deploy by hand instead, run `npx vercel deploy --prod` in this folder, logged in to the Vercel account that owns the project. The upload is about 97 MB, nearly all of it models (the arcade's are 15 MB of that); Vercel's Hobby plan accepts up to 100 MB from the CLI, so on that plan there is room for very little more.

## MANI Engine

Open **ECHO – Between Two Worlds** in MANI and choose **Test** to play. The editor opens in Haven with the simulation paused. Both releases use the game in `src/`. The MANI file embeds the game code, styles and fonts. It loads models, pictures and dialogue recordings from the web release over HTTPS and imports the matching Three.js version from jsDelivr.

Run `npm run build:mani` to generate `mani/dist/scene.html`. Run `npm run verify -- MANI` to build and exercise the single file in Chrome, including headset emulation. Publish gameplay changes to the existing MANI project (`ECHO_Between_Two_Worlds_20261120_061734`) after deploying any changed assets to Vercel. Pull the current scene first and preserve its editor change table when updating it. Vercel deploys and MANI project updates are separate releases.

## Haven Arcade

Beside the week's story there is an arcade: an isle in Haven with five gates, each onto a small game of its own. **Haven Arcade** on the title screen goes there (so does the end screen); walk up to a gate and step through. Every game is played with one pointer and one button: the mouse, a finger, or a VR controller's ray and trigger. Each has three stages, moving on with every win, and keeps the most stars it has been won with on its gate.

| Gate | The game |
|---|---|
| **Moonlight Rally** | Table tennis against Kai, first to seven. The bat follows the pointer (in a headset it is in your hand); swing through the ball. |
| **Sprite Duel** | A turn-based duel: three of Haven's sprites against Nova's three. Ember burns Bloom, Bloom drinks Tide, Tide douses Ember. |
| **Lantern Lights** | Jewels in a loom: line up three of a kind and their light flies to its lantern. Light them all before the moves run out. |
| **Driftlight** | A raft on the tide at dusk. Hook in glow for the lantern and wood to lay the raft wider, bring three sprites aboard, see the tide wyrm off, reach the lighthouse. |
| **Duskbreak** | Lead a flock of lantern sprites down a bridge of light. Gates make them more or fewer (plus, minus, times, divide: take the better one, or slip between two bad ones); they relight the gloom by themselves. |

The companions are as they are in the story: nobody in Haven ever tells you that you played badly. That is Haven's character, not an oversight.

## How it is put together

The people, furniture and scenery are generated models: each was designed as a reference sheet with OpenAI's image model, turned into a 3D model (and, for people, rigged) by Tripo, then simplified and compressed for the browser. How that is done, and how to change or add one, is in [`tools/assets/README.md`](tools/assets/README.md). Skies, water, light and every effect are shaders, and Haven's meadow (its grass, reeds, blossom tree and floating lanterns) is drawn by code. Non-player characters have recorded ElevenLabs voices. Player dialogue uses the original typing sounds. Web Audio mixes the dialogue with synthesised music and effects. three.js is the only library the game runs on; IWER, a headset emulator, is fetched only if you ask for it with `?xr=emulate`.

| Path | What lives there |
|---|---|
| `src/story/script.ts` | Every word of the game, in one place |
| `src/story/chapters/` | One async function per day; they read like the script |
| `src/story/Director.ts` | The verbs chapters use: say, choose, wipe one world into another |
| `src/world/` | The three places: `classroom/`, `bedroom/`, `haven/`, plus the city outside the windows |
| `assets/` | The art bible and the catalog of every generated asset; its design sheets |
| `public/assets/` | What the game loads: models at three weights, pictures, and the manifest that lists them |
| `src/assets/` | Loading them, and making their painted lights shine |
| `src/characters/` | People: a generated figure driven by the game's own animator, a face drawn on it by shader, gestures as data |
| `src/game/` | The orb game: `throw.ts` is its physics as pure functions |
| `src/arcade/` | The arcade: `Arcade.ts` takes the player through a gate and back, `Minigame.ts` is what a game is, `script.ts` holds its words. Each game is a folder: its rules as pure functions with tests (`physics.ts`, `battle.ts`, `board.ts`, `voyage.ts`, `march.ts`) and a world that draws them |
| `src/player/`, `src/input/` | First-person body and hands; keyboard, touch and XR feeding one `Input` |
| `src/ui/` | The HUD as canvas-drawn panels (flat overlay on screens, a floating sheet in VR); DOM menus |
| `src/render/` | HDR pipeline: ambient occlusion, bloom, light shafts, depth of field, grade, and the dissolve between worlds |
| `src/audio/` | Web Audio synthesis behind the `GameAudio` interface |

## Checking it

```bash
npm run verify                 # everything below, in order (about 45 minutes, a third of it the arcade); starts its own server if none is running
node tools/verify.mjs story touch   # or only the steps whose names contain these words
```

One step at a time, with `npm run dev` left running:

```bash
npm run typecheck
npm test                       # unit tests: throw physics, collision, scheduler, script integrity
node tools/audio-check.mjs     # renders every soundscape, effect and voice offline and measures levels and leaks
node tools/e2e.mjs             # plays the whole week on autopilot for three branch sets; fails on any console error
node tools/e2e.mjs --xr=1      # the same inside an emulated Quest 3 session
node tools/input-test.mjs      # real key and mouse events: every walk, take an orb, throw, choose, pause
node tools/touch-test.mjs      # an emulated phone with real touch events: stick, taps, choice cards, hold to throw
node tools/xr-test.mjs         # emulated VR controllers: stick, snap turn, point, trigger, A and B
node tools/ui-shots.mjs        # title, chapters, settings, pause and end screens at desktop, tablet and phone sizes
node tools/arcade-test.mjs     # the arcade isle and each game played to its end with real mouse and touch events
node tools/arcade-test.mjs drift driftTouch   # (or only some of them: hub, rally, duel, lights, drift, dusk, each with ...Touch)
node tools/arcade-xr-test.mjs  # each game in an emulated headset: the controller is its pointer
node tools/shot.mjs name "chapter=tuesday&auto=1&until=tuesday.decision"   # one frame at a story beat
node tools/shot.mjs name "shot=haven&eye=0,1.4,4&at=0,2,-20"               # one world, any camera
node tools/shot.mjs name "play=drift&auto=1&until=drift.ready&after=20"   # a game of the arcade, twenty seconds in
node tools/burst.mjs name "play=duskbreak&auto=1&until=dusk.ready&after=8" --frames=8 --step=0.3   # a run of frames, to judge motion
node tools/probe.mjs "play=drift&auto=1&speed=4" "window.__game.arcade.active.voyage.light"       # watch a value while a game plays
```

The autopilot is put where it needs to be and answers for itself, so it cannot tell whether a person could have got there. The input, touch and controller tests exist for that: anything a player has to do is done in them with real events.

Two things no tool here can check: how the game sounds to an ear (levels, clipping and leaks are measured; taste is not), and how it feels in a real headset (the emulator proves the session, the controls and the pointing ray, not comfort or frame rate on the device).

The capture tools need a local Chrome; they run it headless on the real GPU and write to `shots/`. `tools/sheet.py` tiles captures into a contact sheet and `tools/crop.py` enlarges a region of one (both need Pillow). `?shot=studio&subject=cast&who=lumi,jamie&gesture=wave` is a viewer for characters, hand poses and single models.

The arcade's difficulty was set by simulation, not by people: each game's rules are played thousands of times by scripted players of different skill in its unit tests (`tests/unit/rally-balance.test.ts`, and the fairness cases in `sprites`, `lanterns`, `drift` and `dusk.test.ts`), which print what became of them with `npx vitest run --silent=false`. That shows a stage is fair and that stars tell good play from poor; whether it is fun at that setting is for a person to say.

Useful URL parameters while developing: `?arcade=1` starts on the arcade isle and `?play=rally|sprites|lanterns|drift|duskbreak` inside a game (`&level=0..2` picks its stage, `&skill=0..1` how well the scripted player plays it); `?chapter=wednesday` starts at a day, `&auto=1` lets a scripted player make every move (`&tue=meet|haven&thu=help|haven&policy=expand|combined|investigate`), `&handover=tuesday.decision` makes it stop at a story beat and give you the controls, `&speed=8` runs time faster, `&q=low|medium|high|ultra` pins the graphics tier, `&xr=emulate` enters an emulated headset.

## Where it departs from the design document

- Monday ends with a first look at Haven and Lumi's welcome; the Star Bridge challenge opens Tuesday. The document puts both the headset moment (Monday) and the challenge (Tuesday) in one continuous scene.
- The orb challenge stays wordless, as specified. Lumi cheers every throw, hit or miss, in gesture only.
- Running out of orbs on Tuesday restarts the challenge at once with one new line from Lumi. Aim help grows after each miss.
- Three things the document leaves open are filled in: the welcome-poster phrases, the two sentences Jamie rehearses on Thursday, and place names on the title cards.
- The end screen lists the three choices made. It gives no score and no judgement.
- A week started from the chapter list has no earlier days: Jamie's Wednesday greeting leaves Tuesday out, and the end screen lists only the choices that were made.
- The arcade is an addition. The document asks for one challenge (the orbs) and no other games; the arcade stands outside the week, behind its own button, and nothing in the story depends on it or leads to it. Its isle is part of Haven's scenery during the story, with its gates dark.

## Credits

Models and pictures were generated for this game with OpenAI's image model (design sheets) and [Tripo](https://www.tripo3d.ai) (3D models and rigs). [three.js](https://threejs.org) (MIT); [glTF Transform](https://gltf-transform.dev) and [meshoptimizer](https://meshoptimizer.org) (MIT) in the asset tools. Typefaces: [Inter](https://rsms.me/inter/) and [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant) (SIL Open Font Licence). VR emulation in tests: [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) (MIT).
