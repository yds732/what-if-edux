import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST, type CastName } from '../../characters/cast';
import { place, sweep, torus, v3 } from '../../core/geo';
import { Rng, TAU, damp } from '../../core/math';
import { makeLook } from '../../render/PostPipeline';
import { bakeRoomEnvironment } from '../../render/env';
import type { Future } from '../../story/script';
import { Panel } from '../../ui/Panel';
import { font, roundRect, spaced, wrap } from '../../ui/draw';
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
/** The display's inks: dark navy on its pale blue. */
const INK = { accent: '#1f5fb8', text: '#142645', body: '#22375c', dim: 'rgba(34, 55, 92, 0.75)' };
export type ScreenContent =
  | { kind: 'title'; eyebrow: string; title: string; body: string }
  | { kind: 'voice'; name: string; line: string }
  | { kind: 'future'; heading: string; note: string; future: Future };

const W = 5, D = 6, H = 3.4;
/** Height of a floor marker: just clear of the floor. */
export const FLOOR_MARK = 0.02;
/**
 * The ceiling's light: a halo ring hung over each group of tables and one over the front, each ring carrying one lamp.
 * Five lamps light the whole room (it used to be seventeen, and four window panels), which keeps the frame rate up.
 */
const RINGS: readonly (readonly [number, number, number])[] = [[-2.1, -1.4, 0.75], [2.1, -1.4, 0.75], [-2.1, 2.2, 0.75], [2.1, 2.2, 0.75], [0.2, -3.9, 1.1]];
/** The room's light comes from the lamps: a clean white, a touch warm. */
const LAMP_COLOR = 0xfff6ec, RING_POWER = 4.2;
/**
 * The border light: a line of cool light round the foot of the walls, just above the skirting and the stage, in a slim
 * white channel that stands a little off the wall, washing the floor's edge and the bottom of the walls.
 */
