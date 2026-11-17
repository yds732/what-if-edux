import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST } from '../../characters/cast';
import { place, roundBox, sweep, v3 } from '../../core/geo';
import { Rng, TAU, damp } from '../../core/math';
import { makeLook } from '../../render/PostPipeline';
import { bakeRoomEnvironment } from '../../render/env';
import { Panel } from '../../ui/Panel';
import { THEMES, font, glass, roundRect, wrap } from '../../ui/draw';
import { World, anchor, type Anchor, type BuildContext, type FrameContext } from '../World';
import { dress, floorOf, framed, glowOf, sizeOf } from '../dressing';
import { buildMotes, makeHalo, type Motes } from '../haven/atmosphere';
import { buildCityscape, type Cityscape } from '../cityscape';
import { Builder, makePoster } from '../interior';
import { buildPhone, type PhoneProp } from '../props';

/** The player's room: 4.6 m wide (x), 5.2 m deep (z). The window and desk are on the -Z wall. */
export const BEDROOM = {
  enter: anchor(0.35, 0, 1.3, 0),
  /** Standing at the desk. */
  desk: anchor(0.55, 0, -1.2, 0),
  /** Where the headset rests, on its dock. */
  dock: new THREE.Vector3(0.12, 0.815, -2.08),
  phone: new THREE.Vector3(0.95, 0.742, -1.98),
  /** Centre of the hologram the phone projects. */
  hologram: new THREE.Vector3(0.95, 1.26, -2.06),
} as const satisfies Record<string, Anchor | THREE.Vector3>;

export interface ChatMessage {
  readonly from: 'jamie' | 'you' | 'system';
  readonly text: string;
}

const W = 2.3, D = 2.6, H = 2.7;
/** Where the furniture stands, on the floor. The bed finds its own place against the walls. */
const DESK = { x: 0.85, z: -2.2 }, CHAIR = { x: 0.62, z: -1.5 }, LAMP = { x: -0.8, z: -2.3 };
const WARDROBE = { x: 1.7, z: 2.29 }, BEANBAG = { x: 1.62, z: 0.8 }, BAG = { x: -0.98, z: -0.22 };
/**
 * The desk: one long pale oak top hung on the window wall, with no legs, running into the right-hand corner and
 * turning a little way along the right wall. `ret` is how far the turn reaches out from the window wall.
 */
const TOP = { y: 0.74, slab: 0.03, deep: 0.62, start: -0.15, ret: 1.3, retDeep: 0.6, bend: 0.24, end: 0.07 };
const OAK = 0xd6b58e, STEEL_WHITE = 0xeef0f3, SLATE_BLUE = 0x51627e;
/** The room's accents: warm wall lights beside the window, cool LED strips tucked out of sight. */
const SCONCE_COLOR = 0xffc48a, LED_COLOR = 0xffc890;
/** The wall shelf model's platform: its underside above the shelf's base, and how far its front lip stands from the shelf's middle. */
const SHELF = { under: 0.18, front: 0.13 };
/** The mattress's top, where something left on the bed lies. */
const MATTRESS_TOP = 0.615;
/** Toward the afternoon sun, and toward the middle of the city's glow at night: both beyond the window. */
const SUN_DIRECTION = new THREE.Vector3(-0.28, 0.28, -0.96).normalize(), CITY_GLOW = new THREE.Vector3(0.12, 0.16, -1).normalize();

export class BedroomWorld extends World {
  readonly id = 'bedroom';
  readonly theme = 'real' as const;
  phone!: PhoneProp;
  private city!: Cityscape;
  private night = 1;
  private nightTarget = 1;
  private sun!: THREE.DirectionalLight;
  private skyFill!: THREE.HemisphereLight;
  private lamp!: THREE.PointLight;
  /** The painted light of the bedside lamp's shade and of the dock's ring, and how bright each is at its fullest. */
  private lampGlow!: { value: number };
  private dockGlow!: { value: number };
  private lampFull = 0;
  private dockFull = 0;
  private cove!: THREE.Mesh;
  /** The LED strips' painted light and the soft light each throws, turned up as the evening comes in. */
  private ledGlow!: THREE.Mesh;
  private readonly leds: THREE.PointLight[] = [];
  private hologram!: Panel;
  private beam!: THREE.Mesh;
  private holoShown = 0;
  private holoTarget = 0;
  private alert = false;
  private callShown = 0;
  private callTarget = 0;
  private rain!: THREE.Mesh;
  private dust!: Motes;
  private readonly clock = { value: 0 };
  private readonly lightDirection = new THREE.Vector3();

  constructor() {
    super();
    this.near = 0.05;
    this.far = 1200;
    Object.assign(this.look, makeLook({
      exposure: 1.0, bloom: 0.07, ao: 1.0, saturation: 1.02, contrast: 0.2, vignette: 0.38, grain: 0.016, chroma: 0.004, dof: 0.75, streak: 0.3,
      shadowTint: new THREE.Color(0.0, 0.006, 0.02), highlightTint: new THREE.Color(0.02, 0.008, -0.01),
    }));
    this.clearColor.set(0x0b0d16);
    // the light is whatever is beyond the glass: further off than the room is long
    this.shafts = { direction: this.lightDirection, skyFrom: 5.6 };
  }

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene;
    const rng = new Rng(1207);
    scene.environment = bakeRoomEnvironment(ctx.renderer);
    scene.environmentIntensity = 0.18;

    // ---- the city beyond the glass ----
    this.city = buildCityscape(rng.fork(), ctx.quality.density);
    this.city.group.position.set(0.4, -34, -D);
    scene.add(this.city.group);
    await ctx.step('bedroom: city');

