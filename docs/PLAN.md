# What If: build plan

Deadline: **Fri 20 Nov 2026**. The design is in `HANDOFF.md`: four levels plus a year view. **Level 1 (Playground) and Level 2 (Morning routine) are playable** now, using placeholder boxes. Levels 3 and 4 are added as data in `src/game/levels.js`.

## Core loop
```
Walk up to an object  ->  choose 1 of 2  ->  choice logged  ->  level report  ->  ... -> year view
(3D, adapter)            (HTML overlay)      (impact.js)        (x 365 or x 190)         (top 2 things to change)
```
The 3D scene is kept separate from the maths: only `src/render/manifest-adapter.js` touches 3D. So MANIFEST can be swapped in without touching the levels, the maths or the reports, and Physics and Education never need to touch 3D code.

## Who does what

| Day | Education | Eng A (3D / MANIFEST) | Eng B (game / UI) | Physics |
|---|---|---|---|---|
| **1 (Fri 13)** | Set 3 learning goals; check the wording in Levels 1–2 | **Get MANIFEST's SDK or docs; run its hello world** | Play-test the loop, fix bugs | Source the Level 1 numbers |
| **2–3** | Write Levels 3–4 (as data); report wording | Re-implement the adapter in MANIFEST; real models for Level 1 | Polish the reports, title screen, sound | Source the Level 2 numbers and all equivalents |
| **4** | Playtest with 2–3 people outside the team | **Integration day** | Integration | Check the numbers on the real screen |
| **5** | Pitch script and slides | Art polish | Deploy (static build: `npm run build`) | Methodology slide |
| **6** | Record the 2–3 minute demo video | Optional: Levels 3–4 scenes | Bug fixes | Help with the pitch |
| **7 (Fri 20)** | **Submit.** Rehearse twice | Code freeze at midday | | |

## Rules
- Merge to `main` every day, using short branches (`eng-a/manifest`, `eng-b/reports`).
- **No number without a source.** Values stay `null` until they're in `SOURCES.md`.
- Child safety: no accounts and no personal data.

## Open questions
- [ ] **MANIFEST:** which SDK, embed or API? Is there a sample project? Ask the sponsor.
- [ ] Track 4 brief and judging criteria (cambridgeedtech@cambridgesu.co.uk). Paste them here.
- [ ] Does judging need a hosted build, or is the video enough?
