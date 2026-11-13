# edux: build plan

Deadline: **Fri 20 Nov 2026**. We have 7 days, so we build **one polished level** first and only add a second if time allows.

## 1. Core loop (keep it this simple)
```
Play the level  ->  each action is logged  ->  level ends  ->  impact engine  ->  results screen
(3D, MANIFEST)      {action, count}                         (data + maths)    (year projection + comparisons)
```
The key design choice is that **the 3D scene only sends action events**. All the impact maths and the results screen live outside it. That means:
- the 3D engineer and the logic engineer don't block each other;
- Physics and Education work only in `data/` and text, with no 3D skills needed;
- if MANIFEST gives us trouble, the rest of the game still works.

### Event contract (agree on this on Day 1)
```json
{ "action": "litter_snack_wrapper", "t": 42.1 }
```
`action` must be a key in `data/impact-factors.json`.

### Results-screen formula
```
yearly_amount = per_occurrence * occurrences_per_day * days_per_year(frequency)
equivalent    = yearly_amount / equivalent.per_unit_kg
```
Show the **year** figure, not the per-day one, and finish on a positive "what if" line: "if you'd binned it, you'd have saved X".

## 2. Level 1: "Break time" (MVP)
4 to 6 interactive choices in one small scene, for example a playground or canteen:
1. A snack: wrapper goes in the bin, or gets dropped.
2. A drink: plastic bottle, or reusable bottle.
3. Lights or tap left on in the classroom or toilets.
4. Getting home: car, bus, or walk/bike. This could be shown on the results screen only.

Each choice should be **one obvious interaction**, such as walking up and pressing E or clicking. That means no inventory and no dialogue trees.

## 3. Who does what

| Day | Education | Eng A (3D / MANIFEST) | Eng B (logic / UI) | Physics |
|---|---|---|---|---|
| **1 (Fri 13)** | Target age group and 3 learning goals; pick the level 1 choices | **Get a MANIFEST "hello world" running**; find out what it exports and how it takes input | Repo setup, event log, results screen with dummy data | Pick 4–6 actions; find sources for each |
| **2–3** | Write the results-screen wording and the "what if" lines | Build the scene, player movement, interactable objects, firing events | Impact engine reading `impact-factors.json`; results screen UI | Fill in all values and equivalents with sources; check the maths |
| **4** | Playtest with 2–3 people outside the team | **Integration day**: scene events → engine → results | Integration | Sanity-check numbers on the real screen |
| **5** | Pitch script and slides | Polish: art, sound, juice | Polish, bug fixes, start or title screen | Write the "methodology" slide |
| **6** | Record a backup demo video | Optional level 2 *only if* level 1 is solid | Deploy and build | Help with the pitch |
| **7 (Fri 20)** | **Submit.** Rehearse the 3-minute demo twice | Freeze code by midday | | |

## 4. Rules for a fast week
- **Merge to `main` daily.** Use short branches (`eng-a/scene`, `eng-b/results`), not long-lived ones.
- **Day 4 is integration day.** Don't leave plugging the parts together until Day 6.
- **No number without a source.** Judges will ask "where's 50 kg from?", and having an answer is a strength.
- Fake it first: the results screen should work with hard-coded events by the end of Day 1.

## 5. Open questions (answer on Day 1)
- [ ] What exactly is MANIFEST (web, Unity, Unreal, an asset tool)? Find its docs link and setup steps from the sponsor.
- [ ] Does the build need to run in a browser for judging?
- [ ] What does Track 4 say in its brief and judging criteria? Paste them into this file.
- [ ] Target age (KS2 / KS3?). This affects the wording and the scale of the comparisons.