const BORDER = { y: 0.24, off: 0.05, color: 0xcfe4ff };
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
      exposure: 1.0, bloom: 0.06, ao: 1.0, saturation: 1.06, contrast: 0.16, vignette: 0.26, grain: 0.012, chroma: 0.003, dof: 0,
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
    // a pale poured-resin floor in large soft tiles, with a faint sheen that catches the ring lights
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), new THREE.MeshStandardMaterial({ map: resinFloor(new Rng(2082), W * 2, D * 2), roughness: 0.42 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const b = new Builder();
    const wall = 0xe4e8ef, trim = 0xd6dbe4;
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
      b.add('metal', 0x2c313c, place(sweep(frame, () => 0.028, { radial: 6, polyline: true, steps: 4, startCap: 'flat', endCap: 'flat' }), [-W - 0.02, 0, 0]));
    }
    // one long white windowsill under all four windows, deep enough for the plants, with a hairline of light under its lip
    b.box('gloss', 0xf4f5f8, [0.34, 0.04, D * 2 - 0.6], [-W + 0.17, WY0 - 0.02, 0], { r: 0.012 });
    b.box('glow', 0xcfe4ff, [0.006, 0.004, D * 2 - 0.7], [-W + 0.33, WY0 - 0.043, 0]);
    // skirting, and a band of colour at the foot of the front wall
    b.box('satin', trim, [W * 2, 0.1, 0.03], [0, 0.05, -D + 0.015]);
    b.box('satin', trim, [0.03, 0.1, D * 2], [W - 0.015, 0.05, 0]);
    b.box('satin', trim, [W * 2, 0.1, 0.03], [0, 0.05, D - 0.015]);


    // ---- the front: a low stage, the display, the plinth ----
    // the stage: a low white platform with a soft grey top and a line of light along its edge
    const STAGE = { wide: 7.4, deep: 1.9, z: -5.05 };
    b.box('satin', 0xe9ecf1, [STAGE.wide, STAGE_HEIGHT - 0.012, STAGE.deep], [0, (STAGE_HEIGHT - 0.012) / 2, STAGE.z], { r: 0.01 });
    b.box('satin', 0xd9dde5, [STAGE.wide - 0.02, 0.012, STAGE.deep - 0.02], [0, STAGE_HEIGHT - 0.006, STAGE.z], { r: 0.004 });
    b.box('glow', 0xbfe0ff, [STAGE.wide - 0.1, 0.006, 0.006], [0, 0.03, STAGE.z + STAGE.deep / 2 + 0.002]);
    // the display: a soft white bezel with well-rounded corners round a pale screen, a line of light under it
    b.box('gloss', 0xf7f8fa, [5.2, 2.5, 0.07], [0.2, 2.05, -D + 0.045], { r: 0.06 });
    b.box('glow', 0xcfe4ff, [4.6, 0.006, 0.006], [0.2, 2.05 - 1.255, -D + 0.07]);
    // ---- tables for two pushed together, their chairs, slates, paper and pencil pots ----
    // the front tables stand in a group of their own: they are cleared away for the after-school club
    const sets = [this.frontRow, scene].map((to) => ({ to, b: new Builder(), chairs: [] as Spot[], slates: [] as Spot[], bags: [] as Spot[], colliders: [] as Obstacle[] }));
    const chairRng = new Rng(2084);
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
        if (used) {
          // everyone has their own screen of light, floating over the table in front of them
          const [sx, sz] = onTable(t, p.side * TABLE.seatX, p.facing * 0.08);
          set.slates.push([sx, TABLE.top, sz, turn + 180 + rng.range(-5, 5)]);
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
    // one rounded, floating table per group, with a pool of light on the floor under it
    for (const [gx, gz, front] of [[-GROUP_X, GROUP_Z[0], true], [GROUP_X, GROUP_Z[0], true], [-GROUP_X, GROUP_Z[1], false], [GROUP_X, GROUP_Z[1], false]] as const) {
      const set = sets[front ? 0 : 1]!;
      set.to.add(groupTable(gx, gz));
    }
    for (const set of sets) {
      set.b.finish(set.to);
      set.to.add(shellChairs(set.chairs, chairRng));
      set.to.add(holoScreens(set.slates));
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
    const plinth = await dress(ctx, scene, 'plinth', [[CLASSROOM.plinth.x, 0, CLASSROOM.plinth.z]]);
    plinth.scale.y = CLASSROOM.plinth.y / plinthTall;
    // in gloss white, like the rest of the room's furniture, keeping the model's shape
    plinth.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      m.map = null;
      m.color.set(0xf3f4f7);
      m.roughness = 0.3;
      o.material = m;
    });
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

    // ---- the back wall: everyone's tray unit, with their bags along the top ----
    {
      const unitWide = 1.72, units = 4, deep = 0.45;
      const bagSpots: Spot[] = [];
      const bagRng = new Rng(2085);
      for (let i = 0; i < units; i++) {
        const x = (i - (units - 1) / 2) * (unitWide + 0.06);
        trayUnit(b, x, D - deep / 2 - 0.02, unitWide, deep, bagRng);
        for (let k = 0; k < 2; k++) if (bagRng.chance(0.7)) bagSpots.push([x + bagRng.range(-0.6, 0.6), TRAY_UNIT_TALL, D - deep / 2 - 0.02, 180 + bagRng.range(-30, 30), 0.9]);
      }
      await dress(ctx, scene, 'backpack', bagSpots);
    }

    // ---- the right wall: books, a pin board and the door ----
    const shelfDeep = 0.42;
    bookcase(b, W - shelfDeep / 2 - 0.02, BOOKSHELF_Z, shelfDeep, new Rng(2086));
    this.colliders.box(W - shelfDeep / 2, BOOKSHELF_Z, shelfDeep / 2 + 0.05, 0.55);
    // ---- the back wall: cubbies with bags; the right wall: a pin board and the door ----
    slidingDoor(b, W, -1.9);
    // the pin board of everyone's pictures, and posters either side of the display
    const hang = async (id: string, wide: number, x: number, y: number, z: number, turn: number): Promise<void> => {
      const picture = await ctx.assets.picture(id);
      const hung = framed(picture.map, wide, (wide * picture.entry.size[1]) / picture.entry.size[0], 0xf4f5f8);
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
    // smart glass: the top of each window tinted down by a different amount, where the blinds used to be
    const tint = new THREE.MeshStandardMaterial({ color: 0x5a7394, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false });
    centres.forEach((z, i) => {
      const drop = BLIND_DROPS[i]!;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(WW, drop), tint);
      pane.position.set(-W + 0.01, WY1 - drop / 2, z);
      pane.rotation.y = Math.PI / 2;
      scene.add(pane);
      b.box('glow', 0xcfe4ff, [0.004, 0.004, WW - 0.04], [-W + 0.012, WY1 - drop, z]);
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
    const board = framed(displayBoard(new Rng(9)), 4.2, 1.05, 0xf4f5f8);
    board.position.set(-0.3, 2.3, D - 0.005);
    board.rotation.y = Math.PI;
    scene.add(board);
    // a free-standing whiteboard in the front corner by the windows, the class rules written up on it
    const easel = { x: -4.25, z: -3.55, turn: 55 * RAD };
    const ex = (lx: number, lz: number): [number, number] => [easel.x + lx * Math.cos(easel.turn) + lz * Math.sin(easel.turn), easel.z - lx * Math.sin(easel.turn) + lz * Math.cos(easel.turn)];
    {
      // two slim white legs on round feet, and the board between them
      for (const lx of [-0.5, 0.5]) {
        const [lxw, lzw] = ex(lx, 0);
        b.box('satin', 0xe9ecf1, [0.04, 1.75, 0.035], [lxw, 0.875, lzw], { r: 0.012, rot: [0, easel.turn, 0] });
        b.cyl('satin', 0xe9ecf1, 0.12, 0.025, [lxw, 0, lzw], { radial: 24 });
      }
      const [px, pz] = ex(0, 0.03);
      b.box('gloss', 0xf4f5f8, [1.08, 0.78, 0.03], [px, 1.28, pz], { r: 0.03, rot: [0, easel.turn, 0] });
      // a pen tray along the bottom with three markers in it
      const [tx, tz] = ex(0, 0.07);
      b.box('satin', 0xe9ecf1, [0.6, 0.02, 0.05], [tx, 0.885, tz], { r: 0.008, rot: [0, easel.turn, 0] });
      for (const [k, c] of [0x2f5fc0, 0xd8453a, 0x2f9a5c].entries()) {
        const [mx, mz] = ex(-0.12 + k * 0.1, 0.07);
        b.box('satin', c, [0.12, 0.018, 0.018], [mx, 0.905, mz], { r: 0.008, rot: [0, easel.turn, 0] });
      }
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), new THREE.MeshStandardMaterial({ map: whiteboardRules(), roughness: 0.25 }));
      const [qx, qz] = ex(0, 0.047);
      pad.position.set(qx, 1.28, qz);
      pad.rotation.set(0, easel.turn, 0, 'YXZ');
      scene.add(pad);
    }
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
    // halo rings: a slim white ring hung on three wires over each group, its inner face a band of light
    const panels = new Builder();
    for (const [x, z, r] of RINGS) {
      const y = H - 0.42;
      const ring = new THREE.TorusGeometry(r, 0.03, 10, 96);
      ring.rotateX(Math.PI / 2);
      ring.deleteAttribute('uv');
      panels.add('satin', 0xf4f5f8, place(ring, [x, y + 0.012, z]));
      const band = new THREE.TorusGeometry(r, 0.022, 8, 96);
      band.rotateX(Math.PI / 2);
      band.scale(1, 0.5, 1);
      band.deleteAttribute('uv');
      panels.add('glow', 0xffffff, place(band, [x, y - 0.014, z]));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU;
        panels.cyl('metal', 0x2a2a2a, 0.002, H - y, [x + Math.cos(a) * r, y, z + Math.sin(a) * r], { radial: 5 });
      }
      const light = new THREE.PointLight(LAMP_COLOR, RING_POWER * (r > 1 ? 1.2 : 1), 0, 2);
      light.position.set(x, y - 0.2, z);
      light.userData.power = light.intensity;
      this.lamps.push(light);
      scene.add(light);
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
    this.screen.mesh.material.color.setScalar(0.96);
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
      // only Jamie is seen close up; Yusra sits across from the player on Wednesday; everyone else is across the room
      const main = s.who === 'jamie';
      const weight = main ? undefined : s.who === 'yusra' ? 'medium' : 'low';
      const person = this.addPerson(s.who, await Character.create(ctx, CAST[s.who], s.who, main ? ctx.quality.shadows : false, weight));
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
    // the windows' daylight, which once came from four area lights, is carried by the sky fill instead
    this.fill.intensity = 0.04 + 0.26 * daylight;
    this.fill.color.setRGB(0.95 + 0.05 * m.warm, 0.93 - 0.18 * m.warm, 0.9 - 0.4 * m.warm);
    (this.ceiling.material as THREE.MeshBasicMaterial).color.setScalar(0.08 + 2.2 * m.room);
    (this.border.material as THREE.MeshBasicMaterial).color.setScalar(0.1 + 2.4 * m.room);
    this.scene.environmentIntensity = 0.07 + 0.06 * m.room + 0.02 * m.warm;
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
    // never a blank screen: with nothing to show it greets the class
    if (content.kind === 'title' && !content.title && !content.eyebrow && !content.body) {
      content = { kind: 'title', eyebrow: 'Harbour District School · Class 1', title: 'Good morning!', body: 'Find your seat and say hello to your group.' };
    }
    this.screen.paint((ctx, w, h) => {
      // a pale sky-blue screen with rounded corners, to sit quietly in a white room
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#bcd9f8');
      g.addColorStop(1, '#7eaee6');
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, w, h, 34);
      ctx.fill();
      // faint concentric rings: the Echo mark
      ctx.strokeStyle = 'rgba(60, 130, 215, 0.26)';
      ctx.lineWidth = 3;
      for (let i = 1; i <= 6; i++) {
        ctx.beginPath();
        ctx.arc(w - 300, h / 2, i * 62, 0, TAU);
        ctx.stroke();
      }
      ctx.textBaseline = 'middle';
      if (content.kind === 'title') {
        ctx.fillStyle = INK.accent;
        ctx.font = font(600, 34);
        spaced(ctx, content.eyebrow.toUpperCase(), 130, 190, 10);
        ctx.fillStyle = INK.text;
        ctx.font = font(500, 118);
        wrap(ctx, content.title, w - 520).forEach((l, i) => ctx.fillText(l, 124, 330 + i * 128));
        const n = wrap(ctx, content.title, w - 520).length;
        ctx.fillStyle = INK.body;
        ctx.font = font(400, 48);
        wrap(ctx, content.body, w - 620).forEach((l, i) => ctx.fillText(l, 130, 330 + n * 128 + 20 + i * 62));
      } else if (content.kind === 'voice') {
        ctx.fillStyle = INK.accent;
        ctx.font = font(600, 34);
        spaced(ctx, 'ECHO COMMUNITY CONSULTATION', 130, 150, 10);
        ctx.fillStyle = INK.text;
        ctx.font = font(300, 130);
        ctx.fillText(content.name, 124, 330);
        ctx.fillStyle = INK.body;
        ctx.font = font(300, 58);
        wrap(ctx, `“${content.line}”`, w - 560).forEach((l, i) => ctx.fillText(l, 130, 500 + i * 76));
      } else {
        const f = content.future;
        ctx.fillStyle = INK.accent;
        ctx.font = font(600, 32);
        spaced(ctx, content.heading, 110, 96, 9);
        ctx.fillStyle = INK.text;
        ctx.font = font(600, 104);
        ctx.fillText(f.title, 104, 216);
        ctx.fillStyle = INK.body;
        ctx.font = font(300, 46);
        ctx.fillText(f.summary, 110, 310);
        const col = (x: number, good: boolean, head: string, body: string): void => {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
          roundRect(ctx, x, 380, 830, 300, 30);
          ctx.fill();
          ctx.strokeStyle = good ? 'rgba(60, 170, 120, 0.6)' : 'rgba(220, 140, 60, 0.6)';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = good ? '#2f9a6c' : '#d27a2c';
          ctx.font = font(600, 28);
          spaced(ctx, good ? 'WHAT IT GIVES' : 'WHAT IT COSTS', x + 44, 434, 6);
          ctx.fillStyle = INK.text;
          ctx.font = font(600, 40);
          let y = 500;
          for (const l of wrap(ctx, head, 740)) {
            ctx.fillText(l, x + 44, y);
            y += 50;
          }
          ctx.fillStyle = INK.body;
          ctx.font = font(400, 32);
          for (const l of wrap(ctx, body, 740)) {
            ctx.fillText(l, x + 44, y + 8);
            y += 42;
          }
        };
        col(104, true, f.gain.head, f.gain.body);
        col(984, false, f.cost.head, f.cost.body);
        ctx.fillStyle = INK.text;
        ctx.font = font(300, 56);
        ctx.fillText(`“${f.question}”`, 110, 762);
        ctx.fillStyle = INK.dim;
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
    this.screen.mesh.material.color.setScalar(0.96 + this.screenPulse * 0.2);
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

/** What is left on a table for two: now and then a sheet of paper, a pencil pot, a few exercise books. The table itself is the group's (see `groupTable`). */
const buildTable = (b: Builder, t: TableSpec, rng: Rng): void => {
  const turn = t.yaw * RAD;
  const at = (lx: number, y: number, lz: number): [number, number, number] => {
    const [x, z] = onTable(t, lx, lz);
    return [x, y, z];
  };
  // a sheet or two of paper, a pencil pot, a small stack of exercise books
  for (let i = rng.int(0, 2); i > 0; i--) {
    b.box('matte', 0xf7f6f1, [0.21, 0.002, 0.297], at(rng.range(-0.5, 0.5), TABLE.top + 0.001 + i * 0.001, rng.range(-0.12, 0.12)), { rot: [0, turn + rng.range(-0.6, 0.6), 0] });
  }
  if (rng.chance(0.45)) {
    const [x, y, z] = at(rng.pick([-1, 1]) * rng.range(0.05, 0.2), TABLE.top, rng.range(-0.15, 0.15));
    b.cyl('gloss', rng.pick([0xf4f5f8, 0x9cc4e8, 0x9fd8c4, 0xf2b8a0]), 0.035, 0.085, [x, y, z], { radial: 14 });
    for (let k = 0; k < 4; k++) b.cyl('satin', rng.pick([0xf2c230, 0x3b6fd0, 0xe25b45, 0x2f9e5f]), 0.004, 0.15, [x + rng.range(-0.015, 0.015), y + 0.02, z + rng.range(-0.015, 0.015)], { radial: 6, rot: [rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25)] });
  }
  if (rng.chance(0.4)) {
    const lx = rng.range(-0.45, 0.45), lz = rng.range(-0.1, 0.1), spin = turn + rng.range(-0.4, 0.4);
    for (let k = 0; k < rng.int(1, 3); k++) b.box('satin', rng.pick([0x2f6fbf, 0xd9473a, 0x39a35b, 0x8a5cc2, 0xf0a830]), [0.17, 0.008, 0.235], at(lx + rng.range(-0.01, 0.01), TABLE.top + 0.004 + k * 0.009, lz), { rot: [0, spin + rng.range(-0.15, 0.15), 0] });
  }
};

/** A soft glow texture in a rounded-rectangle shape: bright in the middle, fading out to nothing at the edges. */
const glowPool = (aspect: number): THREE.CanvasTexture => canvasTexture(512, Math.round(512 / aspect), (ctx) => {
  const w = 512, h = Math.round(512 / aspect);
  ctx.filter = 'blur(28px)';
  ctx.fillStyle = 'rgba(255, 255, 255, 1)';
  roundRect(ctx, 60, 60, w - 120, h - 120, Math.min(w, h) / 2 - 60);
  ctx.fill();
});

/**
 * A group's table: one soft, rounded slab with no corners at all (a stadium of white solid surface with a thick
 * rolled edge), floating at desk height with nothing under it. A thin ring of light runs under its rim, and a pool
 * of cool light lies on the floor beneath, so it reads as hovering.
 */
const groupTable = (cx: number, cz: number): THREE.Group => {
  const group = new THREE.Group();
  const wide = TABLE.wide * 2 + 0.04, deep = TABLE.deep * 2 + 0.04, thick = 0.05, round = 0.5;
  const shape = (w: number, d: number, r: number): THREE.Shape => {
    const sh = new THREE.Shape(), hw = w / 2, hd = d / 2;
    sh.moveTo(-hw + r, -hd);
    sh.lineTo(hw - r, -hd); sh.quadraticCurveTo(hw, -hd, hw, -hd + r);
    sh.lineTo(hw, hd - r); sh.quadraticCurveTo(hw, hd, hw - r, hd);
    sh.lineTo(-hw + r, hd); sh.quadraticCurveTo(-hw, hd, -hw, hd - r);
    sh.lineTo(-hw, -hd + r); sh.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    return sh;
  };
  const bevel = 0.022;
  const slabGeo = new THREE.ExtrudeGeometry(shape(wide - 2 * bevel, deep - 2 * bevel, round), { depth: thick - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 6, curveSegments: 32 });
  slabGeo.rotateX(-Math.PI / 2);
  slabGeo.translate(0, TABLE.top - thick + bevel, 0);
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: 0xf6f7f9, roughness: 0.28 }));
  slab.castShadow = slab.receiveShadow = true;
  // a recessed underside, a little smaller, in pale grey
  const underGeo = new THREE.ExtrudeGeometry(shape(wide - 0.3, deep - 0.3, round - 0.1), { depth: 0.03, bevelEnabled: false, curveSegments: 32 });
  underGeo.rotateX(-Math.PI / 2);
  underGeo.translate(0, TABLE.top - thick - 0.03, 0);
  const under = new THREE.Mesh(underGeo, new THREE.MeshStandardMaterial({ color: 0xd9dee7, roughness: 0.4 }));
  // the ring of light under the rim
  const pts = shape(wide - 0.32, deep - 0.32, round - 0.11).getSpacedPoints(160).map((q) => new THREE.Vector3(q.x, TABLE.top - thick - 0.031, -q.y));
  const ring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 240, 0.005, 6, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.88, 1.0).multiplyScalar(2.4) }));
  // the light it throws on the floor
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(wide + 0.8, deep + 0.8), new THREE.MeshBasicMaterial({ map: glowPool((wide + 0.8) / (deep + 0.8)), color: new THREE.Color(0.45, 0.62, 0.9).multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.004;
  group.add(slab, under, ring, pool);
  group.position.set(cx, 0, cz);
  return group;
};

/** What a floating screen shows: a calm lesson card in cyan light on clear glass. */
const holoUi = (): THREE.CanvasTexture => canvasTexture(512, 340, (g) => {
  const w = 512, h = 340;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(90, 170, 255, 0.30)');
  bg.addColorStop(1, 'rgba(60, 130, 230, 0.16)');
  g.fillStyle = bg;
  roundRect(g, 6, 6, w - 12, h - 12, 22);
  g.fill();
  g.strokeStyle = 'rgba(190, 228, 255, 0.95)';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = 'rgba(225, 242, 255, 0.95)';
  g.font = font(600, 26);
  g.fillText('Today', 32, 52);
  g.fillStyle = 'rgba(200, 230, 255, 0.5)';
  g.fillRect(32, 64, 110, 3);
  for (const [x, y, cw, ch] of [[32, 88, 290, 100], [32, 204, 290, 110], [342, 88, 138, 226]] as const) {
    g.fillStyle = 'rgba(160, 215, 255, 0.16)';
    roundRect(g, x, y, cw, ch, 14);
    g.fill();
  }
  g.fillStyle = 'rgba(225, 242, 255, 0.7)';
  for (const [x, y, lw] of [[50, 118, 200], [50, 142, 240], [50, 166, 150], [50, 236, 220], [50, 260, 180], [50, 284, 240]] as const) g.fillRect(x, y, lw, 7);
  g.lineWidth = 11;
  g.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  g.beginPath(); g.arc(411, 200, 44, 0, TAU); g.stroke();
  g.strokeStyle = '#8fe3ff';
  g.lineCap = 'round';
  g.beginPath(); g.arc(411, 200, 44, -Math.PI / 2, -Math.PI / 2 + TAU * 0.68); g.stroke();
});

/**
 * Everyone's own screen: a pane of light floating over the table in front of them, half see-through, leaning back a
 * little toward its owner, over a small lit dot on the table where it is projected from. A spot is the dot, facing +Z.
 */
const holoScreens = (spots: readonly Spot[]): THREE.Group => {
  const group = new THREE.Group();
  if (spots.length === 0) return group;
  const wide = 0.38, tall = 0.25, lift = 0.24, lean = 14 * RAD;
  const pane = new THREE.PlaneGeometry(wide, tall);
  pane.rotateX(-lean);
  pane.translate(0, lift + tall / 2, 0);
  const dot = new THREE.CircleGeometry(0.022, 24);
  dot.rotateX(-Math.PI / 2);
  dot.translate(0, 0.002, 0.03);
  const beam = new THREE.CylinderGeometry(wide * 0.42, 0.012, lift, 24, 1, true);
  beam.translate(0, lift / 2, 0.03);
  beam.scale(1, 1, 0.35);
  const parts: [THREE.BufferGeometry, THREE.Material][] = [
    [pane, new THREE.MeshBasicMaterial({ map: holoUi(), color: new THREE.Color().setScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })],
    [dot, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.85, 1.0).multiplyScalar(2.4) })],
    [beam, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.55, 0.9).multiplyScalar(0.18), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })],
  ];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const [geometry, material] of parts) {
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    spots.forEach(([x, y, z, yaw = 0], i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw * RAD), one)));
    mesh.computeBoundingSphere();
    mesh.renderOrder = 3;
    group.add(mesh);
  }
  return group;
};

