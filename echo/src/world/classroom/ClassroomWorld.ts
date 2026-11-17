import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Character } from '../../characters/Character';
import { CAST, type CastName } from '../../characters/cast';
import { place, sweep, torus, v3 } from '../../core/geo';
import { Rng, TAU, damp } from '../../core/math';
import { makeLook } from '../../render/PostPipeline';
import { bakeRoomEnvironment } from '../../render/env';
import type { Future } from '../../story/script';
import { Panel } from '../../ui/Panel';
import { THEMES, font, glass, roundRect, spaced, wrap } from '../../ui/draw';
import { World, anchor, anchorToward, characterYaw, type Anchor, type BuildContext, type FrameContext } from '../World';
import type { Obstacle } from '../colliders';
import { dress, framed, sizeOf, type Spot } from '../dressing';
import type { PoseName } from '../../characters/motion';
import { makeHalo } from '../haven/atmosphere';
import { buildCityscape, type Cityscape } from '../cityscape';
import { Builder } from '../interior';
import { buildSunbeams, type Sunbeams } from './sunbeams';

/** Seat height of every chair, and the eye height of a child sitting on one. */
export const SEAT = 0.36;
const _sunDir = new THREE.Vector3();
export const EYE_SEATED = 0.9;

/** The classroom: 10 m wide (x), 12 m deep (z). The display and teacher are on the -Z wall, windows on -X. */
export const CLASSROOM = {
  /** Monday: the player's desk at the back. */
  seatMonday: anchor(1.07, 0, 2.95, 0),
  /** Where "the front of the classroom" is. */
  front: new THREE.Vector3(0.1, 0, -3.0),
  /** Top of the plinth that holds the headset. */
  plinth: new THREE.Vector3(1.0, 0.92, -3.9),
  teacher: anchorToward(-1.5, 0, -4.1, 0.4, 3),
  /** Wednesday: the empty chair beside Jamie. */
  seatPartner: anchor(2.37, 0, -0.65, 0),
  jamieSeat: anchor(3.13, 0, -0.65, 0),
  /** Just inside the door, clear of the front desks. */
  door: anchor(4.25, 0, -1.9, 250),
  /** Tuesday: the poster table by the windows. */
  posterTable: new THREE.Vector3(-2.6, 0, -2.6),
  posterStand: anchorToward(-2.6, 0, -1.2, -2.6, -2.6),
  /** Friday: where the three voices appear. */
  stage: new THREE.Vector3(0.2, 0.16, -4.6),
} as const satisfies Record<string, Anchor | THREE.Vector3>;

export type ClassroomVariant = 'morning' | 'golden' | 'viewer';
export type ScreenContent =
  | { kind: 'title'; eyebrow: string; title: string; body: string }
  | { kind: 'voice'; name: string; line: string }
  | { kind: 'future'; heading: string; note: string; future: Future };

const W = 5, D = 6, H = 3.4;
/** Height of a floor marker: just clear of the floor. */
export const FLOOR_MARK = 0.02;
/** The ceiling's pendant lights hang over these columns and rows, where the old panels were. */
const LIGHT_COLS = [-2.8, 0, 2.8], LIGHT_ROWS = [-3.6, -0.6, 2.4];
/** Radius of each pendant orb (32 cm across). Its wire is as long as the orb is wide. */
const ORB_R = 0.16;
/** The room's light comes from the lamps: a soft warm white, not the blue-white of office panels. */
const LAMP_COLOR = 0xfff1e0, PENDANT_POWER = 3.0;
/**
 * The border light: a line of cool light round the foot of the walls, just above the skirting and the stage, in a slim
 * white channel that stands a little off the wall, washing the floor's edge and the bottom of the walls.
 */
const BORDER = { y: 0.24, off: 0.05, color: 0xcfe4ff, power: 0.9 };
/** Where the border's light is gathered into lamps: [x, z], a little in from each wall, low down. */
const BORDER_LAMPS: readonly (readonly [number, number])[] = [
  [-2.5, -D + 0.35], [2.5, -D + 0.35], [-2.5, D - 0.35], [2.5, D - 0.35],
  [W - 0.35, -3.6], [W - 0.35, 2.4], [-W + 0.35, -3], [-W + 0.35, 3],
];
/** The door's opening on the right wall, which the border steps round. */
const DOOR_GAP = { z0: -2.45, z1: -1.35 };
/** The teacher's desk: a long white slab, plain and square. */
const DESK = { wide: 1.5, deep: 0.64, top: 0.82, yaw: 18 * (Math.PI / 180) };
/** The wall screens by the pin board: both the same portrait size. */
const SIGN = { wide: 0.8, tall: 1.2 };
/** The low stage along the front wall, the teacher's desk on it, and where the bookshelf stands along the right wall. */
const STAGE_HEIGHT = 0.16, TEACHER_DESK = { x: -2.2, z: -4.95, scale: 1.4 }, BOOKSHELF_Z = -3.5;

/**
 * A classroom table for two: a beech top on a steel frame, low enough for a child's forearms to rest on it. A pupil's
 * hips are `seatZ` behind the table's middle, which puts its long edge a hand's width in front of them.
 */
const TABLE = { top: 0.585, wide: 1.3, deep: 0.6, seatX: 0.38, seatZ: 0.45 } as const;

/** A chair at a place: pulled out to sit on, tucked under, or left where someone pushed it back. */
type ChairState = 'out' | 'in' | 'askew';
interface Place {
  /** Which end of the table, along its length. */
  readonly side: -1 | 1;
  /** 1 sits on the table's +Z side looking across it toward -Z (toward the front when the table is square on); -1 the other side. */
  readonly facing: 1 | -1;
  readonly who?: CastName;
  readonly pose?: PoseName;
  /** Kept for the player: the chair is out and nothing stands in it. */
  readonly free?: boolean;
  readonly chair?: ChairState;
}
interface TableSpec {
  readonly x: number;
  readonly z: number;
  /** Turn about the vertical, degrees. */
  readonly yaw: number;
  /** Stands in the front group, which is cleared away for Tuesday's after-school club. */
  readonly front?: boolean;
  readonly places: readonly Place[];
}

/** One place at a group: who sits there, or how its empty chair was left. */
type Seat = Omit<Place, 'side' | 'facing'>;
const AT = (who: CastName, pose: PoseName): Seat => ({ who, pose });
const ASKEW: Seat = { chair: 'askew' }, EMPTY: Seat = {}, PLAYER: Seat = { free: true };

/**
 * A group: four tables pushed into one block, two places on each long side facing each other. `front` and `back` list
 * the places on the side toward the front of the room and the side toward the back, left to right as seen from the back.
 */
const group = (cx: number, cz: number, front: boolean, back: readonly Seat[], fore: readonly Seat[]): TableSpec[] =>
  [-1, 1].flatMap((half) => ([1, -1] as const).map((facing): TableSpec => {
    const row = facing === 1 ? back : fore;
    const first = half < 0 ? 0 : 2;
    return {
      x: cx + (half * TABLE.wide) / 2, z: cz + (facing * TABLE.deep) / 2, yaw: 0, front,
      places: ([-1, 1] as const).map((side, k): Place => ({ side, facing, ...row[first + k] })),
    };
  }));

/** Where the four groups stand: two columns either side of one aisle, two rows. */
const GROUP_X = 2.1, GROUP_Z = [-1.4, 2.2] as const;

/**
 * The room is set out in four groups of eight. The places the story uses sit inside the pattern: the player's on
 * Monday at the back right group, and Wednesday's pair at the front right group, beside Jamie.
 */
const TABLES: readonly TableSpec[] = [
  ...group(-GROUP_X, GROUP_Z[0], true, [EMPTY, AT('priya', 'sitDesk'), AT('theo', 'sitDeskL'), ASKEW], [ASKEW, AT('amara', 'sitDeskR'), EMPTY, EMPTY]),
  ...group(GROUP_X, GROUP_Z[0], true, [EMPTY, ASKEW, PLAYER, AT('jamie', 'sitLean')], [AT('yusra', 'sitDesk'), EMPTY, ASKEW, EMPTY]),
  ...group(-GROUP_X, GROUP_Z[1], false, [ASKEW, AT('leo', 'sitDeskL'), AT('mina', 'sitDeskR'), EMPTY], [EMPTY, EMPTY, ASKEW, EMPTY]),
  ...group(GROUP_X, GROUP_Z[1], false, [PLAYER, ASKEW, EMPTY, EMPTY], [EMPTY, ASKEW, EMPTY, EMPTY]),
];

const RAD = Math.PI / 180;
/** How far each window's blind is pulled down, metres. */
const BLIND_DROPS = [0.55, 0.3, 0.8, 0.42];
/** A point given in a table's own frame (x along it, z across it), in the room. */
const onTable = (t: TableSpec, lx: number, lz: number): [number, number] => {
  const c = Math.cos(t.yaw * RAD), s = Math.sin(t.yaw * RAD);
  return [t.x + lx * c + lz * s, t.z - lx * s + lz * c];
};
/** Where someone sits at a place, looking straight across the table. */
const seatAt = (t: TableSpec, p: Place): Anchor => {
  const [x, z] = onTable(t, p.side * TABLE.seatX, p.facing * TABLE.seatZ);
  const [tx, tz] = onTable(t, p.side * TABLE.seatX, -p.facing * 0.6);
  return anchorToward(x, 0, z, tx, tz);
};
const SEATING = TABLES.flatMap((t) => t.places.filter((p) => p.who).map((p) => ({ who: p.who!, pose: p.pose ?? 'sitDesk', seat: seatAt(t, p), front: !!t.front })));