    // ---- shell: floor, walls with one wide window, ceiling ----
    const floor = floorOf(await ctx.assets.picture('floor-bedroom'), W * 2, D * 2, 2.3, 0.55);
    // dark-stained boards, so the floor stays in the dusk of the room
    (floor.material as THREE.MeshStandardMaterial).color.setRGB(0.5, 0.42, 0.38);
    scene.add(floor);

    const b = new Builder();
    const wall = 0x46526e, trim = 0xc9cfdc, wallWarm = 0x4a5572;
    const WX0 = -1.15, WX1 = 2.0, WY0 = 0.98, WY1 = 2.34; // window opening
    b.box('matte', wall, [W + WX0, H, 0.14], [(-W + WX0) / 2, H / 2, -D - 0.07]);
    b.box('matte', wall, [W - WX1, H, 0.14], [(W + WX1) / 2, H / 2, -D - 0.07]);
    b.box('matte', wall, [WX1 - WX0, WY0, 0.14], [(WX0 + WX1) / 2, WY0 / 2, -D - 0.07]);
    b.box('matte', wall, [WX1 - WX0, H - WY1, 0.14], [(WX0 + WX1) / 2, (H + WY1) / 2, -D - 0.07]);
    b.box('matte', wallWarm, [0.14, H, D * 2], [-W - 0.07, H / 2, 0]);
    b.box('matte', wall, [0.14, H, D * 2], [W + 0.07, H / 2, 0]);
    b.box('matte', wall, [W * 2, H, 0.14], [0, H / 2, D + 0.07]);
    b.box('matte', 0xa9b0c2, [W * 2 + 0.3, 0.12, D * 2 + 0.3], [0, H + 0.06, 0]);
    for (const [sx, sz, len, rot] of [[0, -D + 0.012, W * 2, 0], [0, D - 0.012, W * 2, 0], [-W + 0.012, 0, D * 2, Math.PI / 2], [W - 0.012, 0, D * 2, Math.PI / 2]] as const) {
      b.box('satin', trim, [len, 0.09, 0.022], [sx, 0.045, sz], { rot: [0, rot, 0] });
    }
    // window: a deep sill, a dark frame with soft corners, one mullion
    b.box('satin', trim, [WX1 - WX0 + 0.16, 0.05, 0.3], [(WX0 + WX1) / 2, WY0 - 0.025, -D + 0.08], { r: 0.012 });
    const frame = [v3(WX0, WY0, 0), v3(WX1, WY0, 0), v3(WX1, WY1, 0), v3(WX0, WY1, 0), v3(WX0, WY0, 0)];
    b.add('metal', 0x2b2f3d, place(sweep(frame, () => 0.035, { radial: 6, polyline: true, steps: 4, startCap: 'flat', endCap: 'flat' }), [0, 0, -D - 0.01]));
    b.box('metal', 0x2b2f3d, [0.04, WY1 - WY0, 0.04], [0.7, (WY0 + WY1) / 2, -D - 0.01]);
    b.finish(scene);
    await ctx.step('bedroom: shell');

    // ---- furniture ----
    const deskTop = (await sizeOf(ctx, 'study-desk'))[1];
    const [bedWide, , bedLong] = await sizeOf(ctx, 'bed');
    // the bed against the warm wall, head to the window; the star plush on it came with them from the old house
    const bx = -W + bedWide / 2 + 0.02, bz = -D + bedLong / 2 + 0.05;
    await dress(ctx, scene, 'bed', [[bx, 0, bz]]);
    this.lampGlow = glowOf(await dress(ctx, scene, 'bedside', [[LAMP.x, 0, LAMP.z, 15]]));
    this.lampFull = this.lampGlow.value;
    scene.add(buildDesk());
    await dress(ctx, scene, 'desk-chair', [[CHAIR.x, 0, CHAIR.z, 205]]);
    scene.add(buildMonitor(1.72, deskTop, -2.27, 0));
    await dress(ctx, scene, 'slate', [[DESK.x - 0.2, deskTop, DESK.z + 0.1, 12]]);
    this.dockGlow = glowOf(await dress(ctx, scene, 'dock', [[BEDROOM.dock.x, deskTop, BEDROOM.dock.z]]));
    this.dockFull = this.dockGlow.value;
    await dress(ctx, scene, 'plant-small', [[DESK.x - 0.62, deskTop, DESK.z - 0.2, 40, 1.15], [1.7, WY0, -D + 0.1, 200, 1.4]]);
    const sx = W - 0.16;
    await dress(ctx, scene, 'wall-shelf', [[sx, 1.02, -0.72, -90], [sx, 1.6, -0.3, -90]]);
    await dress(ctx, scene, 'wardrobe', [[WARDROBE.x, 0, WARDROBE.z, 180]]);
    await dress(ctx, scene, 'beanbag', [[BEANBAG.x, 0, BEANBAG.z, -40]]);
    // school bag slumped by the bed
    await dress(ctx, scene, 'backpack', [[BAG.x, 0, BAG.z, 35]]);
    await dress(ctx, scene, 'door', [[-1.2, 0, D - 0.07, 180]]);
    // the routine screen on the left-hand wall as you come in: 65% of the wall's height, centred on it
    const board = buildRoutineBoard(1.25, H * 0.65);
    board.position.set(-W + 0.002, H / 2, 1.2);
    board.rotation.y = Math.PI / 2;
    scene.add(board);
    // a sports bottle on the desk, and a book left open face down on the bed
    scene.add(buildBottle(1.12, deskTop, -2.42));
    scene.add(buildBook(bx + 0.08, MATTRESS_TOP, bz + 0.38, 28));
    await ctx.step('bedroom: furniture');

