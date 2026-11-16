# What If

Our entry for EduX 2026 UK, Track 4. **What If** is a short, kid-friendly life simulation for ages 8–13. You play an everyday scene, like a playground break or your morning routine, and make small choices. At the end of each level, a report shows what those choices would add up to if you made them every day for a year. Then it suggests a better option. The aim is fun first, never scolding.

## Quick start

You need [Node.js](https://nodejs.org) LTS.

```bash
npm install
npm run dev        # then open http://localhost:5173/
```

**Controls:** WASD or the arrow keys to move. Walk up to something, then press **1** or **2**, or click, to choose.

## Structure

| Path | What it is | Owner |
|---|---|---|
| `index.html` | Page shell, HUD and styles | Engineers |
| `src/main.js` | Game loop, input, choice prompts, reports, year view | Engineers |
| `src/game/levels.js` | Levels, objects and the two choices for each (data only) | Education |
| `src/game/impact.js` | Turns choices into yearly figures | Engineers + Physics |
| `src/render/manifest-adapter.js` | **The only file that touches 3D.** It uses Three.js for now; MANIFEST replaces it | Engineers |
| `data/impact-factors.json` | Impact per action. **Values stay `null` until sourced** | Physics |
| `docs/SOURCES.md` | A citation for every number | Physics |
| `docs/PLAN.md` | Day-by-day plan, roles and open questions | Everyone |
| `docs/HANDOFF.md` | Original design notes | |

## How a number gets into the game
1. Physics finds a source and adds a row to `docs/SOURCES.md`.
2. Put the value (per occurrence) into `data/impact-factors.json`, in place of `null`.
3. The game multiplies it by 365, or by 190 for school-day habits, and shows it on the report. Until then, the report says "figure being checked".

## ECHO: Scene 1 (school, VR)

A separate page: `scene1.html`. Monday at school, 2055: the teacher introduces the Echo pilot, you walk to the front and volunteer by picking up the Echo headset.

```bash
npm install
npm run dev        # then open http://localhost:5173/scene1.html
```

- **Desktop:** click *Start on desktop*. Mouse to look, **Space**, **E** or a click to move the teacher's lines on, WASD or arrows to walk once you are asked to, **E** or click to pick up the headset.
- **VR:** same as Scene 2. Trigger moves the dialogue on and picks up the headset you point at.

| Path | What it is |
|---|---|
| `src/echo/scene1-story.js` | State machine and the scripted dialogue (no 3D code) |
| `src/echo/classroom.js` | Classroom, teacher, classmates, screen, headset on the front table |
| `src/echo/scene1-main.js` | VR and desktop input, dialogue, pickup, transition |

The classroom reuses the bedroom's textures, materials, city and headset model (exported from `bedroom.js`), and the dialogue panel lives in `holo-ui.js`, so both scenes share one look. Scene 1 ends on a *Monday — after school* card; set `SCENE1_NEXT_URL` in `config.js` once the bedroom/Haven page exists, or listen for the `echo:transition` event.

## ECHO: Scene 2 (bedroom, VR)

A separate page in this repo: `echo.html`. It does not change the What If game.

```bash
npm install
npm run dev        # then open http://localhost:5173/echo.html
```

- **Desktop:** click *Start on desktop*. WASD or arrows to move, mouse to look, click to interact, **E** to use the phone when close.
- **VR:** open the same page in the headset browser and press *ENTER VR*. Left stick walks, right stick snap-turns, trigger selects. WebXR needs `localhost` or HTTPS (for a Quest over USB: `adb reverse tcp:5173 tcp:5173`).

| Path | What it is |
|---|---|
| `src/echo/story.js` | State machine and the scripted dialogue (no 3D code) |
| `src/echo/bedroom.js` | Room, furniture, lights, phone, headset |
| `src/echo/holo-ui.js` | World-space holographic panel and buttons |
| `src/echo/main.js` | VR and desktop input, interaction, transitions |
| `src/echo/config.js` | Where each branch goes next (`NEXT_SCENE_URL`) |

The choice is saved as `tuesdayChoice` (`meetJamie` or `stayInHaven`) in `localStorage` under `echo.tuesdayChoice`; read it with `loadTuesdayChoice()` from `story.js`. When the player chooses, the page also fires an `echo:transition` event. Until the classroom and Haven scenes exist, a placeholder card is shown.