/**
 * Floating seats, all batched: one thick, smooth moulded shell (seat and back in a single curve) in white or pale
 * blue, a thin line of light along the top of its back, hovering on a ring of light with nothing under it.
 * A spot is the chair's middle on the floor; at yaw 0 its seat faces +Z and its back is toward -Z.
 */
const shellChairs = (spots: readonly Spot[], rng: Rng): THREE.Group => {
  const group = new THREE.Group();
  if (spots.length === 0) return group;
  const wide = 0.42, N = 28, M = 20, thick = 0.022;
  // the profile from the front lip (+z) along the seat, round the bend and up the back (-z), as (z, y)
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    if (t < 0.5) {
      const u = t / 0.5;
      profile.push(new THREE.Vector2(0.19 - u * 0.31, SEAT - 0.014 * Math.sin(u * Math.PI) - (u < 0.12 ? 0.03 * (1 - u / 0.12) ** 2 : 0)));
    } else {
      const u = (t - 0.5) / 0.5, a = u * (Math.PI / 2 + 0.28);
      profile.push(new THREE.Vector2(-0.12 - 0.1 * Math.sin(a), SEAT + 0.1 * (1 - Math.cos(a)) + u * u * 0.22));
    }
  }
  const cols = profile.length;
  const inner: THREE.Vector3[] = [];
  for (let j = 0; j <= M; j++) {
    const v = j / M, x = (v - 0.5) * wide;
    // the shell wraps round the sitter at the sides, more so up the back
    const side = Math.pow(Math.abs(v - 0.5) * 2, 2.5);
    for (const [k, p] of profile.entries()) {
      const up = k / (cols - 1);
      inner.push(new THREE.Vector3(x * (1 - 0.1 * side * up), p.y + 0.035 * side, p.x + 0.03 * side * up));
    }
  }
  // give it thickness: a second skin below, joined round the edge
  const g0 = new THREE.BufferGeometry().setFromPoints(inner);
  const idx0: number[] = [];
  for (let j = 0; j < M; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + cols;
    idx0.push(a, b, a + 1, a + 1, b, b + 1);
  }
  g0.setIndex(idx0);
  g0.computeVertexNormals();
  const n0 = g0.attributes.normal as THREE.BufferAttribute;
  const pos: number[] = [], idx: number[] = [];
  const count = inner.length;
  for (const p of inner) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < count; i++) pos.push(inner[i]!.x - n0.getX(i) * thick, inner[i]!.y - n0.getY(i) * thick, inner[i]!.z - n0.getZ(i) * thick);
  idx.push(...idx0);
  for (let t = 0; t < idx0.length; t += 3) idx.push(idx0[t]! + count, idx0[t + 2]! + count, idx0[t + 1]! + count);
  const edge = (a: number, b: number): void => { idx.push(a, a + count, b, b, a + count, b + count); };
  for (let i = 0; i < cols - 1; i++) { edge(i + 1, i); edge(M * cols + i, M * cols + i + 1); }
  for (let j = 0; j < M; j++) { edge(j * cols, (j + 1) * cols); edge((j + 1) * cols + cols - 1, j * cols + cols - 1); }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  // the light along the top of the back
  const topPts = Array.from({ length: M + 1 }, (_, j) => inner[j * cols + cols - 1]!.clone().add(new THREE.Vector3(0, -0.012, -0.006)));
  const seam = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(topPts), 40, 0.004, 6);
  // the hover ring and its glow on the floor
  const ring = new THREE.TorusGeometry(0.13, 0.008, 8, 48);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.07, 0.02);
  const hub = new THREE.CylinderGeometry(0.1, 0.12, 0.03, 32);
  hub.translate(0, 0.07, 0.02);
  const floorGlow = new THREE.PlaneGeometry(0.62, 0.62);
  floorGlow.rotateX(-Math.PI / 2);
  floorGlow.translate(0, 0.003, 0.02);
  const colours = [0xf6f7f9, 0xf6f7f9, 0xcfe2f6, 0xb8d4f2];
  const cyan = new THREE.Color(0.65, 0.86, 1.0).multiplyScalar(2.4);
  const parts: [THREE.BufferGeometry, THREE.Material, boolean][] = [
    [shell, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, side: THREE.DoubleSide }), true],
    [seam, new THREE.MeshBasicMaterial({ color: cyan }), false],
    [hub, new THREE.MeshStandardMaterial({ color: 0xe9edf3, roughness: 0.3, metalness: 0.3 }), true],
    [ring, new THREE.MeshBasicMaterial({ color: cyan }), false],
    [floorGlow, new THREE.MeshBasicMaterial({ map: glowPool(1), color: new THREE.Color(0.45, 0.65, 0.95).multiplyScalar(0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), false],
  ];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
  for (const [k, [geometry, material, shadows]] of parts.entries()) {
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    spots.forEach(([x, y, z, yaw = 0], i) => {
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw * RAD), one));
      if (k === 0) mesh.setColorAt(i, c.set(rng.pick(colours)));
    });
    mesh.castShadow = mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
};