export class ClassroomWorld extends World {
  readonly id = 'classroom';
  readonly theme = 'real' as const;
  private marker!: THREE.Mesh;
  private markerShown = 0;
  private markerTarget = 0;
  /** The front row of desks: cleared away for the after-school club. */
  private readonly frontRow = new THREE.Group();
  private city!: Cityscape;
  private sun!: THREE.DirectionalLight;
  private fill!: THREE.HemisphereLight;
  private ceiling!: THREE.Mesh;
  /** The pendant and wall lights, dimmed with the room. */
  private readonly lamps: THREE.PointLight[] = [];
  /** The border light's painted strip, and the light that comes in through each window. */
  private border!: THREE.Mesh;
  private readonly windows: THREE.RectAreaLight[] = [];
  private screen!: Panel;
  private poster!: Panel;
  private posterGroup = new THREE.Group();
  private stageGlow!: THREE.Mesh;
  private stageBeam!: THREE.Mesh;
  private stageLight!: THREE.PointLight;
  private beams!: Sunbeams;
  private variant: ClassroomVariant = 'morning';
  private mood = { sun: 3, warm: 0, room: 1, night: 0 };
  private readonly target = { sun: 3, warm: 0, room: 1, night: 0 };
  private voiceShown: Record<string, number> = { alex: 0, sam: 0, riley: 0 };
  private voiceTarget: string | null = null;
  private screenPulse = 0;
  /** Dust turning in the light from the windows. */
  private markerRadius = 0.3;
  /** Obstacles that belong to the current arrangement of the room. */
  private sceneColliders: Obstacle[] = [];
  /** The front tables' obstacles: in the room only while those tables are. */
  private frontColliders: Obstacle[] = [];

  constructor() {
    super();
    this.near = 0.05;
    this.far = 1400;
    Object.assign(this.look, makeLook({
      exposure: 1.0, bloom: 0.06, ao: 1.0, saturation: 1.06, contrast: 0.16, vignette: 0.26, grain: 0.012, chroma: 0.003, dof: 0.5,
      shadowTint: new THREE.Color(0.0, 0.004, 0.012), highlightTint: new THREE.Color(0.012, 0.006, -0.004),
    }));
    this.clearColor.set(0xbfd0ea);
  }

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene;
    const rng = new Rng(2080);
    scene.environment = bakeRoomEnvironment(ctx.renderer);
    scene.environmentIntensity = 0.6;

    this.city = buildCityscape(rng.fork(), ctx.quality.density);
    this.city.group.rotation.y = Math.PI / 2;
    this.city.group.position.set(-W, -42, 0);
    scene.add(this.city.group);
    await ctx.step('classroom: city');