    // ---- rug, posters, glass ----
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.15, 64), new THREE.MeshStandardMaterial({ map: (await ctx.assets.picture('rug')).map, roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.25, 0.006, 0.35);
    rug.receiveShadow = true;
    scene.add(rug);

    const stars = await ctx.assets.picture('poster-stars');
    const starMap = framed(stars.map, 0.6, (0.6 * stars.entry.size[1]) / stars.entry.size[0], 0x3b4258);
    starMap.position.set(-W + 0.004, 1.82, -1.75);
    starMap.rotation.y = Math.PI / 2;
    // the poster the city sent: its picture, with the words that came on it
    const city = await ctx.assets.picture('poster-newstart');
    const welcome = makePoster(0.66, 0.44, (c, w, h) => {
      c.drawImage(city.map.image as CanvasImageSource, 0, 0, w, h);
      c.fillStyle = 'rgba(255, 246, 232, 0.92)';
      c.fillRect(0, h * 0.74, w, h * 0.26);
      c.fillStyle = '#b5553c';
      c.font = font(700, 40);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('NEW CITY, NEW START', w / 2, h * 0.83);
      c.fillStyle = '#5d6884';
      c.font = font(400, 21);
      c.fillText('Harbour District welcomes you', w / 2, h * 0.93);
    });
    welcome.position.set(-W + 0.006, 1.5, -0.62);
    welcome.rotation.y = Math.PI / 2;
    scene.add(starMap, welcome);

    // two posters on the back wall, between the door and the wardrobe: a band they like, and a tennis tournament
    const band = makePoster(0.5, 0.72, paintBandPoster);
    band.position.set(-0.3, 1.55, D - 0.006);
    band.rotation.y = Math.PI;
    const tennis = makePoster(0.62, 0.44, paintTennisPoster);
    tennis.position.set(0.56, 1.62, D - 0.006);
    tennis.rotation.y = Math.PI;
    scene.add(band, tennis);

    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xbfd4ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(WX1 - WX0, WY1 - WY0), glassMat);
    pane.position.set((WX0 + WX1) / 2, (WY0 + WY1) / 2, -D - 0.02);
    scene.add(pane);
    // rain on the glass at night: thin bright streaks that crawl down
    this.rain = new THREE.Mesh(new THREE.PlaneGeometry(WX1 - WX0, WY1 - WY0), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAmount; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // one sheet of drops: each cell of a grid has a drop that slides down it, leaving a thinning trail of beads
        float drops(vec2 uv, float t, float size){
          vec2 grid = vec2(size * 2.4, size);
          vec2 cell = floor(uv * grid), f = fract(uv * grid) - 0.5;
          float n = h(cell), speed = 0.18 + 0.42 * n;
          float fall = fract(t * speed + n * 7.0);
          // a drop hangs, then lets go
          float y = 0.42 - 0.84 * smoothstep(0.0, 1.0, fall * fall);
          float x = (n - 0.5) * 0.5 + 0.04 * sin(fall * 9.0 + n * 40.0);
          vec2 d = (f - vec2(x, y)) * vec2(grid.y / grid.x * 2.4, 1.0);
          float head = smoothstep(0.085, 0.02, length(d));
          float trail = smoothstep(0.03, 0.0, abs(d.x)) * smoothstep(-0.02, 0.1, d.y) * smoothstep(0.55, 0.0, d.y) * 0.5;
          float beads = smoothstep(0.03, 0.0, length(vec2(d.x, fract(d.y * 9.0) - 0.5) * vec2(1.0, 0.11))) * step(0.0, d.y) * smoothstep(0.5, 0.05, d.y) * 0.5;
          return (head + max(trail, beads)) * step(0.35, n);
        }
        void main(){
          float aspect = 2.3;
          vec2 uv = vec2(vUv.x * aspect, vUv.y);
          float rain = drops(uv, uTime, 9.0) + drops(uv * 1.7 + 3.1, uTime * 1.25, 9.0) * 0.6;
          // the stillest drops only catch the light
          float still = smoothstep(0.985, 1.0, h(floor(uv * 90.0))) * (0.6 + 0.4 * sin(uTime * 2.0 + h(floor(uv * 90.0)) * 50.0));
          gl_FragColor = vec4(vec3(0.6, 0.76, 1.0) * (rain * 0.5 + still * 0.35) * uAmount, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.rain.position.copy(pane.position).add(v3(0, 0, 0.004));
    scene.add(this.rain);

    // ---- light ----
    this.skyFill = new THREE.HemisphereLight(0x7f8fd0, 0x3a3040, 0.5);
    this.sun = new THREE.DirectionalLight(0xffc89a, 2.5);
    this.sun.position.set(-2.2, 3.4, -9);
    this.sun.target.position.set(0.6, 0.6, 0.6);
    this.sun.castShadow = ctx.quality.shadows;
    this.sun.shadow.mapSize.set(ctx.quality.shadowMapSize, ctx.quality.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 1; sc.far = 22;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 6;
    this.lamp = new THREE.PointLight(0xffb070, 2.6, 6.5, 1.7);
    this.lamp.position.set(LAMP.x, 0.86, LAMP.z + 0.04);
    const lampGlow = makeHalo(0xffb070, 1.5, 0.3);
    lampGlow.position.set(LAMP.x, 0.82, LAMP.z);
    // a strip of cool light in the cove above the window
    this.cove = new THREE.Mesh(new THREE.BoxGeometry(WX1 - WX0, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.72, 1.0).multiplyScalar(1.8) }));
    this.cove.position.set((WX0 + WX1) / 2, WY1 + 0.14, -D + 0.05);
    const coveLight = new THREE.PointLight(0x8fb0ff, 0.9, 5, 2);
    coveLight.position.set(0.6, 2.3, -2.2);
    scene.add(this.skyFill, this.sun, this.sun.target, this.lamp, lampGlow, this.cove, coveLight);

    // quarter-sphere wall lights: a bowl against the wall, its flat cut face on top, throwing warm light up the wall.
    // One on the right-hand wall beside the window, one above the bed's headboard.
    const fx = new Builder();
    const SCONCE_R = 0.14;
    const sconces: { at: [number, number, number]; out: [number, number] }[] = [
      { at: [W, 1.78, -1.91], out: [-1, 0] },
      { at: [-W + bedWide / 2 + 0.02, 1.62, -D], out: [0, 1] },
    ];
    for (const { at, out } of sconces) {
      // the half of the sphere's azimuth that is in the room, and the lower half of its height
      const phiStart = out[0] < 0 ? -Math.PI / 2 : 0;
      const bowl = new THREE.SphereGeometry(SCONCE_R, 32, 12, phiStart, Math.PI, Math.PI / 2, Math.PI / 2);
      bowl.deleteAttribute('uv');
      fx.add('glow', 0x9c8a72, place(bowl, at));
      const cut = new THREE.CircleGeometry(SCONCE_R, 32, out[0] < 0 ? Math.PI / 2 : Math.PI, Math.PI).rotateX(-Math.PI / 2);
      cut.deleteAttribute('uv');
      fx.add('glow', 0xffe2c0, place(cut, [at[0], at[1] + 0.001, at[2]]));
      const up = new THREE.PointLight(SCONCE_COLOR, 1.2, 4, 1.8);
      up.position.set(at[0] + out[0] * 0.12, at[1] + 0.2, at[2] + out[1] * 0.12);
      const down = new THREE.PointLight(SCONCE_COLOR, 0.35, 3, 2);
      down.position.set(at[0] + out[0] * 0.3, at[1] - 0.15, at[2] + out[1] * 0.3);
      scene.add(up, down);
    }
    fx.finish(scene, { glow: 2.4, shadows: false });
    // LED strips, hidden so only their light shows: under the back of the desk, on top of the wardrobe, under each shelf
    const strips = new Builder();
    const strip = (size: [number, number, number], at: [number, number, number], light: [number, number, number], power: number, reach: number): void => {
      strips.box('glow', LED_COLOR, size, at);
      const led = new THREE.PointLight(LED_COLOR, power, reach, 2);
      led.position.set(...light);
      led.userData.power = power;
      this.leds.push(led);
      scene.add(led);
    };
    const under = TOP.y - TOP.slab - 0.006;
    strip([W - TOP.start - 0.1, 0.006, 0.008], [(TOP.start + W) / 2, under, -D + 0.03], [0.9, 0.45, -D + 0.15], 0.9, 2.6);
    strip([0.008, 0.006, TOP.ret - 0.12], [W - 0.03, under, -D + TOP.ret / 2], [W - 0.32, 0.5, -1.85], 0.22, 1.6);
    strip([1.0, 0.006, 0.008], [WARDROBE.x, 1.905, D - 0.04], [WARDROBE.x, 2.1, D - 0.12], 0.8, 2.4);
    // on each shelf, a strip along the front edge of the platform itself, under its lip, lighting the shelf below and the wall
    for (const [y, z] of [[1.02, -0.72], [1.6, -0.3]] as const) strip([0.008, 0.005, 1.12], [W - 0.16 - SHELF.front, y + SHELF.under - 0.003, z], [W - 0.2, y + SHELF.under - 0.12, z], 0.3, 1.3);
    this.ledGlow = strips.finish(scene, { glow: 2.2, shadows: false }).glow!;

    this.dust = buildMotes(Math.round(60 * ctx.quality.density), v3(LAMP.x + 0.3, 0.4, LAMP.z + 0.5), v3(1.0, 1.1, 0.9), rng.fork(), this.clock, { a: 0xffc890, b: 0xffe9c8, size: 0.015, gain: 0.7 });
    scene.add(this.dust.points);

    // ---- phone, dock light, hologram ----
    this.phone = await buildPhone(ctx.assets);
    this.phone.group.position.copy(BEDROOM.phone);
    this.phone.group.rotation.y = 0.35;
    scene.add(this.phone.group);
    this.hologram = new Panel(760, 500, { world: true, additive: false });
    this.hologram.mesh.scale.set(0.95, 0.625, 1);
    this.hologram.mesh.position.copy(BEDROOM.hologram);
    this.hologram.mesh.rotation.set(-0.08, -0.12, 0);
    this.hologram.opacity = 0;
    this.hologram.mesh.renderOrder = 4;
    scene.add(this.hologram.mesh);
    const beamGeo = new THREE.CylinderGeometry(0.4, 0.03, 0.42, 24, 1, true);
    beamGeo.translate(0, 0.21, 0);
    this.beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uShow: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uShow; varying vec2 vUv; void main(){ gl_FragColor = vec4(vec3(0.35, 0.65, 1.0) * (1.0 - vUv.y) * 0.5 * uShow, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }));
    this.beam.position.copy(BEDROOM.phone).add(v3(0, 0.01, 0));
    scene.add(this.beam);

    // Jamie, as the phone shows them on a call: small, standing in the projection
    const jamie = this.addPerson('jamie', await Character.create(ctx, { ...CAST.jamie, scale: 0.34 }, 'jamie', true));
    jamie.place(BEDROOM.hologram.x, BEDROOM.phone.y + 0.03, BEDROOM.hologram.z + 0.04, 0.12);
    jamie.setProjected(0x8fd0ff);
    jamie.root.visible = false;
    const callLight = new THREE.PointLight(0x8fd0ff, 0, 1.6, 2);
    callLight.name = 'callLight';
    callLight.position.set(BEDROOM.hologram.x, 1.25, BEDROOM.hologram.z + 0.3);
    scene.add(callLight);

    this.colliders.bounds = { kind: 'rect', minX: -W, maxX: W, minZ: -D, maxZ: D };
    this.colliders.box(bx, bz, bedWide / 2, bedLong / 2).box(LAMP.x, LAMP.z, 0.28, 0.28).box((TOP.start + W) / 2, -D + TOP.deep / 2, (W - TOP.start) / 2, TOP.deep / 2 + 0.05)
      .box(W - TOP.retDeep / 2, -D + (TOP.deep + TOP.ret) / 2, TOP.retDeep / 2 + 0.05, (TOP.ret - TOP.deep) / 2 + 0.05).circle(CHAIR.x, CHAIR.z, 0.3)
      .box(sx, -0.5, 0.16, 0.88).box(WARDROBE.x, WARDROBE.z, 0.57, 0.31)
      .circle(BEANBAG.x, BEANBAG.z, 0.42).circle(BAG.x, BAG.z, 0.2);
    this.setNight(1, true);
  }

  /** 0 is a warm afternoon, 1 a rainy night. */
  setNight(k: number, immediate = false): void {
    this.nightTarget = k;
    if (immediate) {
      this.night = k;
      this.applyNight();
    }
  }

  private applyNight(): void {
    const n = this.night;
    // a dim city at night beyond the glass, its windows lit and softened by the rain
    this.city.setNight(0.75 + 0.25 * n);
    this.city.setOvercast(0.55);
    // dark and moody: almost no general light, so the lamps, the wall lights and the LED strips are what you see by
    this.sun.intensity = 0.16;
    this.sun.color.setRGB(0.62, 0.7, 0.95);
    this.skyFill.intensity = 0.14;
    for (const led of this.leds) led.intensity = (led.userData.power as number) * (0.5 + 0.5 * n);
    (this.ledGlow.material as THREE.MeshBasicMaterial).color.setScalar(1.2 + 1.0 * n);
    this.skyFill.color.setRGB(0.5, 0.56, 0.74);
    this.lamp.intensity = 0.4 + 2.6 * n;
    this.lampGlow.value = this.lampFull * (0.2 + 0.8 * n);
    (this.cove.material as THREE.MeshBasicMaterial).color.setRGB(0.8, 0.84, 0.92).multiplyScalar(0.3 + 0.5 * n);
    (this.rain.material as THREE.ShaderMaterial).uniforms.uAmount!.value = n * 0.6;
    this.look.exposure = 0.82 + 0.06 * n;
    this.lightDirection.copy(SUN_DIRECTION).lerp(CITY_GLOW, 0.5).normalize();
    this.look.shafts = 0.04;
    this.look.shaftColor.setRGB(0.6, 0.7, 0.95);
    this.scene.environmentIntensity = 0.08;
  }

  /** The phone pulses when a message is waiting. */
  override reset(): void {
    this.setAlert(false);
    this.setMessages(null);
    this.setCall(false);
  }

  setAlert(on: boolean): void {
    this.alert = on;
  }

  /** Shows the phone's hologram with a chat thread and an optional footer; null closes it. */
  setMessages(messages: readonly ChatMessage[] | null, footer?: { left: string; right: string } | null): void {
    if (!messages) {
      this.holoTarget = 0;
      return;
    }
    this.holoTarget = 1;
    const theme = THEMES.real;
    this.hologram.paint((ctx, w, h) => {
      glass(ctx, 24, 24, w - 48, h - 48, theme, { radius: 34, glow: 1.6, borderWidth: 2.5, border: 'rgba(160, 205, 255, 0.75)' });
      // header: who is writing
      ctx.fillStyle = '#9fc6ff';
      ctx.beginPath();
      ctx.arc(84, 84, 26, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#17203a';
      ctx.font = font(700, 26);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('J', 84, 86);
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.text;
      ctx.font = font(600, 30);
      ctx.fillText('Jamie', 126, 74);
      ctx.fillStyle = theme.dim;
      ctx.font = font(400, 19);
      ctx.fillText('Classmate · Harbour District School', 126, 104);
      let y = 150;
      for (const m of messages) {
        ctx.font = font(400, 25);
        const lines = wrap(ctx, m.text, w - 250);
        const bw = Math.min(w - 190, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 44), bh = lines.length * 33 + 26;
        const mine = m.from === 'you';
        const x = mine ? w - 60 - bw : 60;
        ctx.fillStyle = mine ? 'rgba(120, 190, 255, 0.34)' : 'rgba(255, 255, 255, 0.13)';
        roundRect(ctx, x, y, bw, bh, 20);
        ctx.fill();
        ctx.fillStyle = theme.text;
        lines.forEach((l, i) => ctx.fillText(l, x + 22, y + 30 + i * 33));
        y += bh + 12;
      }
      if (footer) {
        // two things at the same hour
        const fy = h - 112;
        ctx.fillStyle = 'rgba(255, 190, 120, 0.2)';
        roundRect(ctx, 54, fy, w - 108, 62, 16);
        ctx.fill();
        ctx.font = font(600, 19);
        ctx.fillStyle = '#ffd9a8';
        ctx.fillText(footer.left, 76, fy + 32);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffc2ee';
        ctx.fillText(footer.right, w - 76, fy + 32);
        ctx.textAlign = 'left';
      }
    });
  }

  /** Brings Jamie up on a call above the phone, or ends it. */
  setCall(on: boolean): void {
    this.callTarget = on ? 1 : 0;
    const jamie = this.cast.jamie!;
    if (on) {
      jamie.root.visible = true;
      this.holoTarget = 0;
    }
  }

  override update(frame: FrameContext): void {
    super.update(frame);
    const { dt, time } = frame;
    this.city.update(time);
    this.clock.value = time;
    this.dust.setPixelHeight(frame.pixelHeight);
    if (Math.abs(this.night - this.nightTarget) > 0.001) {
      this.night = damp(this.night, this.nightTarget, 1.2, dt);
      this.applyNight();
    }
    (this.rain.material as THREE.ShaderMaterial).uniforms.uTime!.value = time;
    const pulse = this.alert ? 0.5 + 0.5 * Math.sin(time * 5) : 0;
    this.holoShown = damp(this.holoShown, this.holoTarget, 6, dt);
    this.callShown = damp(this.callShown, this.callTarget, 5, dt);
    this.phone.setGlow(Math.max(pulse, this.holoShown, this.callShown));
    this.hologram.opacity = this.holoShown;
    this.hologram.mesh.position.y = BEDROOM.hologram.y + Math.sin(time * 1.1) * 0.008 - (1 - this.holoShown) * 0.12;
    (this.beam.material as THREE.ShaderMaterial).uniforms.uShow!.value = Math.max(this.holoShown, this.callShown);
    this.dockGlow.value = this.dockFull * (1 + 0.3 * Math.sin(time * 2));
    const jamie = this.cast.jamie!;
    if (jamie.root.visible) {
      jamie.root.scale.setScalar(0.34 * Math.max(0.001, this.callShown));
      if (this.callShown < 0.01 && this.callTarget === 0) jamie.root.visible = false;
    }
    const callLight = this.scene.getObjectByName('callLight') as THREE.PointLight;
    callLight.intensity = this.callShown * 1.2;
  }
}


