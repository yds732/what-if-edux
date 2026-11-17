import * as THREE from 'three';
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
import { dress, floorOf, framed, sizeOf, type Spot } from '../dressing';
import { makeHalo } from '../haven/atmosphere';
import { buildCityscape, type Cityscape } from '../cityscape';
import { Builder } from '../interior';
import { buildSunbeams, type Sunbeams } from './sunbeams';

/** Seat height of every chair, and the eye height of a child sitting on one. */
export const SEAT = 0.36;
const _sunDir = new THREE.Vector3();
export const EYE_SEATED = 1.0;

/** The classroom: 10 m wide (x), 12 m deep (z). The display and teacher are on the -Z wall, windows on -X. */
export const CLASSROOM = {
  /** Monday: the player's desk at the back. */
  seatMonday: anchor(0.38, 0, 3.42, 0),
  /** Where "the front of the classroom" is. */
  front: new THREE.Vector3(1.0, 0, -2.9),
  /** Top of the plinth that holds the headset. */
  plinth: new THREE.Vector3(1.0, 0.99, -3.9),
  teacher: anchorToward(-1.5, 0, -4.1, 0.4, 3),
  /** Wednesday: the empty chair beside Jamie. */
  seatPartner: anchor(2.42, 0, 1.22, 0),
  jamieSeat: anchor(3.18, 0, 1.22, 0),
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
const DESK_ROWS = [-1.6, 0.6, 2.8], DESK_COLS = [-2.8, 0, 2.8];
/** The low stage along the front wall, the teacher's desk on it, and where the bookshelf stands along the right wall. */
const STAGE_HEIGHT = 0.16, TEACHER_DESK = { x: -2.95, z: -4.75 }, BOOKSHELF_Z = -3.5;
/** A desk and the chairs behind it, as one obstacle. */
const DESK_COLLIDER = { dz: 0.1, hx: 0.8, hz: 0.52 };

interface Seating {
  who: CastName;
  row: number;
  col: number;
  side: -1 | 1;
}
const SEATING: Seating[] = [
  { who: 'priya', row: 0, col: 0, side: -1 }, { who: 'theo', row: 0, col: 0, side: 1 }, { who: 'amara', row: 0, col: 1, side: -1 },
  { who: 'yusra', row: 0, col: 2, side: 1 }, { who: 'leo', row: 1, col: 0, side: -1 }, { who: 'mina', row: 1, col: 1, side: 1 },
  { who: 'jamie', row: 1, col: 2, side: 1 },
];
const seatOf = (s: Seating): Anchor => anchor(DESK_COLS[s.col]! + s.side * 0.38, 0, DESK_ROWS[s.row]! + 0.62, 0);

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
  private readonly sunDirection = new THREE.Vector3(-1, 0.6, -0.2).normalize();
  private markerRadius = 0.3;
  /** Obstacles that belong to the current arrangement of the room. */
  private sceneColliders: Obstacle[] = [];

  constructor() {
    super();
    this.near = 0.05;
    this.far = 1400;
    Object.assign(this.look, makeLook({
      exposure: 1.0, bloom: 0.06, ao: 1.0, saturation: 1.06, contrast: 0.16, vignette: 0.26, grain: 0.012, chroma: 0.003, dof: 0.5,
      shadowTint: new THREE.Color(0.0, 0.004, 0.012), highlightTint: new THREE.Color(0.012, 0.006, -0.004),
    }));
    this.clearColor.set(0xbfd0ea);
    // the sun stands outside the window wall; whatever is further off than the room is long is the sky
    this.shafts = { direction: this.sunDirection, skyFrom: 13 };
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
    const floor = floorOf(await ctx.assets.picture('floor-classroom'), W * 2, D * 2, 2.4, 0.5);
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
      b.box('satin', 0xf2f3f7, [0.36, 0.05, WW + 0.14], [-W + 0.1, WY0 - 0.025, z], { r: 0.014 });
    }
    // skirting, and a band of colour at the foot of the front wall
    b.box('satin', trim, [W * 2, 0.1, 0.03], [0, 0.05, -D + 0.015]);
    b.box('satin', trim, [0.03, 0.1, D * 2], [W - 0.015, 0.05, 0]);
    b.box('satin', trim, [W * 2, 0.1, 0.03], [0, 0.05, D - 0.015]);
    b.box('satin', accent, [W * 2, 0.5, 0.02], [0, 0.35, -D + 0.012]);

    // ---- the front: a low stage, the display, the plinth ----
    b.box('satin', 0xdfe3ec, [7.4, STAGE_HEIGHT, 1.9], [0, STAGE_HEIGHT / 2, -5.05], { r: 0.05 });
    b.box('gloss', 0x1a1e2c, [5.0, 2.3, 0.07], [0.2, 2.05, -D + 0.05], { r: 0.035 });
    b.box('metal', 0xd9dde8, [5.16, 2.46, 0.04], [0.2, 2.05, -D + 0.022], { r: 0.05 });
    // ---- desks for two, their chairs, and a slate at every place ----
    const taken = new Set(SEATING.map((s) => `${s.row}:${s.col}:${s.side}`));
    taken.add('2:1:1').add('1:2:-1');
    const deskTop = (await sizeOf(ctx, 'desk'))[1];
    // the front row stands in a group of its own: it is cleared away for the after-school club
    const sets = [this.frontRow, scene].map((to) => ({ to, desks: [] as Spot[], chairs: [] as Spot[], slates: [] as Spot[], bags: [] as Spot[] }));
    DESK_ROWS.forEach((dz, row) => {
      const set = sets[row === 0 ? 0 : 1]!;
      DESK_COLS.forEach((dx, col) => {
        set.desks.push([dx, 0, dz]);
        for (const s of [-1, 1]) {
          const used = taken.has(`${row}:${col}:${s}`);
          // pupils face the front of the room; a chair nobody is sitting on is pushed in
          set.chairs.push([dx + s * 0.38, 0, dz + (used ? 0.62 : 0.5), 180]);
          set.slates.push([dx + s * 0.38, deskTop, dz - 0.06, 180 + s * 4 + rng.range(-6, 6)]);
          if (used && rng.chance(0.7)) set.bags.push([dx + s * 0.74, 0, dz + 0.5 + rng.range(-0.06, 0.06), 180 + s * 70 + rng.range(-20, 20)]);
        }
        // the front row's obstacles come and go with it: see setScene
        if (row > 0) this.colliders.box(dx, dz + DESK_COLLIDER.dz, DESK_COLLIDER.hx, DESK_COLLIDER.hz);
      });
    });
    for (const set of sets) {
      await dress(ctx, set.to, 'desk', set.desks);
      await dress(ctx, set.to, 'chair', set.chairs);
      await dress(ctx, set.to, 'slate', set.slates);
      await dress(ctx, set.to, 'backpack', set.bags);
    }
    scene.add(this.frontRow);
    await ctx.step('classroom: desks');

    // ---- the front: the headset's plinth, and the teacher's desk up on the stage ----
    await dress(ctx, scene, 'plinth', [[CLASSROOM.plinth.x, 0, CLASSROOM.plinth.z]]);
    await dress(ctx, scene, 'teacher-desk', [[TEACHER_DESK.x, STAGE_HEIGHT, TEACHER_DESK.z, 24]]);

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
    await hang('poster-harbour', 1.5, -3.82, 1.95, -D + 0.005, 0);
    await hang('poster-planets', 0.95, 3.95, 1.9, -D + 0.005, 0);
    // plants in the corners, and a row of little ones along the window sills
    const corners: Spot[] = [[-4.5, 0, -5.4], [4.5, 0, -5.4], [-4.5, 0, 5.2]];
    await dress(ctx, scene, 'plant-tall', corners.map(([x, y, z]): Spot => [x, y, z, rng.range(0, 360)]));
    for (const [x, , z] of corners) this.colliders.circle(x, z, 0.4);
    await dress(ctx, scene, 'plant-small', centres.map((z): Spot => [-W + 0.13, WY0, z + rng.range(-0.6, 0.6), rng.range(0, 360), rng.range(0.9, 1.25)]));
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
    this.beams = buildSunbeams(new Rng(2081), centres.map((z) => ({ x: -W, y0: WY0, y1: WY1, z0: z - WW / 2, z1: z + WW / 2 })),
      { min: new THREE.Vector3(-W, 0.05, -D), max: new THREE.Vector3(W, H - 0.05, D) }, ctx.quality.density);
    scene.add(this.beams.group);
    // ceiling panels: soft rectangles of light over each column of desks
    const panels = new Builder();
    for (const x of DESK_COLS) for (const z of [-3.6, -0.6, 2.4]) panels.box('glow', 0xffffff, [1.5, 0.02, 0.5], [x, H - 0.012, z], { r: 0.01 });
    this.ceiling = panels.finish(scene, { glow: 2.2 }).glow!;
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
      person.placeAt(seatOf(s)).setPose(s.who === 'jamie' || s.who === 'mina' ? 'sitLean' : 'sitDesk', { immediate: true, seat: SEAT });
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
    this.sunDirection.copy(this.sun.position).normalize();
    // morning light is thin and white; late in the day it pours in gold
    this.look.shafts = (0.5 + 0.75 * m.warm) * Math.min(1, m.sun / 3);
    this.look.shaftColor.setRGB(1.0, 0.92 - 0.2 * m.warm, 0.8 - 0.38 * m.warm);
    this.fill.intensity = 0.26 + 0.52 * m.room + 0.12 * m.warm;
    this.fill.color.setRGB(0.87 + 0.13 * m.warm, 0.91 - 0.16 * m.warm, 1.0 - 0.44 * m.warm);
    (this.ceiling.material as THREE.MeshBasicMaterial).color.setScalar(0.08 + 2.2 * m.room);
    this.scene.environmentIntensity = 0.14 + 0.36 * m.room + 0.1 * m.warm;
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
      for (const dx of DESK_COLS) this.colliders.box(dx, DESK_ROWS[0]! + DESK_COLLIDER.dz, DESK_COLLIDER.hx, DESK_COLLIDER.hz);
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
        person.placeAt(seatOf(s)).setPose(s.who === 'jamie' || s.who === 'mina' ? 'sitLean' : 'sitDesk', { immediate: true, seat: SEAT });
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