    // ---- shell ----
    // grey carpet tiles with a cool blue cast, as most classrooms have
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), new THREE.MeshStandardMaterial({ map: carpet(new Rng(2082), W * 2, D * 2), roughness: 0.96 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const b = new Builder();
    const wall = 0xe9ecf3, trim = 0xc9cedb, accent = 0x7fa0c9;
    b.box('matte', wall, [W * 2, H, 0.16], [0, H / 2, -D - 0.08]);
    b.box('matte', wall, [W * 2, H, 0.16], [0, H / 2, D + 0.08]);
    b.box('matte', wall, [0.16, H, D * 2], [W + 0.08, H / 2, 0]);
    b.box('matte', 0xf4f5f9, [W * 2 + 0.4, 0.14, D * 2 + 0.4], [0, H + 0.07, 0]);
    // the window wall: four tall openings between piers
    const WY0 = 0.62, WY1 = 2.9, WW = 1.9;
    const centres = [-4.2, -1.4, 1.4, 4.2];
    b.box('matte', wall, [0.16, WY0, D * 2], [-W - 0.08, WY0 / 2, 0]);
    b.box('matte', wall, [0.16, H - WY1, D * 2], [-W - 0.08, (H + WY1) / 2, 0]);
    for (let i = 0; i <= centres.length; i++) {
      const z0 = i === 0 ? -D : centres[i - 1]! + WW / 2, z1 = i === centres.length ? D : centres[i]! - WW / 2;
      b.box('matte', wall, [0.16, WY1 - WY0, z1 - z0], [-W - 0.08, (WY0 + WY1) / 2, (z0 + z1) / 2]);
    }
    for (const z of centres) {
      const frame = [v3(0, WY0, z - WW / 2), v3(0, WY0, z + WW / 2), v3(0, WY1, z + WW / 2), v3(0, WY1, z - WW / 2), v3(0, WY0, z - WW / 2)];
      b.add('metal', 0xf2f3f7, place(sweep(frame, () => 0.045, { radial: 6, polyline: true, steps: 4, startCap: 'flat', endCap: 'flat' }), [-W - 0.02, 0, 0]));
    }
    // one long windowsill of beech under all four windows, deep enough for the plants, on a white apron
    b.box('satin', 0xd2ad7f, [0.34, 0.04, D * 2 - 0.6], [-W + 0.17, WY0 - 0.02, 0], { r: 0.012 });
    b.box('satin', 0xb98c5a, [0.02, 0.04, D * 2 - 0.58], [-W + 0.34, WY0 - 0.02, 0], { r: 0.008 });
    b.box('satin', 0xf2f3f7, [0.02, 0.12, D * 2 - 0.64], [-W + 0.02, WY0 - 0.1, 0]);
    // skirting, and a band of colour at the foot of the front wall
    b.box('satin', trim, [W * 2, 0.1, 0.03], [0, 0.05, -D + 0.015]);
    b.box('satin', trim, [0.03, 0.1, D * 2], [W - 0.015, 0.05, 0]);
    b.box('satin', trim, [W * 2, 0.1, 0.03], [0, 0.05, D - 0.015]);
    b.box('satin', accent, [W * 2, 0.5, 0.02], [0, 0.35, -D + 0.012]);

    // ---- the front: a low stage, the display, the plinth ----
    // the stage is wood, the same honey beech as the cubbies at the back: boards running its length, a darker nosing on the edge
    const STAGE = { wide: 7.4, deep: 1.9, z: -5.05 }, BOARD = 0.158, grain = new Rng(2083);
    b.box('satin', 0xa47c4f, [STAGE.wide, STAGE_HEIGHT - 0.02, STAGE.deep], [0, (STAGE_HEIGHT - 0.02) / 2, STAGE.z]);
    const boards = Math.round(STAGE.deep / BOARD);
    for (let i = 0; i < boards; i++) {
      const tone = new THREE.Color(0xd6b081).offsetHSL(grain.range(-0.008, 0.008), grain.range(-0.04, 0.04), grain.range(-0.045, 0.03));
      b.box('satin', tone, [STAGE.wide - 0.04, 0.02, BOARD - 0.006], [0, STAGE_HEIGHT - 0.01, STAGE.z + STAGE.deep / 2 - BOARD / 2 - i * BOARD], { r: 0.003 });
    }
    b.box('satin', 0xb98c5a, [STAGE.wide + 0.02, STAGE_HEIGHT + 0.004, 0.05], [0, (STAGE_HEIGHT + 0.004) / 2, STAGE.z + STAGE.deep / 2 - 0.02], { r: 0.012 });
    for (const s of [-1, 1]) b.box('satin', 0xb98c5a, [0.05, STAGE_HEIGHT + 0.004, STAGE.deep], [s * (STAGE.wide / 2 - 0.02), (STAGE_HEIGHT + 0.004) / 2, STAGE.z], { r: 0.012 });
    b.box('gloss', 0x1a1e2c, [5.0, 2.3, 0.07], [0.2, 2.05, -D + 0.05], { r: 0.035 });
    b.box('metal', 0xd9dde8, [5.16, 2.46, 0.04], [0.2, 2.05, -D + 0.022], { r: 0.05 });
    // ---- tables for two pushed together, their chairs, slates, paper and pencil pots ----
    // the front tables stand in a group of their own: they are cleared away for the after-school club
    const sets = [this.frontRow, scene].map((to) => ({ to, b: new Builder(), chairs: [] as Spot[], slates: [] as Spot[], bags: [] as Spot[], colliders: [] as Obstacle[] }));
    for (const t of TABLES) {
      const set = sets[t.front ? 0 : 1]!;
      buildTable(set.b, t, rng);
      set.colliders.push({ kind: 'box', cx: t.x, cz: t.z, hx: TABLE.wide / 2 + 0.05, hz: TABLE.deep / 2 + 0.05, rot: -t.yaw * RAD });
      for (const p of t.places) {
        const used = !!p.who || !!p.free;
        const state: ChairState = used ? 'out' : p.chair ?? 'in';
        // a chair faces across the table; one pushed back is turned and shoved aside a little
        const back = state === 'in' ? 0.33 : state === 'out' ? TABLE.seatZ : 0.62;
        const [cx, cz] = onTable(t, p.side * TABLE.seatX + (state === 'askew' ? rng.range(-0.12, 0.12) : 0), p.facing * back);
        const turn = (p.facing === 1 ? 180 : 0) + t.yaw + (state === 'askew' ? rng.pick([-1, 1]) * rng.range(10, 22) : rng.range(-4, 4));
        set.chairs.push([cx, 0, cz, turn]);
        if (used || rng.chance(0.4)) {
          // a tablet standing up, its screen turned toward the chair
          const [sx, sz] = onTable(t, p.side * TABLE.seatX, p.facing * 0.1);
          set.slates.push([sx, TABLE.top, sz, turn + 180 + rng.range(-8, 8)]);
        }
        if (p.who) {
          set.colliders.push({ kind: 'circle', cx, cz, r: 0.3 });
          if (rng.chance(0.75)) {
            const [bx, bz] = onTable(t, p.side * 0.76, p.facing * 0.52);
            set.bags.push([bx, 0, bz, turn + p.side * 70 + rng.range(-25, 25)]);
          }
        }
      }
    }
    for (const set of sets) {
      set.b.finish(set.to);
      await dress(ctx, set.to, 'chair', set.chairs);
      set.to.add(tablets(set.slates));
      await dress(ctx, set.to, 'backpack', set.bags);
    }
    // the back tables' obstacles stay; the front ones come and go with their tables (see setScene)
    this.colliders.obstacles.push(...sets[1]!.colliders);
    this.frontColliders = sets[0]!.colliders;
    scene.add(this.frontRow);
    await ctx.step('classroom: desks');

    // ---- the front: the headset's plinth, and the teacher's desk up on the stage ----
    // the plinth is cut down to the lower eye line: squashed in height only, so its footprint stays the same
    const [, plinthTall] = await sizeOf(ctx, 'plinth');
    (await dress(ctx, scene, 'plinth', [[CLASSROOM.plinth.x, 0, CLASSROOM.plinth.z]])).scale.y = CLASSROOM.plinth.y / plinthTall;
    // a long white slab on two slab ends, a recessed panel between them and a hairline of light under the top's edge
    {
      const c = Math.cos(DESK.yaw), s = Math.sin(DESK.yaw);
      const at = (lx: number, y: number, lz: number): [number, number, number] =>
        [TEACHER_DESK.x + lx * c + lz * s, STAGE_HEIGHT + y, TEACHER_DESK.z - lx * s + lz * c];
      const rot: [number, number, number] = [0, DESK.yaw, 0];
      const { wide, deep, top } = DESK, slab = 0.035, under = top - slab;
      b.box('gloss', 0xf4f5f7, [wide, slab, deep], at(0, top - slab / 2, 0), { r: 0.006, rot });
      for (const e of [-1, 1]) b.box('satin', 0xe8eaed, [slab, under, deep - 0.02], at(e * (wide / 2 - slab / 2 - 0.01), under / 2, 0), { r: 0.004, rot });
      b.box('satin', 0xdadde2, [wide - 0.1, 0.44, 0.018], at(0, under - 0.22, 0), { rot });
      for (const f of [-1, 1]) b.box('glow', 0xa8dcff, [wide - 0.12, 0.005, 0.005], at(0, under - 0.004, f * (deep / 2 - 0.012)), { rot });
      scene.add(teacherThings(at(0, top, 0), DESK.yaw));
    }

    // ---- the back wall: cubbies with bags and jumpers ----
    const [cubbyWide, , cubbyDeep] = await sizeOf(ctx, 'lockers');
    const cubbies = Math.floor((W * 2 - 1.6) / (cubbyWide + 0.06));
    await dress(ctx, scene, 'lockers', Array.from({ length: cubbies }, (_, i): Spot => [(i - (cubbies - 1) / 2) * (cubbyWide + 0.06), 0, D - cubbyDeep / 2 - 0.02, 180]));

    // ---- the right wall: books, a pin board and the door ----
    const [, , shelfDeep] = await sizeOf(ctx, 'bookshelf');
    await dress(ctx, scene, 'bookshelf', [[W - shelfDeep / 2 - 0.02, 0, BOOKSHELF_Z, -90]]);
    this.colliders.box(W - shelfDeep / 2, BOOKSHELF_Z, shelfDeep / 2 + 0.05, 0.55);
    // ---- the back wall: cubbies with bags; the right wall: a pin board and the door ----
    await dress(ctx, scene, 'door', [[W - 0.07, 0, -1.9, -90]]);
    // the pin board of everyone's pictures, and posters either side of the display
    const hang = async (id: string, wide: number, x: number, y: number, z: number, turn: number): Promise<void> => {
      const picture = await ctx.assets.picture(id);
      const hung = framed(picture.map, wide, (wide * picture.entry.size[1]) / picture.entry.size[0]);
      hung.position.set(x, y, z);
      hung.rotation.y = turn;
      scene.add(hung);
    };
    await hang('pinboard', 3.4, W - 0.005, 1.72, 2.2, -Math.PI / 2);
    // the two posters by the pin board are slim wall screens now, like the ad boards in a shopping centre
    const signage = async (id: string, x: number, y: number, z: number, turn: number): Promise<void> => {
      const picture = await ctx.assets.picture(id);
      const [pw, ph] = picture.entry.size;
      // crop the picture to the screen's portrait shape, keeping its middle
      const map = picture.map.clone();
      const want = SIGN.wide / SIGN.tall, have = pw / ph;
      if (have > want) { map.repeat.set(want / have, 1); map.offset.set((1 - want / have) / 2, 0); }
      else { map.repeat.set(1, have / want); map.offset.set(0, (1 - have / want) / 2); }
      map.needsUpdate = true;
      const sign = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(SIGN.wide + 0.012, SIGN.tall + 0.012, 0.024), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.3, metalness: 0.6 }));
      body.position.z = 0.012;
      body.castShadow = true;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(SIGN.wide, SIGN.tall), new THREE.MeshBasicMaterial({ map }));
      face.material.color.setScalar(1.12);
      face.position.z = 0.0245;
      sign.add(body, face);
      sign.position.set(x, y, z);
      sign.rotation.y = turn;
      scene.add(sign);
    };
    await signage('poster-newstart', W - 0.005, 1.6, -0.45, -Math.PI / 2);
    await signage('poster-stars', W - 0.005, 1.6, 4.65, -Math.PI / 2);
    // "Class 1" over the door: separate cut-out letters on a shallow arch, a quiet slate serif rather than nursery colours
    {
      const text = 'Class 1', tall = 0.2, radius = 1.7, door = { z: -1.9, top: 2.1 };
      const measure = document.createElement('canvas').getContext('2d')!;
      measure.font = '600 200px Georgia, "Times New Roman", serif';
      const widths = [...text].map((ch) => (measure.measureText(ch).width / 200) * tall + 0.035);
      const span = widths.reduce((a, b) => a + b, 0);
      let along = -span / 2;
      for (const [i, ch] of [...text].entries()) {
        const w = widths[i]!;
        const angle = (along + w / 2) / radius;
        along += w;
        if (ch === ' ') continue;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const g = canvas.getContext('2d')!;
        g.font = measure.font;
        g.textAlign = 'center';
        g.textBaseline = 'alphabetic';
        g.fillStyle = '#ffffff';
        g.fillText(ch, 128, 200);
        const map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        const letter = new THREE.Mesh(
          new THREE.PlaneGeometry(tall * 1.28, tall * 1.28),
          new THREE.MeshStandardMaterial({ map, color: 0x2f4858, roughness: 0.45, metalness: 0.25, alphaTest: 0.5, side: THREE.DoubleSide }),
        );
        // the letter canvas puts the baseline at 200/256: centre the arch on the letters' bodies
        letter.position.set(W - 0.018, door.top + 0.28 - radius + radius * Math.cos(angle), door.z + radius * Math.sin(angle));
        letter.rotation.set(0, -Math.PI / 2, -angle);
        letter.castShadow = true;
        scene.add(letter);
      }
    }
    await hang('poster-harbour', 1.5, -3.82, 1.95, -D + 0.005, 0);
    await hang('poster-planets', 0.95, 3.95, 1.9, -D + 0.005, 0);
    // plants in the corners, and a row of little ones along the window sills
    const corners: Spot[] = [[-4.5, 0, -5.4], [4.5, 0, -5.4], [-4.5, 0, 5.2]];
    await dress(ctx, scene, 'plant-tall', corners.map(([x, y, z]): Spot => [x, y, z, rng.range(0, 360)]));
    for (const [x, , z] of corners) this.colliders.circle(x, z, 0.4);
    await dress(ctx, scene, 'plant-small', centres.map((z): Spot => [-W + 0.13, WY0, z + rng.range(-0.6, 0.6), rng.range(0, 360), rng.range(0.9, 1.25)]));
    // roller blinds, each left at a different height
    centres.forEach((z, i) => {
      const drop = BLIND_DROPS[i]!;
      b.box('matte', 0xe6e2d6, [0.01, drop, WW + 0.06], [-W + 0.06, WY1 - drop / 2, z]);
      b.box('satin', 0xc9ccd2, [0.025, 0.025, WW + 0.06], [-W + 0.065, WY1 - drop, z], { r: 0.008 });
      b.box('satin', 0xf0f1f4, [0.09, 0.09, WW + 0.16], [-W + 0.06, WY1 + 0.06, z], { r: 0.02 });
    });
    // the room's paper: charts on the piers between the windows, a display board over the cubbies
    const sheet = (texture: THREE.Texture, wide: number, tall: number, x: number, y: number, z: number, turn: number): void => {
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(wide, tall), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
      paper.position.set(x, y, z);
      paper.rotation.y = turn;
      paper.receiveShadow = true;
      scene.add(paper);
    };
    sheet(chartPaper(new Rng(7)), 0.62, 0.86, -W + 0.004, 1.75, -2.8, Math.PI / 2);
    sheet(feelingsChart(), 0.66, 0.66, -W + 0.004, 1.85, 0, Math.PI / 2);
    sheet(chartPaper(new Rng(11)), 0.62, 0.86, -W + 0.004, 1.7, 2.8, Math.PI / 2);
    const board = framed(displayBoard(new Rng(9)), 4.2, 1.05, 0xc0392b);
    board.position.set(-0.3, 2.3, D - 0.005);
    board.rotation.y = Math.PI;
    scene.add(board);
    // a flip chart on its easel in the front corner by the windows
    const easel = { x: -4.25, z: -3.55, turn: 55 * RAD };
    const ex = (lx: number, lz: number): [number, number] => [easel.x + lx * Math.cos(easel.turn) + lz * Math.sin(easel.turn), easel.z - lx * Math.sin(easel.turn) + lz * Math.cos(easel.turn)];
    for (const [lx, lz, lean] of [[-0.3, 0.05, 0.1], [0.3, 0.05, -0.1], [0, -0.28, 0]] as const) {
      const [x, z] = ex(lx, lz);
      b.box('metal', 0x8e959e, [0.022, 1.75, 0.022], [x, 0.87, z], { rot: [lz < 0 ? -0.2 : 0.06, easel.turn, lean] });
    }
    const [px, pz] = ex(0, 0.09);
    b.box('satin', 0xf4f4f2, [0.66, 0.84, 0.02], [px, 1.32, pz], { rot: [-0.08, easel.turn, 0] });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.78), new THREE.MeshStandardMaterial({ map: chartPaper(new Rng(21)), roughness: 0.9 }));
    const [qx, qz] = ex(0, 0.104);
    pad.position.set(qx, 1.32, qz);
    pad.rotation.set(-0.08, easel.turn, 0, 'YXZ');
    scene.add(pad);
    this.colliders.circle(easel.x, easel.z, 0.42);
    b.finish(scene);
    await ctx.step('classroom: furniture');

    // ---- light ----
    this.fill = new THREE.HemisphereLight(0xdfe8ff, 0xb7b0a8, 0.9);
    this.sun = new THREE.DirectionalLight(0xfff4e6, 3);
    this.sun.position.set(-12, 9, -3);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = ctx.quality.shadows;
    this.sun.shadow.mapSize.set(ctx.quality.shadowMapSize, ctx.quality.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 40;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 5;
    scene.add(this.fill, this.sun, this.sun.target);
    // light you can see: a shaft from each window, and dust that glints where it drifts through one
    // the light comes in under each blind
    this.beams = buildSunbeams(new Rng(2081), centres.map((z, i) => ({ x: -W, y0: WY0, y1: WY1 - BLIND_DROPS[i]!, z0: z - WW / 2, z1: z + WW / 2 })),
      { min: new THREE.Vector3(-W, 0.05, -D), max: new THREE.Vector3(W, H - 0.05, D) }, ctx.quality.density);
    scene.add(this.beams.group);
    // pendant lights: a white orb the size of a child's head, hung from the ceiling on a thin wire as long as the orb is wide
    const panels = new Builder();
    // the room is lit by these lamps: each orb and each wall dome carries a light of its own
    const lamp = (x: number, y: number, z: number, power: number): void => {
      const light = new THREE.PointLight(LAMP_COLOR, power, 0, 2);
      light.position.set(x, y, z);
      light.userData.power = power;
      this.lamps.push(light);
      scene.add(light);
    };
    for (const x of LIGHT_COLS) for (const z of LIGHT_ROWS) {
      const orb = new THREE.SphereGeometry(ORB_R, 32, 20);
      orb.deleteAttribute('uv');
      panels.add('glow', 0xffffff, place(orb, [x, H - 2 * ORB_R - ORB_R, z]));
      panels.cyl('metal', 0x2a2a2a, 0.002, 2 * ORB_R + 0.01, [x, H - 2 * ORB_R - 0.005, z], { radial: 6 });
      lamp(x, H - 3 * ORB_R, z, PENDANT_POWER);
    }
    this.ceiling = panels.finish(scene, { glow: 2.2, shadows: false }).glow!;
    // the border light: a white channel all the way round, its strip of light along the top and bottom edges
    {
      const border = new Builder(), o = BORDER.off, y = BORDER.y;
      const runs: [number, number, number, number][] = [
        // [centre x, centre z, length, turned along z?]
        [0, -D + o, W * 2 - 2 * o, 0], [0, D - o, W * 2 - 2 * o, 0], [-W + o + 0.02, 0, D * 2 - 2 * o, 1],
        // the right wall, in two runs either side of the door
        [W - o, (-D + o + DOOR_GAP.z0) / 2, DOOR_GAP.z0 - (-D + o), 1], [W - o, (DOOR_GAP.z1 + D - o) / 2, D - o - DOOR_GAP.z1, 1],
      ];
      for (const [x, z, len, alongZ] of runs) {
        const size = (a: number, b: number, c: number): [number, number, number] => (alongZ ? [c, b, a] : [a, b, c]);
        border.box('satin', 0xf4f6fa, size(len, 0.05, 0.03), [x, y, z], { r: 0.008 });
        for (const edge of [-1, 1]) border.box('glow', BORDER.color, size(len, 0.005, 0.02), [x, y + edge * 0.0275, z]);
      }
      this.border = border.finish(scene, { glow: 2.4, shadows: false }).glow!;
      if (ctx.quality.tier !== 'low') {
        for (const [x, z] of BORDER_LAMPS) {
          const light = new THREE.PointLight(BORDER.color, BORDER.power, 0, 2);
          light.position.set(x, y + 0.15, z);
          light.userData.power = BORDER.power;
          this.lamps.push(light);
          scene.add(light);
        }
      }
    }
    // the windows' own light: a soft panel of sky in each opening, so daylight comes from where the glass is
    RectAreaLightUniformsLib.init();
    for (const [i, z] of centres.entries()) {
      const sky = new THREE.RectAreaLight(0xe4ecff, 0, WW, WY1 - BLIND_DROPS[i]! - WY0);
      sky.position.set(-W + 0.02, (WY0 + WY1 - BLIND_DROPS[i]!) / 2, z);
      sky.lookAt(0, sky.position.y, z);
      this.windows.push(sky);
      scene.add(sky);
    }
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe0ff, roughness: 0.04, transparent: true, opacity: 0.08, depthWrite: false });
    for (const z of centres) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(WW, WY1 - WY0), glassMat);
      pane.position.set(-W - 0.03, (WY0 + WY1) / 2, z);
      pane.rotation.y = Math.PI / 2;
      scene.add(pane);
    }

    // ---- the display ----
    this.screen = new Panel(1920, 880, { world: true });
    this.screen.mesh.scale.set(4.84, 2.2, 1);
    this.screen.mesh.position.set(0.2, 2.05, -D + 0.092);
    this.screen.mesh.material.color.setScalar(1.25);
    scene.add(this.screen.mesh);
    const screenLight = new THREE.PointLight(0x9fc6ff, 2.2, 9, 1.6);
    screenLight.position.set(0.2, 2.1, -4.9);
    scene.add(screenLight);

    // a soft light over the plinth, and the mark on the empty chair
    scene.add(makeHalo(0x7fc8ff, 1.1, 0.3).translateX(CLASSROOM.plinth.x).translateY(CLASSROOM.plinth.y + 0.1).translateZ(CLASSROOM.plinth.z));
    this.marker = new THREE.Mesh(torus(1, 0.036, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.82, 1.0).multiplyScalar(2.6), transparent: true, opacity: 0, depthWrite: false }));
    this.marker.visible = false;
    scene.add(this.marker);

    // ---- Tuesday's poster table ----
    const P = CLASSROOM.posterTable;
    const tableTop = (await sizeOf(ctx, 'craft-table'))[1];
    await dress(ctx, this.posterGroup, 'craft-table', [[P.x, 0, P.z]]);
    await dress(ctx, this.posterGroup, 'art-supplies', [[P.x + 0.92, tableTop, P.z + 0.32, -30], [P.x - 0.98, tableTop, P.z - 0.34, 140, 0.8]]);
    this.poster = new Panel(1100, 600, { world: true });
    this.poster.mesh.scale.set(1.7, 0.927, 1);
    this.poster.mesh.rotation.x = -Math.PI / 2;
    this.poster.mesh.position.set(P.x, tableTop + 0.004, P.z);
    this.posterGroup.add(this.poster.mesh);
    this.posterGroup.visible = false;
    scene.add(this.posterGroup);
    this.setPoster(null);

    // ---- people ----
    const teacher = this.addPerson('teacher', await Character.create(ctx, CAST.teacher, 'teacher'));
    teacher.placeAt(CLASSROOM.teacher);
    this.colliders.circle(CLASSROOM.teacher.position.x, CLASSROOM.teacher.position.z, 0.4);
    for (const s of SEATING) {
      const person = this.addPerson(s.who, await Character.create(ctx, CAST[s.who], s.who));
      person.placeAt(s.seat).setPose(s.pose, { immediate: true, seat: SEAT });
      if (s.who !== 'jamie') person.setLiveliness(0.7);
    }
    // the three voices of Friday's consultation arrive as projections on the stage
    this.stageGlow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.75, 1.0).multiplyScalar(2), transparent: true, opacity: 0, depthWrite: false }));
    this.stageGlow.rotation.x = -Math.PI / 2;
    this.stageGlow.position.copy(CLASSROOM.stage).add(v3(0, 0.006, 0));
    scene.add(this.stageGlow);
    for (const who of ['alex', 'sam', 'riley'] as const) {
      const voice = this.addPerson(who, await Character.create(ctx, CAST[who], who, true));
      voice.place(CLASSROOM.stage.x, CLASSROOM.stage.y, CLASSROOM.stage.z, characterYaw(anchorToward(CLASSROOM.stage.x, 0, CLASSROOM.stage.z, 0.4, 3)));
      voice.setProjected(0x4fb4ff);
      voice.root.visible = false;
    }
    const beamGeo = new THREE.CylinderGeometry(0.62, 0.5, 2.3, 32, 1, true);
    beamGeo.translate(0, 1.15, 0);
    this.stageBeam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uShow: { value: 0 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uShow, uTime; varying vec2 vUv; void main(){ float lines = 0.75 + 0.25 * sin(vUv.y * 160.0 - uTime * 6.0); gl_FragColor = vec4(vec3(0.3, 0.62, 1.0) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.6) * lines * 0.34 * uShow, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    }));
    this.stageBeam.position.copy(CLASSROOM.stage);
    scene.add(this.stageBeam);
    this.stageLight = new THREE.PointLight(0x6fc0ff, 0, 5, 1.8);
    this.stageLight.position.copy(CLASSROOM.stage).add(v3(0, 1.3, 0.8));
    scene.add(this.stageLight);

    this.colliders.bounds = { kind: 'rect', minX: -W, maxX: W, minZ: -D + 0.2, maxZ: D - 0.45 };
    this.colliders.box(0, -5.05, 3.7, 0.95).circle(CLASSROOM.plinth.x, CLASSROOM.plinth.z, 0.36);
    this.setVariant('morning', true);
    this.setScene('class');
    this.setScreen({ kind: 'title', eyebrow: '', title: '', body: '' });
  }

  /** Daylight, the gold of late afternoon, or the dimmed room of the Future Viewer. */
  setVariant(variant: ClassroomVariant, immediate = false): void {
    this.variant = variant;
    const t = this.target;
    if (variant === 'morning') Object.assign(t, { sun: 4.4, warm: 0, room: 1, night: 0 });
    else if (variant === 'golden') Object.assign(t, { sun: 6.2, warm: 1, room: 0.12, night: 0.14 });
    else Object.assign(t, { sun: 0.5, warm: 0, room: 0.12, night: 0.1 });
    if (immediate) {
      Object.assign(this.mood, t);
      this.applyMood();
    }
  }

  private applyMood(): void {
    const m = this.mood;
    this.sun.intensity = m.sun;
    this.sun.color.setRGB(1.0, 0.96 - 0.38 * m.warm, 0.9 - 0.66 * m.warm);
    // a low sun reaches right across the room
    this.sun.position.set(-12, 9 - 6.2 * m.warm, -3 + 2 * m.warm);
    // all the light has a source: the lamps, the border light, the display and the windows; no light from nowhere
    for (const l of this.lamps) l.intensity = (l.userData.power as number) * m.room;
    const daylight = m.sun / 4.4;
    for (const w of this.windows) {
      w.intensity = 2.2 * daylight;
      w.color.setRGB(0.9 + 0.1 * m.warm, 0.93 - 0.2 * m.warm, 1.0 - 0.45 * m.warm);
    }
    // about nine tenths of the light is from the lamps, the border and the windows: only a trace of ambient is left
    this.fill.intensity = 0.012;
    this.fill.color.setRGB(0.95 + 0.05 * m.warm, 0.93 - 0.18 * m.warm, 0.9 - 0.4 * m.warm);
    (this.ceiling.material as THREE.MeshBasicMaterial).color.setScalar(0.08 + 2.2 * m.room);
    (this.border.material as THREE.MeshBasicMaterial).color.setScalar(0.1 + 2.4 * m.room);
    this.scene.environmentIntensity = 0.03 + 0.03 * m.room + 0.02 * m.warm;
    this.city.setNight(m.night);
    this.beams.setSun(_sunDir.copy(this.sun.target.position).sub(this.sun.position), this.sun.color, (m.sun / 4.4) * (1.2 + 0.2 * m.warm));
    this.look.exposure = this.variant === 'viewer' ? 1.15 : 1.0;
    this.look.saturation = 1.06 + 0.16 * m.warm;
    this.look.highlightTint.setRGB(0.012 + 0.03 * m.warm, 0.006 + 0.01 * m.warm, -0.004 - 0.02 * m.warm);
  }

  /** Arranges who is in the room. Monday and Wednesday the class is seated; Tuesday a few stand at the poster. */
  setScene(scene: 'class' | 'poster'): void {
    const poster = scene === 'poster';
    this.posterGroup.visible = poster;
    this.frontRow.visible = !poster;
    const P = CLASSROOM.posterTable;
    const standing: Partial<Record<CastName, [number, number]>> = { jamie: [P.x - 1.6, P.z + 0.25], priya: [P.x - 0.1, P.z - 1.05], leo: [P.x + 1.65, P.z - 0.05] };
    for (const o of this.sceneColliders) this.colliders.remove(o);
    const kept = this.colliders.obstacles.length;
    if (poster) {
      this.colliders.box(P.x, P.z, 1.15, 0.6);
      for (const [x, z] of Object.values(standing)) this.colliders.circle(x, z, 0.32);
    } else {
      this.colliders.obstacles.push(...this.frontColliders);
    }
    this.sceneColliders = this.colliders.obstacles.slice(kept);
    for (const s of SEATING) {
      const person = this.cast[s.who]!;
      const spot = standing[s.who];
      if (poster) {
        person.root.visible = !!spot;
        if (spot) {
          person.placeAt(anchorToward(spot[0], 0, spot[1], P.x, P.z)).setPose('stand', { immediate: true });
          person.lookAtPoint(null);
        }
      } else {
        person.root.visible = true;
        person.placeAt(s.seat).setPose(s.pose, { immediate: true, seat: SEAT });
      }
    }
    this.cast.teacher!.root.visible = !poster;
  }

  override reset(): void {
    this.setMarker(null);
    this.setVoice(null);
    this.setPoster(null);
  }

  /** A ring of light that says "here": on the floor where the player should stand, or on a chair. Null puts it out. */
  setMarker(at: THREE.Vector3 | null, radius = 0.3): void {
    this.markerTarget = at ? 1 : 0;
    if (!at) return;
    this.marker.position.copy(at);
    this.markerRadius = radius;
  }

  /** Brings one of Friday's three voices onto the stage as a projection; null clears the stage. */
  setVoice(who: 'alex' | 'sam' | 'riley' | null): void {
    this.voiceTarget = who;
    if (who) this.cast[who]!.root.visible = true;
  }

  /** What the front display shows. */
  setScreen(content: ScreenContent): void {
    this.screenPulse = 1;
    const theme = THEMES.real;
    this.screen.paint((ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#0f1730');
      g.addColorStop(1, '#1a2a52');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // faint concentric rings: the Echo mark
      ctx.strokeStyle = 'rgba(140, 190, 255, 0.16)';
      ctx.lineWidth = 3;
      for (let i = 1; i <= 6; i++) {
        ctx.beginPath();
        ctx.arc(w - 300, h / 2, i * 62, 0, TAU);
        ctx.stroke();
      }
      ctx.textBaseline = 'middle';
      if (content.kind === 'title') {
        ctx.fillStyle = theme.accent;
        ctx.font = font(600, 34);
        spaced(ctx, content.eyebrow.toUpperCase(), 130, 190, 10);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(300, 118);
        wrap(ctx, content.title, w - 520).forEach((l, i) => ctx.fillText(l, 124, 330 + i * 128));
        const n = wrap(ctx, content.title, w - 520).length;
        ctx.fillStyle = 'rgba(220, 232, 255, 0.9)';
        ctx.font = font(400, 48);
        wrap(ctx, content.body, w - 620).forEach((l, i) => ctx.fillText(l, 130, 330 + n * 128 + 20 + i * 62));
      } else if (content.kind === 'voice') {
        ctx.fillStyle = theme.accent;
        ctx.font = font(600, 34);
        spaced(ctx, 'ECHO COMMUNITY CONSULTATION', 130, 150, 10);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(300, 130);
        ctx.fillText(content.name, 124, 330);
        ctx.fillStyle = 'rgba(220, 232, 255, 0.92)';
        ctx.font = font(300, 58);
        wrap(ctx, `“${content.line}”`, w - 560).forEach((l, i) => ctx.fillText(l, 130, 500 + i * 76));
      } else {
        const f = content.future;
        ctx.fillStyle = theme.accent;
        ctx.font = font(600, 32);
        spaced(ctx, content.heading, 110, 96, 9);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(600, 104);
        ctx.fillText(f.title, 104, 216);
        ctx.fillStyle = 'rgba(220, 232, 255, 0.92)';
        ctx.font = font(300, 46);
        ctx.fillText(f.summary, 110, 310);
        const col = (x: number, good: boolean, head: string, body: string): void => {
          glass(ctx, x, 380, 830, 300, theme, { radius: 30, glow: 0.4, border: good ? 'rgba(150, 230, 190, 0.7)' : 'rgba(255, 200, 140, 0.7)', borderWidth: 3 });
          ctx.fillStyle = good ? '#9fe6c9' : '#ffcf9a';
          ctx.font = font(600, 28);
          spaced(ctx, good ? 'WHAT IT GIVES' : 'WHAT IT COSTS', x + 44, 434, 6);
          ctx.fillStyle = '#ffffff';
          ctx.font = font(600, 40);
          let y = 500;
          for (const l of wrap(ctx, head, 740)) {
            ctx.fillText(l, x + 44, y);
            y += 50;
          }
          ctx.fillStyle = 'rgba(220, 232, 255, 0.88)';
          ctx.font = font(400, 32);
          for (const l of wrap(ctx, body, 740)) {
            ctx.fillText(l, x + 44, y + 8);
            y += 42;
          }
        };
        col(104, true, f.gain.head, f.gain.body);
        col(984, false, f.cost.head, f.cost.body);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(300, 56);
        ctx.fillText(`“${f.question}”`, 110, 762);
        ctx.fillStyle = 'rgba(200, 215, 245, 0.7)';
        ctx.font = font(400, 28);
        ctx.textAlign = 'right';
        ctx.fillText(content.note, w - 110, 826);
        ctx.textAlign = 'left';
      }
    });
  }

  /** The welcome poster on Tuesday's table: blank with a prompt, or carrying the phrase the player chose. */
  setPoster(phrase: string | null): void {
    this.poster.paint((ctx, w, h) => {
      ctx.fillStyle = '#fdfaf2';
      ctx.fillRect(0, 0, w, h);
      // hand-drawn border and doodles
      ctx.strokeStyle = '#e0703f';
      ctx.lineWidth = 10;
      roundRect(ctx, 26, 26, w - 52, h - 52, 30);
      ctx.stroke();
      const r = new Rng(12);
      for (let i = 0; i < 26; i++) {
        const x = r.range(60, w - 60), y = r.chance(0.5) ? r.range(50, 110) : r.range(h - 110, h - 50);
        ctx.fillStyle = r.pick(['#e0b34e', '#4f8fd0', '#5fa07a', '#a98cc4', '#e0703f']);
        ctx.beginPath();
        if (i % 3 === 0) ctx.arc(x, y, r.range(7, 15), 0, TAU);
        else for (let k = 0; k < 10; k++) {
          const a = (k / 10) * TAU - Math.PI / 2, rr = k % 2 ? 7 : 17;
          ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.fill();
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2e3650';
      ctx.font = font(700, 92);
      ctx.fillText('WELCOME!', w / 2, 200);
      if (phrase) {
        ctx.fillStyle = '#e0703f';
        ctx.font = font(600, 64);
        wrap(ctx, phrase, w - 200).forEach((l, i, all) => ctx.fillText(l, w / 2, 372 + (i - (all.length - 1) / 2) * 76));
      } else {
        ctx.strokeStyle = 'rgba(46, 54, 80, 0.35)';
        ctx.lineWidth = 5;
        ctx.setLineDash([18, 14]);
        roundRect(ctx, 150, 300, w - 300, 150, 24);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#4f8fd0';
      ctx.font = font(500, 34);
      ctx.fillText('from all of us at Harbour District School', w / 2, h - 150);
    });
  }

  override update(frame: FrameContext): void {
    super.update(frame);
    const { dt, time } = frame;
    this.city.update(time);
    this.beams.update(time, frame.pixelHeight);
    const m = this.mood, t = this.target;
    if (Math.abs(m.sun - t.sun) + Math.abs(m.warm - t.warm) + Math.abs(m.room - t.room) + Math.abs(m.night - t.night) > 0.002) {
      m.sun = damp(m.sun, t.sun, 1.4, dt);
      m.warm = damp(m.warm, t.warm, 1.4, dt);
      m.room = damp(m.room, t.room, 1.4, dt);
      m.night = damp(m.night, t.night, 1.4, dt);
      this.applyMood();
    }
    this.screenPulse = Math.max(0, this.screenPulse - dt * 2);
    this.screen.mesh.material.color.setScalar(1.25 + this.screenPulse * 1.5);
    // voices fade up as projections and fade away again
    let any = 0;
    for (const who of ['alex', 'sam', 'riley']) {
      const person = this.cast[who]!;
      const k = (this.voiceShown[who] = damp(this.voiceShown[who]!, this.voiceTarget === who ? 1 : 0, 5, dt));
      any = Math.max(any, k);
      if (person.root.visible) {
        person.root.scale.set(1, Math.max(0.001, k), 1).multiplyScalar(0.92);
        if (k < 0.01 && this.voiceTarget !== who) person.root.visible = false;
      }
    }
    (this.stageGlow.material as THREE.MeshBasicMaterial).opacity = any * (0.5 + 0.2 * Math.sin(time * 3));
    const beam = (this.stageBeam.material as THREE.ShaderMaterial).uniforms;
    beam.uShow!.value = any;
    beam.uTime!.value = time;
    this.stageLight.intensity = any * 2.4;
    this.markerShown = damp(this.markerShown, this.markerTarget, 6, dt);
    this.marker.visible = this.markerShown > 0.01;
    (this.marker.material as THREE.MeshBasicMaterial).opacity = this.markerShown * 0.9;
    const pulse = this.markerRadius * (1 + 0.08 * Math.sin(time * 3.4));
    this.marker.scale.set(pulse, 1, pulse);
  }
}


// ---- the room's furniture and paper ----

/**
 * What lives on the teacher's desk: a mug of coffee, a keycard on its lanyard, flowers in a glass vase and a thank-you
 * card with two balloons on it. `origin` is the middle of the desk's top; +Z in the desk's frame is the class's side.
 */
const teacherThings = (origin: readonly [number, number, number], yaw: number): THREE.Group => {
  const group = new THREE.Group();
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number, shadows = true): THREE.Mesh => {
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
    return mesh;
  };
  const std = (color: THREE.ColorRepresentation, roughness = 0.5, metalness = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness });

  // the mug, by the teacher's hand, half full
  const mug = { x: 0.48, z: 0.12, r: 0.04, tall: 0.095 };
  add(new THREE.Mesh(new THREE.CylinderGeometry(mug.r, mug.r * 0.92, mug.tall, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.35, side: THREE.DoubleSide })), mug.x, mug.tall / 2, mug.z);
  add(new THREE.Mesh(new THREE.CircleGeometry(mug.r * 0.92, 32).rotateX(-Math.PI / 2), std(0x3d5a80, 0.35)), mug.x, 0.002, mug.z);
  add(new THREE.Mesh(new THREE.CircleGeometry(mug.r - 0.003, 32).rotateX(-Math.PI / 2), std(0x3a2416, 0.15)), mug.x, mug.tall - 0.018, mug.z, false);
  add(new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.006, 10, 24), std(0x3d5a80, 0.35)), mug.x + mug.r + 0.012, mug.tall * 0.55, mug.z);

  // the keycard, face up, its lanyard coiled beside it
  const card = add(new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.0016, 0.086), [std(0xf4f6f8, 0.4), std(0xf4f6f8, 0.4), new THREE.MeshStandardMaterial({ map: keycardFace(), roughness: 0.35 }), std(0xf4f6f8, 0.4), std(0xf4f6f8, 0.4), std(0xf4f6f8, 0.4)]), 0.24, 0.0008, 0.2);
  card.rotation.y = 0.5;
  const lanyard = add(new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.006, 4, 48), std(0x1f3a68, 0.8)), 0.3, 0.0015, 0.08);
  lanyard.rotation.x = Math.PI / 2;
  lanyard.scale.set(1, 1.35, 0.25);

  // flowers in a glass vase, at the far end
  const vase = { x: -0.55, z: -0.1 };
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.04, 0.17, 32), new THREE.MeshPhysicalMaterial({ color: 0xdfeff2, roughness: 0.05, transmission: 0.9, thickness: 0.01, transparent: true, opacity: 0.45 })), vase.x, 0.085, vase.z, false);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.038, 0.09, 24), new THREE.MeshStandardMaterial({ color: 0xbfe0e0, roughness: 0.1, transparent: true, opacity: 0.35 })), vase.x, 0.047, vase.z, false);
  const rng = new Rng(518), stem = std(0x4f7d3a, 0.7), petals = [0xf28fae, 0xffd166, 0xfdfdfb, 0xe85d75, 0xc39bd3];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rng.range(-0.3, 0.3), lean = rng.range(0.12, 0.38), len = rng.range(0.22, 0.3);
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
    const s = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.003, len, 6), stem), vase.x + dir.x * len / 2, 0.05 + dir.y * len / 2, vase.z + dir.z * len / 2);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const head = add(new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.024, 0.034), 1), std(rng.pick(petals), 0.7)), vase.x + dir.x * len, 0.05 + dir.y * len, vase.z + dir.z * len);
    head.scale.y = 0.75;
    head.rotation.set(rng.range(0, TAU), rng.range(0, TAU), 0);
    if (i % 2 === 0) {
      const leaf = add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), std(0x5d9147, 0.7)), vase.x + dir.x * len * 0.6, 0.05 + dir.y * len * 0.6, vase.z + dir.z * len * 0.6);
      leaf.scale.set(1, 0.18, 0.4);
      leaf.rotation.set(0, -a, lean + 0.4);
    }
  }

  // the thank-you card, stood up as a tent, its front to the class
  const tent = { x: -0.18, z: 0.02, wide: 0.15, tall: 0.11, lean: 18 * RAD };
  const cs = Math.sin(tent.lean), cc = Math.cos(tent.lean);
  const front = add(new THREE.Mesh(new THREE.PlaneGeometry(tent.wide, tent.tall), new THREE.MeshStandardMaterial({ map: thankYouCard(), roughness: 0.8 })), tent.x, (tent.tall / 2) * cc, tent.z + (tent.tall / 2) * cs);
  front.rotation.x = -tent.lean;
  const behind = add(new THREE.Mesh(new THREE.PlaneGeometry(tent.wide, tent.tall), new THREE.MeshStandardMaterial({ color: 0xfbf6ea, roughness: 0.8, side: THREE.DoubleSide })), tent.x, (tent.tall / 2) * cc, tent.z - (tent.tall / 2) * cs);
  behind.rotation.x = tent.lean;

  group.position.set(...origin);
  group.rotation.y = yaw;
  return group;
};