/** Height of the tray units along the back wall, where the bags sit. */
const TRAY_UNIT_TALL = 1.02;

/**
 * A pupil's tray unit, as every British classroom has, made for 2080: a white cabinet of pull-out trays in soft
 * colours, each with a dark finger-pull and a little glowing name strip, on a recessed plinth with light under it.
 * It stands against the +Z wall, facing -Z; `x`, `z` is its middle on the floor.
 */
const trayUnit = (b: Builder, x: number, z: number, wide: number, deep: number, rng: Rng): void => {
  const tall = TRAY_UNIT_TALL, foot = 0.08, front = z - deep / 2, cols = 3, rows = 6, t = 0.02;
  b.box('satin', 0xf2f3f6, [wide, tall - foot, deep], [x, foot + (tall - foot) / 2, z], { r: 0.012 });
  b.box('gloss', 0xf8f9fb, [wide + 0.02, 0.025, deep + 0.02], [x, tall - 0.0125, z], { r: 0.008 });
  b.box('satin', 0x2b303b, [wide - 0.06, foot, deep - 0.08], [x, foot / 2, z + 0.03]);
  b.box('glow', 0xcfe4ff, [wide - 0.1, 0.004, 0.004], [x, 0.01, front + 0.05]);
  const colours = [0x9cc4e8, 0x9fd8c4, 0xf3c1a8, 0xc9c2ec, 0xf6dc8c, 0xf4f5f8];
  const cw = (wide - t * (cols + 1)) / cols, rh = (tall - foot - t * (rows + 1)) / rows;
  for (let cIdx = 0; cIdx < cols; cIdx++) for (let r = 0; r < rows; r++) {
    const cx = x - wide / 2 + t + cw / 2 + cIdx * (cw + t), cy = foot + t + rh / 2 + r * (rh + t);
    const out = rng.chance(0.12) ? 0.06 : 0;
    b.box('satin', rng.pick(colours), [cw - 0.006, rh - 0.006, 0.02], [cx, cy, front - 0.01 - out], { r: 0.008 });
    b.box('satin', 0x3a404c, [cw * 0.36, 0.016, 0.006], [cx, cy + rh * 0.12, front - 0.021 - out], { r: 0.004 });
    b.box('glow', 0xe6f2ff, [cw * 0.22, 0.008, 0.003], [cx, cy - rh * 0.22, front - 0.021 - out]);
  }
};