/** A gig poster for a band: a big setting sun over the sea, the band's name in heavy type. */
const paintBandPoster = (c: CanvasRenderingContext2D, w: number, h: number): void => {
  c.fillStyle = '#1f2a44';
  c.fillRect(0, 0, w, h);
  const sun = c.createLinearGradient(0, h * 0.18, 0, h * 0.58);
  sun.addColorStop(0, '#ffcf6b');
  sun.addColorStop(1, '#f2665a');
  c.fillStyle = sun;
  c.beginPath();
  c.arc(w / 2, h * 0.42, w * 0.32, Math.PI, 0);
  c.fill();
  c.fillStyle = '#1f2a44';
  for (let i = 0; i < 5; i++) c.fillRect(w * 0.15, h * (0.3 + i * 0.026), w * 0.7, 2 + i * 1.5);
  c.fillStyle = '#3fa7a3';
  c.fillRect(0, h * 0.42, w, h * 0.12);
  c.fillStyle = '#7fd0c4';
  for (let i = 0; i < 4; i++) c.fillRect(w * (0.2 + i * 0.08), h * (0.45 + i * 0.022), w * (0.6 - i * 0.16), 3);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#ffe9c8';
  c.font = font(800, 62);
  c.fillText('THE LOW', w / 2, h * 0.64);
  c.fillText('TIDES', w / 2, h * 0.73);
  c.fillStyle = '#f2665a';
  c.font = font(600, 22);
  c.fillText('LIVE · HARBOUR HALL', w / 2, h * 0.83);
  c.fillStyle = '#9fb0d0';
  c.font = font(400, 17);
  c.fillText('SAT 14 SEPT · DOORS 7PM', w / 2, h * 0.89);
};