/** The face of a staff keycard: a blue band, a little photo, a chip. */
const keycardFace = (): THREE.CanvasTexture => canvasTexture(216, 344, (ctx) => {
  ctx.fillStyle = '#f6f8fa';
  ctx.fillRect(0, 0, 216, 344);
  ctx.fillStyle = '#2f6fd0';
  ctx.fillRect(0, 0, 216, 70);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 22);
  ctx.fillText('STAFF', 20, 45);
  ctx.fillStyle = '#c9d3de';
  ctx.fillRect(58, 96, 100, 120);
  ctx.fillStyle = '#d9b26a';
  ctx.fillRect(24, 250, 44, 34);
  ctx.fillStyle = '#9aa6b4';
  ctx.fillRect(84, 254, 110, 10);
  ctx.fillRect(84, 274, 80, 10);
});

/** A thank-you card: two balloons on strings and the words under them. */
const thankYouCard = (): THREE.CanvasTexture => canvasTexture(450, 330, (ctx) => {
  ctx.fillStyle = '#fdf8ee';
  ctx.fillRect(0, 0, 450, 330);
  const balloon = (x: number, y: number, color: string, shine: string): void => {
    ctx.strokeStyle = '#8a8f99';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 62);
    ctx.bezierCurveTo(x - 16, y + 110, x + 18, y + 140, 225, 250);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(x, y, 46, 58, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 7, y + 64); ctx.lineTo(x + 7, y + 64); ctx.lineTo(x, y + 55); ctx.fill();
    ctx.fillStyle = shine;
    ctx.beginPath(); ctx.ellipse(x - 16, y - 22, 9, 16, -0.4, 0, TAU); ctx.fill();
  };
  balloon(170, 92, '#e8505b', 'rgba(255,255,255,0.45)');
  balloon(285, 78, '#3a86d6', 'rgba(255,255,255,0.45)');
  ctx.fillStyle = '#2d3550';
  ctx.font = `700 46px ${HAND}`;
  ctx.textAlign = 'center';
  ctx.fillText('Thank you!', 225, 300);
});