/** A white bookcase against the right-hand wall, facing -X: open shelves of picture books, standing and leaning. */
const bookcase = (b: Builder, x: number, z: number, deep: number, rng: Rng): void => {
  const wide = 1.1, tall = 1.6, t = 0.025, face = x - deep / 2;
  b.box('satin', 0xf2f3f6, [deep, t, wide], [x, tall - t / 2, z], { r: 0.006 });
  b.box('satin', 0xf2f3f6, [deep, 0.06, wide], [x, 0.03, z], { r: 0.006 });
  for (const s of [-1, 1]) b.box('satin', 0xf2f3f6, [deep, tall, t], [x, tall / 2, z + s * (wide / 2 - t / 2)], { r: 0.006 });
  b.box('matte', 0xdfe3ea, [0.01, tall, wide], [x + deep / 2 - 0.005, tall / 2, z]);
  const levels = [0.06, 0.45, 0.85, 1.22];
  for (const y of levels.slice(1)) {
    b.box('satin', 0xf2f3f6, [deep, t, wide - 2 * t], [x, y, z], { r: 0.004 });
    b.box('glow', 0xfff3e2, [0.004, 0.004, wide - 0.1], [face + 0.03, y - t / 2 - 0.002, z]);
  }
  const colours = [0xe25b45, 0x3b6fd0, 0xf2b632, 0x3fa66a, 0x8a5cc2, 0xf4f5f8, 0x2c3e66, 0xf28fae];
  for (const y of levels) {
    let at = z - wide / 2 + t + 0.02;
    const end = z + wide / 2 - t - 0.04;
    while (at < end - 0.05) {
      const thick = rng.range(0.015, 0.04), h = rng.range(0.22, 0.3), d = rng.range(0.16, 0.24);
      if (at + thick > end) break;
      b.box('satin', rng.pick(colours), [d, h, thick], [face + 0.03 + d / 2, y + (y === levels[0] ? 0.03 : t / 2) + h / 2, at + thick / 2], { r: 0.003 });
      at += thick + 0.002 + (rng.chance(0.12) ? 0.08 : 0);
    }
  }
};

