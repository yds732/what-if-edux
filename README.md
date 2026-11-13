# edux

Our entry for EduX 2026 UK, Track 4.

**What it is:** a short, interactive 3D life simulation. You play through an ordinary day, such as school, the playground or a snack break. At the end of each level, a results screen shows the environmental impact of what you did, scaled up to a year and compared with things people can picture.

> e.g. "You didn't bin your snack wrapper. Do that every school day and it adds up to **X kg** of plastic a year, about the same as **Y**."

- The game plan, roles and timeline are in [`docs/PLAN.md`](docs/PLAN.md).
- The impact numbers are in [`data/impact-factors.json`](data/impact-factors.json). Every number must have a source.

## Team
| Role | Owns |
|---|---|
| Education | learning goals, level scripts, results-screen wording, pitch |
| Engineer A | 3D scene and player interaction (MANIFEST) |
| Engineer B | game state, event log, impact engine, results screen |
| Physics | impact model: factors, sources, unit conversions, "equivalent to" comparisons |
