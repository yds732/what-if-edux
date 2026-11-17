// Every generated asset in the game: what it is, how its design sheet is asked for, and how its model is made.
// The tools in tools/assets read this file; the game reads the manifest they write.
import { FIGURE, HAVEN, LOOK, PICTURE, PRODUCT, REAL, TURNAROUND } from './style.mjs';

const WORLD = { real: REAL, haven: HAVEN };

const CHILD = 'A child of about twelve.';
const COMPANION = 'An AI companion who appears as a child of about twelve made of soft light, a little too perfect:';
const ADULT_FIGURE = 'Adult art-toy proportions instead of a child\'s: the head about one fifth of the total height, taller and slimmer than the children.';
/** Faces are drawn by the game, so nothing may sit where the eyes and mouth will go. */
const CLEAR_FACE = 'The forehead and the whole face are clear of hair: any fringe stops well above where eyebrows would be.';

/**
 * kind 'key'        a style key: a picture of the look, used as the reference for every sheet of its world
 * kind 'character'  a rigged figure, from a four-view turnaround. `height` is standing height in metres
 * kind 'prop'       a single object, from a three-quarter product view. `fit` scales the model: ['x', 1.5]
 *                   makes it 1.5 m across (x across, y up, z deep), ['top', 0.36, [0, 0.2]] puts the surface
 *                   over a spot of its footprint (the middle is [0, 0], an edge 1) at 0.36 m, for a seat, and
 *                   ['box', [1.5, 0.7, 0.6]] sets all three sizes where a room is built around the piece
 *
 * `glass: true` evens out the shine of dark glass: a screen that is switched off.
 * kind 'picture'    a flat image for a surface: a floor, a rug, a poster. `edge` is its longer side in the game, in
 *                   pixels; `tile: true` marks a texture that repeats, which also gets a relief map made from it
 *
 * `align: 'long-axis'` lays a long thin prop along Z, thick end to -Z, whichever way it was modelled.
 * `brief` is the design itself. `glow` makes painted light shine (see src/assets/glow.ts): props take their
 * world's unless they say otherwise. `detail` picks how much Tripo is asked for:
 *   'hero'     close to the camera or central to a scene: ultra geometry and detailed textures
 *   'standard' furniture and set dressing
 *   'repeated' made like 'standard', but kept light in the game: there are many copies of it in view at once
 */