/** A pupil's tablet: a sheet of glass that is all screen, no rim, standing tilted back on a hairline kickstand. */
const TABLET = { wide: 0.34, tall: 0.24, thick: 0.0045, lean: 24 * RAD, standAt: 0.55, standBack: 0.075 };
let tabletScreen: THREE.CanvasTexture | null = null;

/** The tablets at a group of desks, one batch each for glass, stand and screen. A spot is the screen's bottom edge, facing +Z. */
const tablets = (spots: readonly Spot[]): THREE.Group => {
  const group = new THREE.Group();
  if (spots.length === 0) return group;
  const { wide, tall, thick, lean, standAt, standBack } = TABLET;
  const c = Math.cos(lean), s = Math.sin(lean), lift = 0.002;
  // the glass leans back: up its face is (0, c, -s), out of the screen is (0, s, c)
  const along = (a: number, out: number): THREE.Vector3 => new THREE.Vector3(0, lift + a * c + out * s, -a * s + out * c);
  const glass = place(new THREE.BoxGeometry(wide, tall, thick), along(tall / 2, -thick / 2), [-lean, 0, 0]);
  const face = place(new THREE.PlaneGeometry(wide, tall), along(tall / 2, 0.0003), [-lean, 0, 0]);
  const top = along(standAt * tall, -thick), foot = new THREE.Vector3(0, 0.0015, top.z - standBack);
  const legLength = top.distanceTo(foot);
  const leg = place(new THREE.BoxGeometry(wide * 0.36, legLength, 0.003), top.clone().add(foot).multiplyScalar(0.5), [Math.atan2(top.z - foot.z, top.y - foot.y), 0, 0]);
  if (!tabletScreen) tabletScreen = tabletUi();
  const parts: [THREE.BufferGeometry, THREE.Material, boolean][] = [
    [glass, new THREE.MeshPhysicalMaterial({ color: 0x101318, roughness: 0.18, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.05 }), true],
    [leg, new THREE.MeshStandardMaterial({ color: 0xc3c9d1, roughness: 0.3, metalness: 0.9 }), true],
    [face, new THREE.MeshBasicMaterial({ map: tabletScreen, color: new THREE.Color().setScalar(1.25) }), false],
  ];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const [geometry, material, shadows] of parts) {
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    spots.forEach(([x, y, z, yaw = 0], i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw * RAD), one)));
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
};

