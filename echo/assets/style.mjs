// The art bible, as the words every design sheet is asked for with. One look for the whole game:
// a premium animated film crossed with hand-finished collectible art toys. The real world of 2080 is warm,
// tactile and quiet about its technology; Haven keeps the same shapes and makes them glow from within.

/** Applies to everything. */
export const LOOK = [
  'Stylised 3D design in the visual language of a premium animated feature film crossed with a hand-finished collectible art toy.',
  'Soft sculpted forms with gently bevelled edges and clean, readable silhouettes.',
  'Rich tactile materials with physically based shading: matte ceramic, satin plastic, brushed aluminium, woven and knitted fabric with visible weave and stitching, oiled pale wood. Fine surface detail and a little honest wear, never photorealistic grime.',
  'Soft, even, neutral studio lighting with gentle ambient occlusion; no harsh cast shadows, no coloured rim lights, no lens effects.',
  'Plain flat light-grey background, nothing else in the frame.',
  'No text, no labels, no numbers, no logos, no watermarks, no borders, no arrows.',
].join(' ');

/** The real world, 2080: Harbour District School and home. */
export const REAL = [
  'Setting: an optimistic near-future 2080. Palette of warm whites, pale oak, slate blue, sage green and terracotta accents.',
  'Technology is quiet: thin glass, matte white shells, soft cyan-white light seams.',
].join(' ');

/** Haven, the companion world. */
export const HAVEN = [
  'Setting: Haven, a dreamlike world of floating islands at violet dusk. The same shape language, but materials glow from within:',
  'moonstone, opal, lavender crystal, deep violet rock, blossom pink, fine gold filigree, soft cyan and gold light.',
].join(' ');

/** Every person in the game is the same kind of figure. */
export const FIGURE = [
  'Art-toy proportions: a large head about one quarter of the total height, compact body, slightly oversized hands and shoes.',
  'Simplified hands with four clearly separated fingers and a thumb, relaxed and open.',
  'The face is deliberately BLANK, like a faceless designer vinyl figure: smooth skin with only a small sculpted nose and simple ears. Absolutely no eyes, no eyebrows, no eyelashes, no mouth, no painted or sculpted facial features of any kind.',
  'Hair is sculpted in chunky clean locks that stay close to the head: nothing hangs over the face or onto the shoulders.',
  'Clothing fits fairly close to the body: no capes, scarves, bags, loose straps or held objects.',
  'Relaxed A-pose: arms straight and held about 35 degrees away from the body, palms turned in, fingers relaxed; legs straight and slightly apart, feet flat on the ground; head level, looking straight ahead.',
].join(' ');

/** Four views in a row, in the order Tripo's multiview input takes them. */
export const TURNAROUND = [
  'Character turnaround reference sheet: exactly four full-body views of the SAME character in one row, evenly spaced, at the same scale, feet on the same baseline, strictly orthographic with no perspective.',
  'From left to right: (1) FRONT view; (2) LEFT side profile, the character facing the left edge of the image; (3) BACK view; (4) RIGHT side profile, the character facing the right edge of the image.',
  'Identical design, colours and proportions in every view. The four figures must not touch or overlap, with clear empty background between them.',
].join(' ');

/** One object, seen so that a 3D model can be made from the picture. */
export const PRODUCT = [
  'Product design reference: a single object, complete and uncropped, centred, seen from a three-quarter front view slightly above eye level so that its front, one side and its top are all visible.',
  'The object fills most of the frame. No floor, no other objects, no people.',
].join(' ');

/** A flat picture for a surface in a room: a floor, a rug, a poster. It is the whole image, with nothing around it. */
export const PICTURE = [
  'A flat picture that fills the whole image from edge to edge, seen exactly straight-on with no perspective.',
  'Painted with the richness of a premium animated feature film: clean stylised shapes, soft natural colour and tactile material detail.',
  'Flat, even light with no cast shadows, no vignette, no frame, no border, no wall behind it and nothing else in the image.',
  'No words, no letters, no numbers, no logos, no watermarks.',
].join(' ');
