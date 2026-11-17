# Generated assets

Everything the player looks at that is not a shader is generated: a design sheet first, then a 3D model from the
sheet. The designs live in `assets/` and the tools that make things from them live here.

```
assets/style.mjs      the art bible, as the words every sheet is asked for with
assets/catalog.mjs    every asset: what it is, how big, how it is made
assets/sheets/        the design sheets, as JPEG (kept in git: they are the source of every model)
assets/.cache/        raw models, working files, the spend ledger (not in git)
public/assets/        what the game loads: models per graphics tier, pictures, manifest.json
```

## Making or changing an asset

The keys are read from the environment; pass an env file to Node. Nothing prints them.

```sh
ENV=--env-file=/path/to/.env

# 1. the design sheet (OpenAI images). Look at it before going on: assets/.cache/previews/<id>.jpg
node $ENV tools/assets/sheet.mjs <id> [--force]

# 2. the model (Tripo): figures from their four views and then rigged, objects from the one picture
node $ENV tools/assets/model.mjs <id> [--force]

# 3. the files the game loads: turned, scaled, simplified per tier, compressed
node tools/assets/optimize.mjs <id>

# flat pictures (floors, posters) skip step 2 and are made with
node tools/assets/picture.mjs <id>
```

`sheet.mjs all` and `model.mjs all` do everything in the catalog that is not made yet. `optimize.mjs --notes`
refreshes what the manifest says about each asset (its glow, where a face sits) without remaking any model.

To see a result: `node tools/assets/inspect.mjs <file.glb> [--textures] [--joints] [--rig]`, or in the game's
studio, `?shot=studio&subject=model&url=assets/models/<id>.high.glb&h=<height>`.

## What the tools take care of

- **One look.** Every sheet is drawn with its world's style key as a reference image.
- **Blank faces.** Figures are modelled without eyes or mouths; the game draws those, so that they can move.
- **Any skeleton.** Tripo's rigs differ from figure to figure. `lib/rig.mjs` reads each one by its shape and
  records which bone is which; the game's own animator then drives it.
- **Game-ready files.** Every model stands on its origin, in metres, facing +Z. A chair's seat is at seat height
  (`fit: ['top', ...]`), a desk is the size the room is laid out for (`fit: ['box', ...]`).
- **Failures caught here.** A texture that comes back blank fails the run; a skeleton that cannot be read fails
  the build; neither reaches the game.