/** A sliding door in the right-hand wall: a slim white frame, a frosted glass leaf with a vertical bar of light, a long pull. */
const slidingDoor = (b: Builder, wallX: number, z: number): void => {
  const x = wallX - 0.03, wide = 1.0, tall = 2.1;
  for (const s of [-1, 1]) b.box('satin', 0xf4f5f8, [0.06, tall + 0.05, 0.05], [x, (tall + 0.05) / 2, z + s * (wide / 2 + 0.025)], { r: 0.01 });
  b.box('satin', 0xf4f5f8, [0.06, 0.05, wide + 0.1], [x, tall + 0.025, z], { r: 0.01 });
  b.box('satin', 0xe9ecf1, [0.04, tall - 0.01, wide - 0.01], [x - 0.005, tall / 2, z], { r: 0.008 });
  b.box('gloss', 0xc6d6e6, [0.006, tall - 0.5, wide * 0.3], [x - 0.028, tall / 2 + 0.05, z - wide * 0.18]);
  b.box('glow', 0xcfe4ff, [0.004, tall - 0.6, 0.006], [x - 0.031, tall / 2 + 0.05, z + wide * 0.02]);
  b.box('metal', 0xb9bec8, [0.03, 0.55, 0.022], [x - 0.04, 1.05, z + wide * 0.36], { r: 0.008 });
};