/** A tennis poster: a ball over the lines of a clay court, in flat colour. */
const paintTennisPoster = (c: CanvasRenderingContext2D, w: number, h: number): void => {
  c.fillStyle = '#d9774a';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#fbeee0';
  c.lineWidth = 5;
  c.strokeRect(w * 0.08, h * 0.12, w * 0.84, h * 0.76);
  c.beginPath();
  c.moveTo(w * 0.08, h * 0.5);
  c.lineTo(w * 0.92, h * 0.5);
  c.moveTo(w * 0.5, h * 0.12);
  c.lineTo(w * 0.5, h * 0.88);
  c.stroke();
  c.fillStyle = '#d8f04a';
  c.beginPath();
  c.arc(w * 0.72, h * 0.33, h * 0.14, 0, TAU);
  c.fill();
  c.strokeStyle = '#fbfbf2';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(w * 0.72 - h * 0.17, h * 0.33, h * 0.14, -0.7, 0.7);
  c.arc(w * 0.72 + h * 0.17, h * 0.33, h * 0.14, Math.PI - 0.7, Math.PI + 0.7);
  c.stroke();
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillStyle = '#fff8ee';
  c.font = font(800, 54);
  c.fillText('MATCH', w * 0.12, h * 0.62);
  c.fillText('POINT', w * 0.12, h * 0.76);
  c.fillStyle = '#5a2a18';
  c.font = font(500, 18);
  c.fillText('HARBOUR JUNIOR OPEN', w * 0.12, h * 0.9);
};