/** What the tablets show: a calm lesson screen, deep blue with a few soft cards and a progress ring. */
const tabletUi = (): THREE.CanvasTexture => {
  const w = 540, h = 380;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0d1b33');
  bg.addColorStop(1, '#123c4f');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(140, 210, 255, 0.9)';
  g.font = font(600, 22);
  g.fillText('Today', 28, 46);
  g.fillStyle = 'rgba(200, 225, 255, 0.45)';
  g.fillRect(28, 60, 120, 3);
  const cards: [number, number, number, number, string][] = [[28, 84, 300, 120, 'rgba(120, 190, 255, 0.16)'], [28, 220, 300, 130, 'rgba(120, 230, 210, 0.14)'], [348, 84, 164, 266, 'rgba(255, 255, 255, 0.07)']];
  for (const [x, y, cw, ch, fill] of cards) {
    g.fillStyle = fill;
    roundRect(g, x, y, cw, ch, 16);
    g.fill();
  }
  g.fillStyle = 'rgba(220, 235, 255, 0.55)';
  for (const [x, y, lw] of [[48, 116, 200], [48, 140, 240], [48, 164, 150], [48, 252, 220], [48, 276, 180], [48, 300, 240]] as const) g.fillRect(x, y, lw, 8);
  g.lineWidth = 12;
  g.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  g.beginPath(); g.arc(430, 190, 52, 0, TAU); g.stroke();
  g.strokeStyle = '#6fd3ff';
  g.lineCap = 'round';
  g.beginPath(); g.arc(430, 190, 52, -Math.PI / 2, -Math.PI / 2 + TAU * 0.68); g.stroke();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
};