export const ASSETS = {
  // ---------------------------------------------------------------------------------------------- style keys
  'key-real': {
    kind: 'key', world: 'real', size: '1536x1024',
    brief: 'Style key: a line-up on a plain light-grey studio background of a blank-faced schoolchild figure in a slate-blue jumper, a two-seat pale oak school desk with a slate-blue chair, a matte white visor headset on a small ceramic stand, a potted plant in a white ceramic pot, a stack of books and a desk lamp. Every object shares one finish and one scale.',
  },
  'key-haven': {
    kind: 'key', world: 'haven', size: '1536x1024',
    brief: 'Style key: a line-up on a plain light-grey studio background of a blank-faced luminous companion figure in white with cyan light seams, a small pink blossom tree with a twisting violet trunk, a cluster of glowing lavender crystals, an ornate moonstone and gold lamp post, a chunk of floating violet rock with turf on top, and a round gold-rimmed ring of light. Every object shares one finish and one scale.',
  },

  // ---------------------------------------------------------------------------------------------- Haven's companions
  lumi: {
    kind: 'character', world: 'haven', detail: 'hero', height: 1.36, glow: { color: '#6fe6ff', strength: 2.6 },
    brief: `Lumi. ${COMPANION} a girl with pearly porcelain-white skin with a faint opal sheen. A rounded chin-length bob of pale lavender-white hair whose tips glow soft cyan. An oversized soft white knitted hoodie (hood down) with fine gold embroidery at the cuffs and hem, a glowing cyan light seam along the hood edge, the cuffs and the hem, and a small glowing ring emblem on the chest. Pale lilac-white tapered trousers with a thin cyan light stripe down each side. Chunky white trainers with softly glowing cyan soles.`,
  },
  kai: {
    kind: 'character', world: 'haven', detail: 'hero', height: 1.4, glow: { color: '#ffc063', strength: 2.6 },
    brief: `Kai. ${COMPANION} a boy with deep brown skin with a faint pearl sheen. Short tight dark curls whose tips glow warm gold. A soft white knitted zip jacket with fine gold embroidery at the cuffs and hem and glowing warm-gold light seams along the collar, cuffs and hem. Deep indigo tapered trousers with a thin gold light stripe down each side. Chunky white trainers with softly glowing gold soles. ${CLEAR_FACE}`,
  },
  nova: {
    kind: 'character', world: 'haven', detail: 'hero', height: 1.34, glow: { color: '#ff7fd8', strength: 2.6 },
    brief: `Nova. ${COMPANION} a girl with warm tan skin with a faint pearl sheen. Chestnut wavy hair pinned up in two low rounded buns behind the ears, the tips glowing soft pink. A soft white knitted hoodie (hood down) with fine gold embroidery at the cuffs and hem and glowing pink light seams along the hood edge, cuffs and hem. Pale lilac tapered trousers with a thin pink light stripe down each side. Chunky white trainers with softly glowing pink soles. ${CLEAR_FACE}`,
  },

  // ---------------------------------------------------------------------------------------------- the real world's people
  teacher: {
    kind: 'character', world: 'real', detail: 'hero', height: 1.64,
    brief: `The teacher, a warm, capable woman in her forties. ${ADULT_FIGURE} Medium-brown skin. Dark brown hair gathered in a neat high bun. A sage-teal knitted jumper over a cream collared shirt, an orange lanyard with a small white identity card, slate-navy tailored trousers and brown leather loafers. ${CLEAR_FACE}`,
  },
  jamie: {
    kind: 'character', world: 'real', detail: 'hero', height: 1.38,
    brief: `Jamie, a kind and slightly shy classmate. ${CHILD} Light warm skin. Messy mid-brown hair with a tuft sticking up at the crown. A soft grey-blue hoodie (hood down) with cream drawstrings and cream ribbed cuffs and a small round enamel pin on the chest, dark navy trousers, blue canvas trainers with white soles. ${CLEAR_FACE}`,
  },
  priya: {
    kind: 'character', world: 'real', detail: 'standard', height: 1.35,
    brief: `Priya, a classmate. ${CHILD} Medium-brown skin. Black hair in a short high ponytail that stays off the shoulders. A terracotta knitted jumper over a cream shirt collar, charcoal trousers, cream trainers. ${CLEAR_FACE}`,
  },
  theo: {
    kind: 'character', world: 'real', detail: 'standard', height: 1.41,
    brief: `Theo, a classmate, slightly stocky. ${CHILD} Fair skin. Short sandy-ginger cropped hair. A sage-green hoodie (hood down) with cream drawstrings, charcoal trousers, brick-red trainers. ${CLEAR_FACE}`,
  },
  amara: {
    kind: 'character', world: 'real', detail: 'standard', height: 1.36,
    brief: `Amara, a classmate. ${CHILD} Deep brown skin. Black hair in two round puff buns on top of the head. A mustard-yellow knitted jumper with cream ribbed cuffs, navy trousers, cream trainers. ${CLEAR_FACE}`,
  },
  yusra: {
    kind: 'character', world: 'real', detail: 'standard', height: 1.35,
    brief: `Yusra, a classmate. ${CHILD} Light tan skin. A slate-blue hijab wrapped neatly and close around the head, covering all of her hair, both ears and her neck, so that no ears are visible, and leaving the whole face clear. A cream long-sleeved knitted jumper with a slate-blue stripe at the cuffs and hem, navy trousers, blue trainers.`,
  },
  leo: {
    kind: 'character', world: 'real', detail: 'standard', height: 1.39,
    brief: `Leo, a classmate. ${CHILD} Light tan skin. Messy short black hair. A cobalt-blue hoodie (hood down) with a white zip, dark charcoal trousers, red trainers with white soles. ${CLEAR_FACE}`,
  },
  mina: {
    kind: 'character', world: 'real', detail: 'standard', height: 1.33,
    brief: `Mina, a classmate. ${CHILD} Fair skin. A neat black chin-length bob with a very short straight fringe high on the forehead. A lilac knitted jumper, slate-grey trousers, pale lilac trainers. ${CLEAR_FACE}`,
  },
  alex: {
    kind: 'character', world: 'real', detail: 'standard', height: 1.36,
    brief: `Alex, a twelve-year-old from another school. ${CHILD} Light tan skin. Short dark-brown cropped hair. A soft sage hoodie (hood down), slate trousers, blue trainers. ${CLEAR_FACE}`,
  },
  sam: {
    kind: 'character', world: 'real', detail: 'standard', height: 1.4,
    brief: `Sam, a thirteen-year-old from another school. A child of about thirteen. Brown skin. Short dark curly hair. A burnt-orange knitted jumper over a cream collar, dark navy trousers, cream trainers. ${CLEAR_FACE}`,
  },
  riley: {
    kind: 'character', world: 'real', detail: 'standard', height: 1.34,
    brief: `Riley, an eleven-year-old from another school. A child of about eleven. Fair skin. Copper-red hair in a short high ponytail that stays off the shoulders. An indigo hoodie (hood down), dark trousers, pale lilac trainers. ${CLEAR_FACE}`,
  },

  // ---------------------------------------------------------------------------------------------- the player
  hand: {
    kind: 'prop', world: 'real', detail: 'hero', fit: ['z', 0.5], size: '1536x1024', align: 'long-axis', lengthen: [-0.02, 2.2],
    // first-person hands: the sleeve has to run on past the bottom of the screen in every pose
    brief: 'A single child\'s RIGHT hand together with the WHOLE forearm as far as the elbow, in the same art-toy style, lying straight across the picture from the elbow at the upper right to the fingertips at the lower left: a simplified hand with four clearly separated fingers and a thumb, fingers relaxed and very slightly curled, held out flat with the palm facing down. Light warm skin. The whole forearm is inside the long sleeve of a slate-blue knitted jumper, with a ribbed cuff at the wrist, and the sleeve ends in a clean straight cut at the elbow. The forearm and sleeve are about twice as long as the hand.',
  },

  // ---------------------------------------------------------------------------------------------- shared props
  headset: {
    kind: 'prop', world: 'real', detail: 'hero', fit: ['x', 0.2],
    brief: 'The Echo headset: a sleek, lightweight mixed-reality visor of 2080. A continuous matte white ceramic halo band that wraps the head, a curved smoked-glass visor across the front, a thin cyan light seam along the lower edge of the visor, soft grey knitted padding on the inside of the band, and a small round sensor at each temple. No strap over the top, no cables.',
  },
  phone: {
    kind: 'prop', world: 'real', detail: 'hero', glass: true, fit: ['box', [0.075, 0.012, 0.155]],
    brief: 'A slim smartphone of 2080 lying flat on its back, seen from above at an angle: a matte white ceramic body with softly rounded corners, an edge-to-edge dark glass screen that is switched off, a thin cyan light ring around the edge of the screen, a single tiny lens. No buttons, no text on the screen.',
  },
  dock: {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['box', [0.3, 0.07, 0.3]],
    brief: 'A charging dock for a headset: a low round dish of matte white ceramic with a soft grey felt pad in the middle and a thin glowing cyan light ring around its rim, on a short tapered foot.',
  },

  // ---------------------------------------------------------------------------------------------- classroom
  desk: {
    kind: 'prop', world: 'real', detail: 'repeated', fit: ['box', [1.56, 0.66, 0.72]], size: '1536x1024',
    brief: 'A long double school desk shared by two pupils sitting side by side, seen from the front and slightly above: it is very wide and low, more than twice as wide as it is tall (about 1.6 m wide, 0.6 m deep and 0.68 m high). One long continuous pale oak top with rounded corners and softly bevelled edges, a slim open shelf beneath it divided into two halves with a few cloth-bound books in each, four white powder-coated steel legs at the corners with slate-blue rubber feet, and a thin inlaid glass strip along the back edge of the top.',
  },
  chair: {
    kind: 'prop', world: 'real', detail: 'repeated', fit: ['top', 0.36, [0, 0.15]],
    brief: 'A school chair: a slate-blue moulded seat and curved backrest with a fine fabric texture, a pale oak rail along the top of the backrest, four slim white powder-coated steel legs with slate-blue rubber feet.',
  },
  plinth: {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['box', [0.58, 0.99, 0.58]],
    brief: 'A display pedestal for a classroom: a waist-high column of matte white ceramic that flares gently into a round flat top, a thin glowing cyan light ring set into the rim of the top, a pale oak band around the base.',
  },
  'teacher-desk': {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['y', 0.76],
    brief: 'A teacher\'s desk: a pale oak top on a white powder-coated steel frame with a column of three slate-blue drawers on one side with round oak knobs. On the top: a neat stack of exercise books, a ceramic mug of pencils and a small tablet on a stand.',
  },
  'craft-table': {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['box', [2.3, 0.75, 1.2]],
    brief: 'A large craft table for a school art club: a long rectangular top of white laminate with a pale oak edge, completely clear and empty on top, on four sturdy white powder-coated steel legs with slate-blue rubber feet and a pale oak stretcher rail between the legs.',
  },
  'art-supplies': {
    kind: 'prop', world: 'real', detail: 'repeated', fit: ['x', 0.42],
    brief: 'A small tidy cluster of art supplies standing together on a round pale oak tray: a ceramic pot full of chunky felt-tip markers in bright colours, three small pots of poster paint (terracotta, sage, slate blue) with a brush resting across one, a roll of washi tape and a pair of rounded scissors.',
  },
  lockers: {
    kind: 'prop', world: 'real', detail: 'repeated', fit: ['box', [1.72, 1.5, 0.42]],
    brief: 'A pale oak cubby unit for a classroom wall: two rows of three open square compartments with rounded edges. Inside the compartments are folded jumpers, lunch boxes and schoolbags in slate blue, terracotta, sage and mustard. A row of small white coat pegs along the top edge.',
  },
  backpack: {
    kind: 'prop', world: 'real', detail: 'repeated', fit: ['y', 0.42],
    brief: 'A child\'s school backpack standing upright: slate-blue canvas with visible weave, terracotta leather straps and base, a front pocket with a chunky zip, cream stitching and two small round enamel badges.',
  },
  'plant-tall': {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['y', 1.35],
    brief: 'A tall indoor plant: a young rubber plant with thick, glossy, sculpted green leaves on a single stem, in a large matte white ceramic pot with a terracotta base.',
  },
  'plant-small': {
    kind: 'prop', world: 'real', detail: 'repeated', fit: ['y', 0.2],
    brief: 'A small desk plant: a chubby succulent with thick rounded leaves in a little speckled cream ceramic pot.',
  },
  slate: {
    kind: 'prop', world: 'real', detail: 'repeated', glass: true, fit: ['x', 0.3],
    brief: 'A school tablet of 2080 lying flat: a thin slab with softly rounded corners, a matte dark glass screen that is switched off, a matte white ceramic rim, resting on a slate-blue knitted fabric folio cover with cream stitching that shows around its edges.',
  },
  bookshelf: {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['y', 1.7],
    brief: 'A tall classroom bookshelf of pale oak with four shelves and softly rounded edges, filled with colourful cloth-bound books standing and stacked, storage boxes in slate blue and terracotta, a small globe and a little potted plant.',
  },

  // ---------------------------------------------------------------------------------------------- bedroom
  bed: {
    kind: 'prop', world: 'real', detail: 'hero', fit: ['z', 2.0],
    brief: 'A child\'s single bed: a pale oak frame with a softly rounded headboard, a thick white mattress, a slate-blue quilted duvet with stitched squares spread neatly over it, a plump white pillow at the head and a small yellow star-shaped plush toy resting on the pillow.',
  },
  'study-desk': {
    kind: 'prop', world: 'real', detail: 'hero', fit: ['box', [1.9, 0.74, 0.72]], size: '1536x1024',
    brief: 'A long bedroom study desk that runs under a wide window, seen from the front and slightly above: it is very wide and low, more than two and a half times as wide as it is tall (about 1.9 m wide, 0.7 m deep and 0.74 m high). One long pale oak top with rounded corners on a white powder-coated steel frame, with a column of three slate-blue drawers with round oak knobs under the right-hand end and open leg room under the rest. The top is completely clear and empty.',
  },
  'moving-box': {
    kind: 'prop', world: 'real', detail: 'repeated', fit: ['y', 0.44],
    brief: 'A cardboard moving box, a cube taped shut along the top with pale paper tape, a little dented at one corner, with a hand-drawn star and an arrow doodled on one side in marker and a small cyan tracking tag stuck to another. No words or letters anywhere.',
  },
  door: {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['box', [1.0, 2.1, 0.14]],
    brief: 'An interior door, perfectly closed and flush inside its frame, drawn flat and straight-on like an architectural elevation with no perspective and nothing swung open: a pale oak door leaf with softly rounded edges, a slim tall inset panel of frosted glass, a brushed white ceramic lever handle with a thin cyan light seam beside it, in a simple white frame.',
  },
  'desk-chair': {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['y', 0.86],
    brief: 'A child\'s swivel desk chair: a white five-star base on castors, a slim white gas-lift column, a slate-blue padded seat and curved padded backrest with a fine fabric texture and cream stitching.',
  },
  monitor: {
    kind: 'prop', world: 'real', detail: 'standard', glass: true, fit: ['x', 0.62],
    brief: 'A slim desktop computer monitor of 2080: a wide, thin display with a matte dark glass screen that is switched off, a matte white ceramic back and rim, on a slender white neck and a round pale oak base.',
  },
  bedside: {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['y', 0.98], glow: { color: '#ffd27a', strength: 3, from: 0.82 },
    brief: 'A small round bedside table of pale oak with three splayed legs, and standing on it a table lamp with a rounded matte white ceramic base and a warm cream fabric drum shade that glows softly from within.',
  },
  'wall-shelf': {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['box', [1.2, 0.56, 0.3]],
    brief: 'A floating wall shelf of pale oak, long and shallow, loaded with a row of colourful cloth-bound books standing upright, a jar of pencils, a small toy rocket and a tiny potted succulent.',
  },
  beanbag: {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['x', 0.9],
    brief: 'A plump bean bag chair in terracotta fabric with a visible weave and cream stitched seams, softly dented as if recently sat in.',
  },
  wardrobe: {
    kind: 'prop', world: 'real', detail: 'standard', fit: ['box', [1.1, 1.9, 0.58]],
    brief: 'A child\'s bedroom wardrobe: pale oak with two tall doors with softly rounded edges, round white ceramic knobs, a slate-blue drawer along the bottom, standing on short tapered legs.',
  },

  // ---------------------------------------------------------------------------------------------- Haven
  // modelled but not placed at present: the meadow's tree is the one drawn in src/world/haven/flora.ts
  'blossom-tree': {
    kind: 'prop', world: 'haven', detail: 'hero', fit: ['y', 7.4],
    brief: 'A blossom tree: a gracefully twisting trunk of deep violet bark threaded with fine gold filigree that glows faintly, spreading into a broad, layered canopy made of dense sculpted clusters of pink blossom, with a few glowing blossoms among them. The trunk rises from a small mound of mossy violet rock.',
  },
  gateway: {
    kind: 'prop', world: 'haven', detail: 'hero', fit: ['y', 6.2],
    brief: 'A tall ceremonial gateway: two slender pillars of pale moonstone wrapped in gold filigree, joined by a pointed arch crowned with a large opal gem, standing on a round stepped base of moonstone edged in gold. The opening of the arch is completely empty.',
  },
  'lamp-post': {
    kind: 'prop', world: 'haven', detail: 'standard', fit: ['y', 2.6], glow: { strength: 2.6, vivid: 0.22 },
    brief: 'An ornate lamp post: a slender moonstone column wrapped in a spiral of gold filigree, on a stepped gold-trimmed base, carrying a lantern shaped like a closed opal flower bud that glows warm gold from within.',
  },
  'crystals-a': {
    kind: 'prop', world: 'haven', detail: 'repeated', fit: ['y', 1.5],
    brief: 'A cluster of five tall faceted crystals of glowing lavender and pink, rising at different angles from a small base of violet rock with moss and a curl of gold filigree.',
  },
  'crystals-b': {
    kind: 'prop', world: 'haven', detail: 'repeated', fit: ['y', 1.9],
    brief: 'A cluster of slender, sharply faceted crystals of glowing pale cyan and aquamarine, one much taller than the rest, rising from a small base of violet rock with moss.',
  },
  'island-a': {
    kind: 'prop', world: 'haven', detail: 'repeated', fit: ['x', 14],
    brief: 'A floating island: a wide chunk of deep violet rock that tapers to a ragged point underneath, with veins of glowing lavender crystal in the rock, a flat top covered in soft teal-green turf, a few small pink blossom bushes and a little cluster of crystals growing on top.',
  },
  'island-b': {
    kind: 'prop', world: 'haven', detail: 'repeated', fit: ['x', 10],
    brief: 'A small floating island: a tall narrow shard of deep violet rock tapering to a point underneath, veined with glowing cyan crystal, with a flat mossy teal-green top, one small pink blossom sapling and a few small crystals. No water and no waterfall anywhere.',
  },
  ring: {
    kind: 'prop', world: 'haven', detail: 'hero', fit: ['box', [2.9, 2.9, 0.3]], band: 0.55,
    brief: 'A large circular hoop to throw things through, seen exactly from the front: a ring of pale moonstone with a rim of gold filigree and four pointed opal gems set at the top, bottom, left and right. The inside of the hoop is completely empty.',
  },
  dais: {
    kind: 'prop', world: 'haven', detail: 'hero', fit: ['box', [5.2, 0.4, 5.2]],
    brief: 'A wide, low, perfectly round ceremonial platform of pale lavender moonstone, only ankle-high, with a stepped edge trimmed in gold and a large five-pointed star inlaid in gold across its flat top, a ring of small opal studs around the rim.',
  },
  'stepping-stone': {
    kind: 'prop', world: 'haven', detail: 'repeated', fit: ['x', 1.0],
    brief: 'A single flat rounded stepping stone of pale lavender moonstone, smooth on top with fine gold veining and a softly worn edge, a little moss around its base.',
  },
  lantern: {
    kind: 'prop', world: 'haven', detail: 'repeated', fit: ['y', 0.5],
    brief: 'A floating festival lantern: a rounded lantern of warm cream paper panels in a fine gold frame, a small gold finial on top and a short silk tassel hanging beneath, glowing warmly from within.',
  },
  'board-frame': {
    kind: 'prop', world: 'haven', detail: 'standard', fit: ['box', [1.355, 2, 0.3]],
    brief: 'A standing notice frame: a wide rectangular frame of gold filigree with rounded corners and small opal gems at the corners, completely empty in the middle, held up on a slender moonstone post with a round stepped base.',
  },
  // ------------------------------------------------------------------------------------------------ pictures
  'floor-classroom': {
    kind: 'picture', world: 'real', size: '1536x1536', edge: 1024, tile: true,
    brief: 'A seamless, tileable floor texture seen exactly from above: pale oak parquet laid in a neat herringbone pattern, satin finish with fine grain and softly bevelled joints, gently worn by years of school shoes. The pattern is even all over, with no object, rug or mark anywhere.',
  },
  'floor-bedroom': {
    kind: 'picture', world: 'real', size: '1536x1536', edge: 1024, tile: true,
    brief: 'A seamless, tileable floor texture seen exactly from above: warm honey-brown oak floorboards running straight up the image, long planks of varied lengths with fine grain, a few small knots and softly bevelled joints, satin finish. Even all over, with no object, rug or mark anywhere.',
  },
  rug: {
    kind: 'picture', world: 'real', size: '1536x1536', edge: 1024,
    brief: 'A round hand-tufted wool rug seen exactly from above, perfectly circular and centred, touching all four edges of the image, on a plain flat black background: thick soft pile in concentric bands of slate blue, warm cream, terracotta and sage green, a ring of small stitched stars, and one larger star in the middle.',
  },
  pinboard: {
    kind: 'picture', world: 'real', size: '2048x832', edge: 2048,
    brief: 'A long classroom pin board of warm cork, covered from end to end with children\'s drawings and paintings on paper held by coloured pins: rockets, houses, families holding hands, friendly robots, rainbows, a harbour with boats, hand prints in paint, and a paper chain along the top. Charming and a little wonky, as if made by eleven-year-olds.',
  },
  'poster-planets': {
    kind: 'picture', world: 'real', size: '1024x1536', edge: 1024,
    brief: 'A classroom wall poster of the solar system in flat, friendly shapes: the sun at the bottom and the planets rising in a gentle curve, each with its own character, on deep slate blue with small stars.',
  },
  'poster-harbour': {
    kind: 'picture', world: 'real', size: '1536x1024', edge: 1024,
    brief: 'A classroom wall poster: a cheerful cutaway map of a harbour city of 2080 in flat shapes, with soft towers, a bridge, a school with a flag, parks, sailing boats and a tram, in warm cream, sage, terracotta and slate blue.',
  },
  'poster-stars': {
    kind: 'picture', world: 'real', size: '1024x1536', edge: 1024,
    brief: 'A bedroom wall poster: a night-sky star chart, deep navy, with fine concentric orbit rings, constellations joined by thin pale lines, a ringed planet low in one corner and a scatter of small stars.',
  },
  'poster-newstart': {
    kind: 'picture', world: 'real', size: '1536x1024', edge: 1024,
    brief: 'A bedroom wall poster in the style of a vintage travel poster: sunrise over a harbour city of 2080 in flat shapes, soft towers and a long bridge, sailing boats on calm water, a warm peach and terracotta sky.',
  },
};