// ---- the desk and the monitor ----

/** Pale oak, its grain running along the desk: one metre of wood per repeat. */
const oakGrain = (): THREE.CanvasTexture => {
  const size = 1024, rng = new Rng(4411);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#d6b58e';
  c.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const y = rng.range(0, size), amp = rng.range(2, 10), freq = rng.range(0.002, 0.006), phase = rng.range(0, TAU);
    c.strokeStyle = rng.chance(0.5) ? `rgba(150, 108, 66, ${rng.range(0.05, 0.16)})` : `rgba(240, 214, 178, ${rng.range(0.06, 0.18)})`;
    c.lineWidth = rng.range(0.6, 3.2);
    c.beginPath();
    for (let x = 0; x <= size; x += 16) c.lineTo(x, y + Math.sin(x * freq + phase) * amp);
    c.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return map;
};

/**
 * The desk: a slim oak top fixed to the walls, no legs, running from beside the bed into the corner and a little way
 * along the right-hand wall, with a soft curve where the two runs meet. A white steel rail holds it to the walls and
 * a slate-blue drawer unit hangs under the end of the turn.
 */
const buildDesk = (): THREE.Group => {
  const group = new THREE.Group();
  const { y, slab, deep, start, ret, retDeep, bend, end } = TOP;
  // the outline seen from above, in (x, -z): the window wall is at -z = D
  const s = new THREE.Shape();
  const front = D - deep, inner = W - retDeep, tip = D - ret;
  s.moveTo(start, D);
  s.lineTo(W, D);
  s.lineTo(W, tip);
  s.lineTo(inner + end, tip);
  s.quadraticCurveTo(inner, tip, inner, tip + end);
  s.lineTo(inner, front - bend);
  s.quadraticCurveTo(inner, front, inner - bend, front);
  s.lineTo(start + end, front);
  s.quadraticCurveTo(start, front, start, front + end);
  s.lineTo(start, D);
  const bevel = 0.004;
  const top = new THREE.ExtrudeGeometry(s, { depth: slab - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 16 });
  top.rotateX(-Math.PI / 2);
  top.translate(0, y - slab + bevel, 0);
  const map = oakGrain();
  const wood = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map, roughness: 0.55 }));
  wood.castShadow = wood.receiveShadow = true;
  group.add(wood);

  const b = new Builder();
  const below = y - slab;
  // the rail that holds it to the walls
  b.box('satin', STEEL_WHITE, [W - start - 0.04, 0.05, 0.02], [(start + W) / 2, below - 0.025, -D + 0.01], { r: 0.004 });
  b.box('satin', STEEL_WHITE, [0.02, 0.05, ret - 0.04], [W - 0.01, below - 0.025, -D + ret / 2], { r: 0.004 });
  // the drawers, hung under the end of the turn, fronts toward the room
  const unit = { x: W - retDeep / 2 + 0.01, z: -D + ret - 0.33, wide: retDeep - 0.08, deep: 0.5, tall: 0.28 };
  b.box('satin', SLATE_BLUE, [unit.wide, unit.tall, unit.deep], [unit.x, below - unit.tall / 2, unit.z], { r: 0.012 });
  for (const k of [0, 1]) {
    const cy = below - unit.tall * (0.27 + 0.5 * k);
    b.box('satin', 0x46566f, [0.006, 0.004, unit.deep - 0.06], [unit.x - unit.wide / 2 - 0.001, below - unit.tall / 2, unit.z]);
    const knob = new THREE.SphereGeometry(0.016, 14, 10);
    knob.deleteAttribute('uv');
    b.add('satin', OAK, place(knob, [unit.x - unit.wide / 2 - 0.012, cy, unit.z]));
  }
  b.finish(group);
  return group;
};

