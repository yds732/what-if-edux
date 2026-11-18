# VR handover

Status: **not started on purpose.** This file is the brief for the work. Do not implement it until the team says go.

## Where VR stands today

Echo is already one codebase that runs on desktop, touch and WebXR headsets. There is no separate VR build, and there should not be one.

Already working:
- `renderer.xr` is enabled. A *Play in VR* button appears on a secure origin. `?xr=emulate` starts an emulated Quest 3 (IWER).
- `src/input/XRRig.ts`: two controllers that feed the shared `Input`. Left stick walks, right stick snap-turns 30°, the trigger uses or throws (with a pointing ray from the right hand), `A` moves to the next line and `B` takes the headset off.
- In a headset the HUD is drawn as a floating sheet instead of a flat overlay (`src/ui/`).
- Headsets get the `low` graphics tier (`src/app/quality.ts`), and the resolution governor is off while presenting.
- In a headset, world changes use a plain fade instead of the sphere wipe (`Director.wipeTo`), and line advancing is handled differently (`Director`, around line 268).
- `node tools/xr-test.mjs` covers the session, sticks, snap turn, pointing, the trigger, and `A`/`B` in the emulator.

Not proven: comfort and frame rate on a real headset. The emulator can't measure either.

## What "make it a VR game" means

The goal is to make VR the main way to play, with desktop still working. The work, in priority order:

### 1. Comfort (must have)
- **Never turn the player's head for them.** The story calls `player.faceToward(...)` about 26 times (in `story/chapters/*`). In a headset each of these must become a cue instead of a camera rotation: Lumi or a sound, glow or arrow in that direction. The position can be set, but the yaw must never be forced. Gate it in `Player.faceToward` behind `renderer.xr.isPresenting`.
- **No forced camera motion.** `d.walkTo` and `d.stepTo` move the body. In VR, use a short fade-and-teleport, or let the player walk there themselves with a floor marker.
- **Flashes and kicks:** `app.fx.flash`, screen-edge glows and camera kicks should be weaker in XR, the same way reduced motion already handles them.
- Add a **vignette while moving with the stick**, and an optional teleport locomotion mode in Settings.
- Seated scenes (the classroom desk, the bedroom chair): keep the seat yaw relative to the headset, and don't fight the player's real head.

### 2. Hands and interaction (must have)
- Today the trigger picks the nearest focused `Interactable`. VR wants **direct grab**: reach out and squeeze grip near an object (light orb, gem, phone, headset). `src/player/Interaction.ts` would get a second "touch" focus mode that uses the grip position.
- **Throwing orbs** (`src/game/StarBridgeGame.ts`, `throw.ts`): use the controller's real velocity on release instead of the charge bar.
- **Taking the headset off** is the game's key moment. In VR it should be a gesture: both grips near the face, then pull down. Keep `B` as a fallback.
- **Phone** (`openPhone`, `chat`): show the chat on a phone held in the left hand rather than on the desk hologram, and scroll it with the stick.
- **Choices** (`d.choose`): world-space buttons you point at or poke. Lumi's "Stay" (big) and "Leave" (small, grey) should keep their size difference in 3D.

### 3. Text and UI (must have)
- Subtitles, objectives and side tasks: a world-locked panel about 1.5 m away, a little below eye level, that follows the view lazily. Minimum text size about 1.2° of view. Check every canvas panel (`ui/draw.ts`, `BedroomWorld` hologram, wall ping).
- DOM menus (`ui/dom/menus.ts`) don't exist inside a headset. Pause, Settings and the title screen need world-space versions, or must be reachable before entering VR.

### 4. Performance (must have)
- Target 72 fps on Quest 2 and 90 fps on Quest 3, so about 11–13 ms per frame for both eyes.
- In XR, turn off the heavy post passes: AO, light shafts, depth of field and most of the bloom (`render/PostPipeline.ts`). Check whether XR rendering skips the post pipeline at all. If it doesn't, add a cheap tone-map-only path.
- Grass: `buildGrass` count × `q.density` is already one instanced draw. Measure it on the device before cutting it.
- Bake shadows on `low`. Watch draw calls (127 in Haven on desktop) and aim for under 100.
- Use fixed foveation (`renderer.xr.setFoveation(1)`) and a framebuffer scale below 1 if needed.

### 5. Nice to have
- Hand tracking (no controllers) using pinch to select.
- Haptics on ring hits, the task chime and Lumi's pleas (`gamepad.hapticActuators`).
- Spatial audio already exists (`audio.sfx(..., { at })`). Check that Lumi's voice comes from Lumi.

## How to do the work

1. Make a branch, for example `vr-first`, and never put this work straight on `main`. `main` auto-deploys.
2. Work through the sections in order. Each change must keep desktop working: gate VR behaviour behind `renderer.xr.isPresenting`, or behind one helper such as `game.inXR`.
3. Extend `tools/xr-test.mjs` for each new interaction (grab, throw velocity, headset-off gesture, world-space choices).
4. Run `npm run typecheck`, `npm test` and `node tools/e2e.mjs` after every step, plus `node tools/e2e.mjs --xr=1` for the headset path.
5. Test on a real Quest before merging: `adb reverse tcp:5173 tcp:5173`, then open `http://localhost:5173`.

## Prompt to give Claude when we start

> Read `echo/VR-HANDOVER.md`. Make a branch `vr-first` from `main`. Work through section 1 (comfort) first. Find every `faceToward`, `walkTo` and `stepTo` in `src/story`, and make them comfort-safe when `renderer.xr.isPresenting` is true: no forced yaw, fade-teleport instead of forced walking, cues to draw the eye. Desktop must behave exactly as before. Extend `tools/xr-test.mjs` to assert that the camera yaw never changes unless the player turns. Run the typecheck, the unit tests, `tools/e2e.mjs` and `tools/e2e.mjs --xr=1`, commit after each working step, and don't push or merge until I've tried it on a headset. Then propose section 2 before starting it.