const layoutFor = { character: TURNAROUND, prop: PRODUCT, key: '', picture: '' };

/** The real world's light is its quiet cyan-white seams; in Haven whatever is painted bright and strong is alight. */
const PROP_GLOW = { real: { color: '#9fe8ff', strength: 2 }, haven: { strength: 1.6, vivid: 0.46 } };

/** How an asset's painted light shines, if it does. */
export const glowOf = (id) => ASSETS[id].glow ?? (ASSETS[id].kind === 'prop' ? PROP_GLOW[ASSETS[id].world] : null);

/** Whether an asset is made into a 3D model: a figure or an object, not a style key or a flat picture. */
export const isModel = (id) => ASSETS[id].kind === 'character' || ASSETS[id].kind === 'prop';

/** The words a sheet is asked for with. */
export const sheetPrompt = (id) => {
  const a = ASSETS[id];
  if (!a) throw new Error(`no asset called "${id}" in the catalog`);
  if (a.kind === 'picture') return [a.brief, WORLD[a.world], PICTURE].join('\n\n');
  return [layoutFor[a.kind], a.brief, a.kind === 'character' ? FIGURE : '', WORLD[a.world], LOOK].filter(Boolean).join('\n\n');
};

/** Image size for a sheet: four upright panels for a figure, one frame for an object. */
export const sheetSize = (id) => ASSETS[id].size ?? (ASSETS[id].kind === 'character' ? '3072x1024' : '1536x1536');