/** A large, slim monitor: an edge-to-edge dark glass screen, a white ceramic back no thicker than a finger, on a slender neck and a round oak foot. */
const buildMonitor = (x: number, y: number, z: number, yawDeg: number): THREE.Group => {
  const group = new THREE.Group();
  const wide = 0.86, tall = 0.37, thick = 0.008, lift = 0.17;
  const back = new THREE.Mesh(new THREE.BoxGeometry(wide, tall, thick), new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.4 }));
  back.position.set(0, lift + tall / 2, 0);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(wide - 0.004, tall - 0.004), new THREE.MeshPhysicalMaterial({ color: 0x07090d, roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 }));
  screen.position.set(0, lift + tall / 2, thick / 2 + 0.0005);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, lift + 0.08, 16), new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.35 }));
  neck.position.set(0, (lift + 0.08) / 2, -0.03);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.115, 0.012, 40), new THREE.MeshStandardMaterial({ map: oakGrain(), roughness: 0.55 }));
  foot.position.set(0, 0.006, -0.03);
  for (const m of [back, screen, neck, foot]) {
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  group.position.set(x, y, z);
  group.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  return group;
};

// ---- the routine screen, the bottle and the book ----

/** A wall screen that helps with the day: the two alarms, and the week's weather as symbols. Faces +Z; its origin is its middle. */
const buildRoutineBoard = (wide: number, tall: number): THREE.Group => {
  const group = new THREE.Group();
  const px = 760, py = Math.round((px * tall) / wide);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = py;
  const c = canvas.getContext('2d')!;
  const bg = c.createLinearGradient(0, 0, 0, py);
  bg.addColorStop(0, '#101a33');
  bg.addColorStop(1, '#0b1224');
  c.fillStyle = bg;
  c.fillRect(0, 0, px, py);
  const pad = 56;
  c.fillStyle = 'rgba(150, 190, 255, 0.75)';
  c.font = font(600, 30);
  c.fillText('MY DAY', pad, 92);

  // the alarms: a card each, a symbol, the time and a switch that is on
  const alarm = (y: number, label: string, time: string, icon: 'sun' | 'moon'): void => {
    c.fillStyle = 'rgba(255, 255, 255, 0.06)';
    roundRect(c, pad, y, px - pad * 2, 190, 28);
    c.fill();
    if (icon === 'sun') drawSun(c, pad + 78, y + 95, 30);
    else {
      c.fillStyle = '#c9d6ff';
      c.beginPath(); c.arc(pad + 78, y + 95, 34, 0, TAU); c.fill();
      c.fillStyle = '#16213d';
      c.beginPath(); c.arc(pad + 94, y + 82, 30, 0, TAU); c.fill();
    }
    c.fillStyle = 'rgba(200, 215, 255, 0.7)';
    c.font = font(500, 30);
    c.fillText(label, pad + 150, y + 74);
    c.fillStyle = '#ffffff';
    c.font = font(300, 72);
    c.fillText(time, pad + 146, y + 146);
    const sx = px - pad - 120, sy = y + 72;
    c.fillStyle = '#4f8dff';
    roundRect(c, sx, sy, 88, 46, 23);
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(sx + 65, sy + 23, 18, 0, TAU); c.fill();
  };
  alarm(140, 'Wake up', '7:00 AM', 'sun');
  alarm(360, 'Bedtime', '9:30 PM', 'moon');

  // the week's weather, symbols only
  const top = 620;
  c.fillStyle = 'rgba(150, 190, 255, 0.75)';
  c.font = font(600, 30);
  c.fillText('THIS WEEK', pad, top);
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const sky: ('sun' | 'part' | 'cloud' | 'rain')[] = ['sun', 'part', 'cloud', 'rain', 'rain', 'part', 'sun'];
  const colW = (px - pad * 2) / 7;
  c.fillStyle = 'rgba(255, 255, 255, 0.05)';
  roundRect(c, pad, top + 28, px - pad * 2, py - top - 28 - pad, 28);
  c.fill();
  const mid = top + 28 + (py - top - 28 - pad) / 2;
  days.forEach((d, i) => {
    const x = pad + colW * (i + 0.5);
    c.fillStyle = i === 1 ? '#ffffff' : 'rgba(200, 215, 255, 0.6)';
    c.font = font(i === 1 ? 700 : 500, 30);
    c.textAlign = 'center';
    c.fillText(d, x, mid - 70);
    c.textAlign = 'left';
    const kind = sky[i]!;
    if (kind === 'sun') drawSun(c, x, mid + 10, 20);
    if (kind === 'part') { drawSun(c, x + 10, mid - 2, 15); drawCloud(c, x - 4, mid + 18, 0.75); }
    if (kind === 'cloud') drawCloud(c, x, mid + 10, 0.9);
    if (kind === 'rain') {
      drawCloud(c, x, mid, 0.85);
      c.strokeStyle = '#6fb6ff';
      c.lineWidth = 4;
      c.lineCap = 'round';
      for (const dx of [-14, 0, 14]) { c.beginPath(); c.moveTo(x + dx, mid + 26); c.lineTo(x + dx - 6, mid + 44); c.stroke(); }
    }
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const body = new THREE.Mesh(new THREE.BoxGeometry(wide + 0.016, tall + 0.016, 0.028), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.3, metalness: 0.6 }));
  body.position.z = 0.014;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(wide, tall), new THREE.MeshBasicMaterial({ map }));
  face.material.color.setScalar(1.05);
  face.position.z = 0.0285;
  group.add(body, face);
  return group;
};