const STEEL = 0x8e959e;

/** A table for two: a beech top with a darker edge, a steel rail under each long side, four tube legs; now and then a few things left on it. */
const buildTable = (b: Builder, t: TableSpec, rng: Rng): void => {
  const turn = t.yaw * RAD;
  const at = (lx: number, y: number, lz: number): [number, number, number] => {
    const [x, z] = onTable(t, lx, lz);
    return [x, y, z];
  };
  b.box('satin', 0xdcb889, [TABLE.wide, 0.022, TABLE.deep], at(0, TABLE.top - 0.011, 0), { r: 0.006, rot: [0, turn, 0] });
  b.box('satin', 0xa9875c, [TABLE.wide + 0.004, 0.008, TABLE.deep + 0.004], at(0, TABLE.top - 0.026, 0), { rot: [0, turn, 0] });
  for (const lz of [-1, 1]) b.box('metal', STEEL, [TABLE.wide - 0.1, 0.034, 0.018], at(0, TABLE.top - 0.05, lz * (TABLE.deep / 2 - 0.035)), { rot: [0, turn, 0] });
  for (const lx of [-1, 1]) {
    b.box('metal', STEEL, [0.018, 0.034, TABLE.deep - 0.07], at(lx * (TABLE.wide / 2 - 0.045), TABLE.top - 0.05, 0), { rot: [0, turn, 0] });
    for (const lz of [-1, 1]) b.cyl('metal', STEEL, 0.014, TABLE.top - 0.03, at(lx * (TABLE.wide / 2 - 0.045), 0, lz * (TABLE.deep / 2 - 0.035)), { radial: 10 });
  }
  // a sheet or two of paper, a pencil pot, a small stack of exercise books
  for (let i = rng.int(0, 2); i > 0; i--) {
    b.box('matte', 0xf7f6f1, [0.21, 0.002, 0.297], at(rng.range(-0.5, 0.5), TABLE.top + 0.001 + i * 0.001, rng.range(-0.12, 0.12)), { rot: [0, turn + rng.range(-0.6, 0.6), 0] });
  }
  if (rng.chance(0.45)) {
    const [x, y, z] = at(rng.pick([-1, 1]) * rng.range(0.05, 0.2), TABLE.top, rng.range(-0.15, 0.15));
    b.cyl('satin', rng.pick([0x3b6fd0, 0xe25b45, 0x3fa66a, 0xf2b632]), 0.035, 0.085, [x, y, z], { radial: 14 });
    for (let k = 0; k < 4; k++) b.cyl('satin', rng.pick([0xf2c230, 0x3b6fd0, 0xe25b45, 0x2f9e5f]), 0.004, 0.15, [x + rng.range(-0.015, 0.015), y + 0.02, z + rng.range(-0.015, 0.015)], { radial: 6, rot: [rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25)] });
  }
  if (rng.chance(0.4)) {
    const lx = rng.range(-0.45, 0.45), lz = rng.range(-0.1, 0.1), spin = turn + rng.range(-0.4, 0.4);
    for (let k = 0; k < rng.int(1, 3); k++) b.box('satin', rng.pick([0x2f6fbf, 0xd9473a, 0x39a35b, 0x8a5cc2, 0xf0a830]), [0.17, 0.008, 0.235], at(lx + rng.range(-0.01, 0.01), TABLE.top + 0.004 + k * 0.009, lz), { rot: [0, spin + rng.range(-0.15, 0.15), 0] });
  }
};

