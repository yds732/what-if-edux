# ECHO: Between Two Worlds

EduX 2026 UK, Track 4: *Immersive Worlds for Future Citizenship*.

**Play it:** https://echo-two-worlds.vercel.app (desktop browser, phone, tablet or WebXR headset; no install, no account)

## The problem

AI companions are arriving in young people's lives faster than anyone is teaching them how to think about them. A companion that always agrees is comfortable. Real people disagree, ask for things, and sometimes need you at an inconvenient moment. Students aged 11 to 14 are already making choices between the two, usually alone and without anyone asking them to notice what those choices cost.

Most digital-citizenship teaching treats this as rules (screen time, safety, privacy). It rarely gives students a safe place to feel the pull of a perfect companion, choose, and then look back at who was cared for and who was left out.

## What it does

It's 2080, and you volunteer to test **Echo**, an AI companion headset, for one school week. In **Haven**, a dreamlike virtual world, your companion Lumi agrees with everything you do. In the real world, your classmate Jamie sometimes disagrees, and sometimes needs you.

- **Monday to Thursday** set your own needs against someone else's. On Tuesday you choose between meeting Jamie and staying in Haven. On Thursday Jamie asks for help while you are mid-game in the Haven Arcade.
- **Friday** widens the question to the whole community: your class votes on who should get Echo (expand it widely, expand slowly alongside in-person clubs, or wait and investigate). You see a best case and a worst case for the option you choose.
- **The end screen** lists the three choices you made and asks three reflection questions: *Whose needs matter? What makes us feel truly understood? What does it mean to care for a whole community?*

It takes about ten minutes. No choice is marked right or wrong, and there is no score.

Beside the story there is the **Haven Arcade**: five small one-button games (table tennis, a sprite duel, a match-three, a raft voyage and a flock runner). These are what make Haven tempting. Nobody in Haven ever tells you that you played badly, and that is the point.

## How Echo helps

- **It makes an abstract question felt.** Students don't discuss a hypothetical AI companion. They spend time with one, enjoy it, and then have to leave it when a real person needs them.
- **It is grounded in Carol Gilligan's ethics of care.** The story moves from **self** (Monday, Tuesday) to **other** (Wednesday, Thursday) to **community** (Friday). Each step asks whose needs a choice meets and whose it leaves out.
- **It has no score.** Because nothing is graded, students choose what they actually would, not what they think the teacher wants. The reflection afterwards works with real choices.
- **The cost is built into every option.** Each Friday policy has a good future and a bad one, and the closing line is *"Every choice helped someone. But every choice also came with a cost."*
- **It is safe by design.** It has no accounts and no personal data, and nothing is sent anywhere. It runs in a browser on hardware schools already have.

## How to use it in education

A suggested one-lesson plan (about 50 minutes) for Key Stage 3 PSHE, citizenship or computing:

1. **Before (5 min).** Ask: *Would you want a friend who always agrees with you?* Take a show of hands, but don't discuss it yet.
2. **Play (15 min).** Each student plays the week on a laptop, tablet or phone, with headphones. A headset is optional, and one per group is enough. Students make their own choices.
3. **Compare (10 min).** In pairs, students compare the three choices on their end screens. Where did they differ, and why?
4. **Discuss (15 min).** Use the three reflection questions from the end screen as the discussion structure. For Friday, group students by the policy they voted for and have each group argue the *worst* case of their own choice.
5. **After (5 min).** Return to the opening question. Has anyone's answer changed?

Other ways to use it:

- **Replay with a different choice** to see how the week changes. The paths rejoin, so a second play is quick.
- **Start at a single day** from the chapter list (for example, Friday's vote only) when there is less time.
- **Use the Friday vote as a debate prompt** in a citizenship unit on technology policy.

The game needs no setup beyond opening the link. Schools that want to host their own copy can deploy the static build to any HTTPS host (see [Quickstart](#quickstart)).

## Benchmark

All figures were measured from this repository on 19 Nov 2026 (`echo/`, Node 22, Windows).

**Codebase**

| | |
|---|---|
| Game source | 110 TypeScript files, ~26,400 lines |
| Story script | every line of dialogue in one 432-line file (`echo/src/story/script.ts`) |
| Story | 5 school days, 3 decisions, 3 endings × best and worst case |
| Arcade | 5 games × 3 stages each |
| Runtime dependencies | 1 rendering library (three.js); sound is synthesised in code |
| History | 112 commits, 17 pull requests, 13–19 Nov 2026 |

**Tests**

| Check | Result |
|---|---|
| Unit tests (`npm test`) | **126 / 126 passing** in 9 files, 3.1 s |
| End-to-end | whole week autoplayed on 3 branch sets, on desktop and in an emulated Quest 3 |
| Input coverage | real keyboard/mouse, touch (emulated phone) and VR-controller events |
| Full verification (`npm run verify`) | about 45 minutes, all steps |

**Build and download size**

| | |
|---|---|
| Production build | 0.45 s (Vite) |
| JavaScript | 1.6 MB raw, **~485 KB gzipped**, split so each arcade game loads only when it is opened |
| 3D models | 183 files at three quality tiers: low 11.6 MB, medium 38.1 MB, high 46.7 MB in total |
| Per-session download | about 12 MB (low) / 22 MB (medium) / 47 MB (high), fetched as each world is first entered |
| Frame rate | the graphics tier is picked per device and internal resolution adapts to hold the frame rate |

**Arcade fairness (by simulation)**

Difficulty was tuned by scripted players of different skill, run thousands of times in the unit tests. Two examples:

*Moonlight Rally (table tennis vs Kai), matches won out of 40:*

| Kai's level | Capable player | New player |
|---|---|---|
| Friendly | 40 | 40 |
| Keen | 40 | 21 |
| Fierce | 32 | 1 |

*Lantern Lights (match-three), win rate by stage:*

| Stage | Careful | Casual | Careless |
|---|---|---|---|
| First Light | 93% | 65% | 43% |
| Evening | 93% | 60% | 27% |
| Festival | 75% | 43% | 13% |

These numbers show that the stages are fair and that stars separate good play from poor play. They don't show whether students find it fun or whether it changes how they think. That still needs classroom playtesting.

## Quickstart

Needs [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/yds732/what-if-edux.git
cd what-if-edux/echo
npm install
npm run dev        # http://127.0.0.1:5173/
npm test           # unit tests
npm run build      # type-check and bundle to echo/dist/ (static, host anywhere over HTTPS)
```

Controls, URL parameters for jumping to a day or a game, the full test suite and deployment are in [`echo/README.md`](echo/README.md).

## Repository layout

```
what-if-edux/
├── echo/                    the game (everything that ships)
│   ├── src/story/           script.ts (every word) and chapters/ (one file per day)
│   ├── src/world/           classroom, bedroom, Haven, and the city outside
│   ├── src/arcade/          the Haven Arcade and its five games
│   ├── src/characters/      people, faces and gestures
│   ├── src/render/          post-processing and the dissolve between worlds
│   ├── src/audio/           synthesised sound and voices
│   ├── src/input/, player/  keyboard, touch and WebXR, one input model
│   ├── src/ui/              HUD and menus
│   ├── public/assets/       models at three weights, pictures, manifest
│   ├── assets/              art bible and design sheets
│   ├── tests/unit/          unit and balance tests
│   └── tools/               end-to-end, input, XR, audio and screenshot checks
├── .github/workflows/       deploy to Vercel on push to main
└── index.html, src/, data/, docs/   the earlier "What If" prototype, kept for reference only
```

## Tech stack

- **TypeScript** with **three.js** (WebGL) and **WebXR** for headsets
- **Vite** for development and bundling, **Vitest** for unit tests, **Playwright** with headless Chrome for end-to-end, input and screenshot tests
- **IWER** (Meta's immersive web emulator) for headset tests without a headset
- **Web Audio API** for all sound, synthesised at runtime
- **Generated 3D assets**: OpenAI image model for design sheets, Tripo for models and rigs, glTF Transform and meshoptimizer for compression
- **Vercel** for static hosting, deployed by a GitHub Actions workflow

## Status

- **Complete and deployed.** The whole week, all three decisions, every ending and the arcade can be played from start to finish on desktop, touch and VR.
- **Verified by automated tests.** Unit, end-to-end, input, touch and emulated-VR checks pass.
- **Not yet verified:** comfort and frame rate on a real headset, how the sound comes across to a listener, and playtesting with students aged 11 to 14.
- **Remaining work:** character art polish (Lumi, Nova, Kai and Jamie), facial expression in conversation, and the pitch video.

## Team

*To be added.*