const drawSun = (c: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
  c.strokeStyle = '#ffd25e';
  c.lineWidth = r * 0.16;
  c.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35);
    c.lineTo(x + Math.cos(a) * r * 1.7, y + Math.sin(a) * r * 1.7);
    c.stroke();
  }
  c.fillStyle = '#ffd25e';
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
};

const drawCloud = (c: CanvasRenderingContext2D, x: number, y: number, s: number): void => {
  c.fillStyle = '#dfe7f5';
  for (const [dx, dy, r] of [[-18, 6, 16], [0, -6, 22], [20, 4, 17]] as const) {
    c.beginPath(); c.arc(x + dx * s, y + dy * s, r * s, 0, TAU); c.fill();
  }
  roundRect(c, x - 34 * s, y + 4 * s, 70 * s, 20 * s, 10 * s);
  c.fill();
};

/** A sports water bottle: a teal body that narrows a little at the waist, a grey flip cap with a carry loop. */
const buildBottle = (x: number, y: number, z: number): THREE.Group => {
  const group = new THREE.Group();
  const profile = [[0, 0], [0.033, 0], [0.036, 0.008], [0.036, 0.07], [0.032, 0.1], [0.036, 0.13], [0.036, 0.18], [0.03, 0.2], [0.024, 0.205]]
    .map(([r, h]) => new THREE.Vector2(r, h));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), new THREE.MeshStandardMaterial({ color: 0x23a6a0, roughness: 0.35 }));
  const capMat = new THREE.MeshStandardMaterial({ color: 0x585e68, roughness: 0.6 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.027, 0.032, 28), capMat);
  cap.position.y = 0.221;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.022, 16), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5 }));
  spout.position.y = 0.247;
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 8, 20), capMat);
  loop.position.set(0.024, 0.236, 0);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0365, 0.0365, 0.024, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5 }));
  band.position.y = 0.15;
  for (const m of [body, cap, spout, loop, band]) {
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  group.position.set(x, y, z);
  return group;
};

/** A paperback left open and face down on the bed: a soft yellow cover tented over its pages, rounded like the bed. */
const buildBook = (x: number, y: number, z: number, yawDeg: number): THREE.Group => {
  const group = new THREE.Group();
  const w = 0.15, d = 0.22, board = 0.008, lean = THREE.MathUtils.degToRad(13);
  const rise = w * Math.sin(lean);
  const cover = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.7 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xf7f0dc, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const theta = side < 0 ? lean : -lean;
    const mid = new THREE.Vector3(side * (w / 2) * Math.cos(lean), rise / 2 + 0.018, 0);
    const half = new THREE.Mesh(roundBox(w, board, d, 0.004, 2), cover);
    half.position.copy(mid);
    half.rotation.z = theta;
    const pages = new THREE.Mesh(roundBox(w - 0.012, 0.016, d - 0.012, 0.003, 1), paper);
    pages.position.set(mid.x, mid.y - 0.012, 0);
    pages.rotation.z = theta;
    group.add(half, pages);
  }
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, d, 16, 1, false, 0, Math.PI), cover);
  spine.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
  spine.position.set(0, rise + 0.016, 0);
  group.add(spine);
  group.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true; });
  group.position.set(x, y, z);
  group.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  return group;
};