const canvasTexture = (w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
};

/** Grey carpet tiles with a blue cast: a fine speckle of fibres, half-metre tiles laid with their pile turned, a few worn patches. */
const carpet = (rng: Rng, wide: number, deep: number): THREE.CanvasTexture => {
  const N = 512, tile = 128; // one texture covers 2 m: four tiles a side
  const texture = canvasTexture(N, N, (ctx) => {
    const image = ctx.createImageData(N, N);
    const shade = Array.from({ length: 16 }, () => rng.range(-5, 5));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = Math.floor(x / tile) + Math.floor(y / tile) * 4;
      const grain = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 ? Math.sin(x * 0.9) : Math.sin(y * 0.9);
      const n = (rng.next() - 0.5) * 26 + grain * 2.5 + shade[t]!;
      const fleck = rng.chance(0.012) ? rng.range(-30, 24) : 0;
      const i = (y * N + x) * 4;
      image.data[i] = 118 + n + fleck;
      image.data[i + 1] = 126 + n + fleck;
      image.data[i + 2] = 142 + n * 1.05 + fleck;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    // the seams between tiles
    ctx.strokeStyle = 'rgba(60, 66, 80, 0.22)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= N; k += tile) {
      ctx.beginPath(); ctx.moveTo(k + 0.5, 0); ctx.lineTo(k + 0.5, N); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k + 0.5); ctx.lineTo(N, k + 0.5); ctx.stroke();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(wide / 2, deep / 2);
  return texture;
};

const HAND = '"Segoe Print", "Comic Sans MS", "Bradley Hand", cursive';

/** A sheet of chart paper written up in marker: a heading and a few lines, in two colours. */
const chartPaper = (rng: Rng): THREE.CanvasTexture => canvasTexture(372, 516, (ctx) => {
  ctx.fillStyle = '#fbfaf5';
  ctx.fillRect(0, 0, 372, 516);
  const ink = rng.pick(['#2d55b5', '#1d1d1d', '#2f8a4a']), accent = rng.pick(['#d6402f', '#e07b1f', '#8a3fb8']);
  ctx.fillStyle = accent;
  ctx.font = `700 34px ${HAND}`;
  const heading = rng.pick(['Our class rules', 'Story starters', 'Good listening', 'Word bank', 'Daily affirmations']);
  ctx.font = `700 ${heading === 'Daily affirmations' ? 31 : 34}px ${HAND}`;
  ctx.fillText(heading, 24, 58);
  ctx.fillRect(24, 70, 220, 4);
  ctx.font = `500 22px ${HAND}`;
  if (heading === 'Daily affirmations') {
    // what a class of 11 to 14 year olds says to itself in the morning
    const lines = ['I can do hard things', 'Mistakes help me learn', 'My voice matters', 'I belong here', 'I choose to be kind', 'I am proud of my effort', 'I can ask for help', 'Today is a fresh start', 'I am more than my grades'];
    ctx.font = `500 21px ${HAND}`;
    lines.forEach((line, i) => {
      ctx.fillStyle = i % 3 === 2 ? accent : ink;
      ctx.fillText(`★ ${line}`, 26 + rng.range(-3, 3), 116 + i * 43);
    });
  }
  const words = ['kind', 'listen', 'share', 'try again', 'ask', 'because', 'however', 'suddenly', 'first', 'then', 'finally', 'help', 'explain'];
  for (let i = 0; i < (heading === 'Daily affirmations' ? 0 : 9); i++) {
    ctx.fillStyle = i % 3 === 2 ? accent : ink;
    let line = '';
    for (let k = rng.int(2, 4); k > 0; k--) line += rng.pick(words) + ' ';
    ctx.fillText(`${i < 5 ? `${i + 1}.` : '-'} ${line}`, 30 + rng.range(-4, 4), 120 + i * 42);
  }
  // a pin at each top corner
  for (const x of [16, 356]) {
    ctx.fillStyle = rng.pick(['#e34b3b', '#3a7bd5', '#f2c230']);
    ctx.beginPath(); ctx.arc(x, 14, 7, 0, Math.PI * 2); ctx.fill();
  }
});

/** A colourful chart of feelings: six round faces, each with a word under it. */
const feelingsChart = (): THREE.CanvasTexture => canvasTexture(400, 400, (ctx) => {
  ctx.fillStyle = '#fffdf6';
  ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = '#3b3f58';
  ctx.font = `700 30px ${HAND}`;
  ctx.textAlign = 'center';
  ctx.fillText('How do you feel?', 200, 46);
  const faces: [string, string, number][] = [['#f6c445', 'happy', 1], ['#5aa9e6', 'calm', 0.3], ['#e85d4f', 'cross', -0.8], ['#9b7ad8', 'worried', -0.5], ['#5cc28b', 'proud', 0.8], ['#f29a4a', 'excited', 1.2]];
  faces.forEach(([color, word, smile], i) => {
    const x = 75 + (i % 3) * 125, y = 125 + Math.floor(i / 3) * 145;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2a2a';
    for (const dx of [-14, 14]) { ctx.beginPath(); ctx.arc(x + dx, y - 8, 4.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 16, y + 16 - smile * 4);
    ctx.quadraticCurveTo(x, y + 16 + smile * 12, x + 16, y + 16 - smile * 4);
    ctx.stroke();
    ctx.fillStyle = '#3b3f58';
    ctx.font = `600 22px ${HAND}`;
    ctx.fillText(word, x, y + 68);
  });
});

/** The display board over the cubbies: purple backing, a scalloped border, the class's work pinned up at odd angles. */
const displayBoard = (rng: Rng): THREE.CanvasTexture => canvasTexture(1600, 400, (ctx) => {
  ctx.fillStyle = '#4b2f86';
  ctx.fillRect(0, 0, 1600, 400);
  // scalloped border
  ctx.fillStyle = '#f2c230';
  for (let x = 0; x < 1600; x += 40) for (const y of [0, 400]) { ctx.beginPath(); ctx.arc(x + 20, y, 20, 0, Math.PI * 2); ctx.fill(); }
  for (let y = 0; y < 400; y += 40) for (const x of [0, 1600]) { ctx.beginPath(); ctx.arc(x, y + 20, 20, 0, Math.PI * 2); ctx.fill(); }
  // the title in cut-out letters
  const title = 'OUR WRITING';
  ctx.font = '800 60px "Arial Black", Impact, sans-serif';
  ctx.textBaseline = 'middle';
  let tx = 70;
  for (const ch of title) {
    ctx.save();
    ctx.translate(tx, 78);
    ctx.rotate(rng.range(-0.12, 0.12));
    ctx.fillStyle = rng.pick(['#e34b3b', '#3fb36b', '#3a8fe0', '#f29a2e', '#ffffff']);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    tx += ch === ' ' ? 26 : ctx.measureText(ch).width + 6;
  }
  // pinned work: paper with lines of writing, little drawings, bright word cards
  for (let i = 0; i < 9; i++) {
    const w = rng.range(120, 170), h = rng.range(150, 200), x = 520 + i * 118 + rng.range(-10, 10), y = rng.range(150, 230);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng.range(-0.08, 0.08));
    ctx.fillStyle = rng.chance(0.25) ? '#fff3b0' : '#fbfaf5';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = rng.pick(['#2d55b5', '#333333', '#7a3fa8']);
    for (let k = 0; k < 7; k++) ctx.fillRect(-w / 2 + 12, -h / 2 + 22 + k * 20, rng.range(w * 0.45, w - 24), 2.5);
    if (rng.chance(0.5)) {
      ctx.fillStyle = rng.pick(['#e34b3b', '#3fb36b', '#f29a2e', '#3a8fe0']);
      ctx.beginPath(); ctx.arc(rng.range(-20, 20), h / 2 - 30, 18, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#d33';
    ctx.beginPath(); ctx.arc(0, -h / 2 + 8, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.translate(70 + (i % 3) * 140 + rng.range(-8, 8), 190 + Math.floor(i / 3) * 90);
    ctx.rotate(rng.range(-0.1, 0.1));
    ctx.fillStyle = rng.pick(['#ff9f43', '#ff6b9a', '#ffd84d', '#7bed9f']);
    ctx.fillRect(-60, -28, 120, 56);
    ctx.fillStyle = '#2b2b2b';
    ctx.font = `600 26px ${HAND}`;
    ctx.textAlign = 'center';
    ctx.fillText(rng.pick(['because', 'although', 'suddenly', 'however', 'meanwhile', 'even though', 'despite', 'while']), 0, 2);
    ctx.restore();
  }
});
