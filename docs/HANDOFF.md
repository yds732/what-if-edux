# Handoff: What If (EduX 2026, Track 4)

Read this first if you are picking up the project in Claude Code.

## The idea
A fun, kid-friendly life-simulation game (target ages roughly 8 to 13). The player plays a short scene, such as a playground break, making small everyday choices. At the end of each level, a report shows what those choices would add up to if repeated every day for a year: for example, not throwing away trash, or leaving the tap running.

Tone: the game is fun first. Avoid scolding. Each reveal says "you didn't know, now you do" and shows a better option.

## Planned structure
Four short levels, then a year summary:
1. Playground break: snack wrapper, water fountain or bottle, swing or wall
2. Morning routine: tap while brushing teeth, shower length, reusable bottle
3. Classroom: printing, pencil or pen, reusable lunchbox
4. Shopping trip: bag choice, pack size, food waste
5. Year view: one counter of choices x 365, plus the top two things to change

Each level has three choices. Each choice has a hidden consequence shown at the end.

## Hackathon scope
Build Level 1 fully, including the reveal and the year view. Levels 2 to 4 are data entries in `src/game/levels.js`, using the same mechanic.

## Current code
- `index.html`, `src/main.js`: page shell, game loop, end-of-level report
- `src/game/levels.js`: level definitions (data)
- `src/game/impact.js`: maps actions to impacts and builds the report
- `src/render/manifest-adapter.js`: the only file that touches the MANIFEST 3D SDK (currently a Three.js placeholder)
- `data/impact-factors.json`: impact numbers. ALL VALUES ARE PLACEHOLDERS.
- `docs/SOURCES.md`: a citation is needed for every impact number before it is shown
- `README.md`: build plan and team roles

Not yet run. First step: `npm install` then `npm run dev`.

## Open questions
- MANIFEST: which SDK, embed or API does the sponsor expect? Is there a sample project?
- Track 4: the full brief is not on the public challenge page. Ask cambridgeedtech@cambridgesu.co.uk.
- Impact numbers: find a source for each one, and note the assumptions (flow rate, duration) on screen.
- Child safety: no accounts, no personal data collection. Check the UK Age Appropriate Design Code if the game is published.

## Team
- Education: level scripts, reveal wording
- Engineers (x2): game loop, scenes, MANIFEST integration
- Physics: sourced impact figures