/** The whiteboard in the corner: the class rules in marker, in a teacher's hand, with a few doodles. */
const whiteboardRules = (): THREE.CanvasTexture => canvasTexture(1000, 700, (ctx) => {
  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(0, 0, 1000, 700);
  // the ghost of last week's writing, not quite rubbed off
  ctx.fillStyle = 'rgba(120, 130, 150, 0.06)';
  ctx.font = `400 46px ${HAND}`;
  ctx.fillText('fractions  ½  ¼', 560, 640);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#2f5fc0';
  ctx.font = `700 76px ${HAND}`;
  ctx.fillText('Our Class Rules', 70, 110);
  ctx.strokeStyle = '#2f5fc0';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(70, 132); ctx.quadraticCurveTo(330, 146, 610, 128); ctx.stroke();
  const rules: [string, string][] = [['1. Be kind to everyone', '#1f2a44'], ['2. Listen when others talk', '#1f2a44'], ['3. Try your best', '#1f2a44'], ['4. It\'s OK to ask for help', '#1f2a44'], ['5. Look after our room', '#1f2a44']];
  ctx.font = `400 50px ${HAND}`;
  rules.forEach(([l, c], i) => { ctx.fillStyle = c; ctx.fillText(l, 84, 220 + i * 86); });
  // a red tick beside each, and a green star and a smiley in the corner
  ctx.strokeStyle = '#d8453a';
  ctx.lineWidth = 6;
  rules.forEach((_, i) => { const y = 205 + i * 86; ctx.beginPath(); ctx.moveTo(640, y); ctx.lineTo(658, y + 18); ctx.lineTo(690, y - 20); ctx.stroke(); });
  ctx.strokeStyle = '#2f9a5c';
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let k = 0; k <= 10; k++) { const a = -Math.PI / 2 + (k / 10) * TAU, r = k % 2 ? 24 : 56; ctx.lineTo(850 + Math.cos(a) * r, 140 + Math.sin(a) * r); }
  ctx.stroke();
  ctx.strokeStyle = '#2f5fc0';
  ctx.beginPath(); ctx.arc(860, 470, 62, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(860, 480, 36, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.fillStyle = '#2f5fc0';
  for (const dx of [-22, 22]) { ctx.beginPath(); ctx.arc(860 + dx, 450, 7, 0, TAU); ctx.fill(); }
});

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

/** A pale poured-resin floor: a soft warm grey in metre tiles with fine seams and a faint, even mottle. */
const resinFloor = (rng: Rng, wide: number, deep: number): THREE.CanvasTexture => {
  const N = 512, tile = 256; // one texture covers 2 m: two tiles a side
  const texture = canvasTexture(N, N, (ctx) => {
    ctx.fillStyle = '#c7cad0';
    ctx.fillRect(0, 0, N, N);
    for (let i = 0; i < 14000; i++) {
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(255, 255, 255, 0.035)' : 'rgba(90, 96, 110, 0.035)';
      const r = rng.range(0.6, 3);
      ctx.beginPath(); ctx.arc(rng.next() * N, rng.next() * N, r, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(120, 126, 140, 0.35)';
    for (let k = 0; k <= N; k += tile) { ctx.fillRect(k - 1, 0, 2, N); ctx.fillRect(0, k - 1, N, 2); }
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
