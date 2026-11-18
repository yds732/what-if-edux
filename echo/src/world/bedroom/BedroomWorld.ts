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
import { dress, floorOf, glowOf, sizeOf } from '../dressing';
import { buildMotes, makeHalo, type Motes } from '../haven/atmosphere';
import { buildCityscape, type Cityscape } from '../cityscape';
import { Builder, makePoster } from '../interior';
import { buildPhone, type PhoneProp } from '../props';

export const BEDROOM = {
  enter: anchor(0.35, 0, 1.3, 0),
  desk: anchor(0.55, 0, -1.2, 0),
  dock: new THREE.Vector3(0.12, 0.815, -2.08),
  phone: new THREE.Vector3(0.95, 0.742, -1.98),
  hologram: new THREE.Vector3(0.95, 1.26, -2.06),
} as const satisfies Record<string, Anchor | THREE.Vector3>;

export interface ChatMessage {
  readonly from: 'jamie' | 'you' | 'system';
  readonly text: string;
}

const W = 2.3, D = 2.6, H = 2.7;
const DESK = { x: 0.85, z: -2.2 }, CHAIR = { x: 0.62, z: -1.5 }, LAMP = { x: -0.8, z: -2.3 };
const WARDROBE = { x: 1.7, z: 2.29 }, BEANBAG = { x: 1.62, z: 0.8 }, BAG = { x: -0.98, z: -0.22 };
const TOP = { y: 0.74, slab: 0.03, deep: 0.62, start: -0.15, ret: 1.3, retDeep: 0.6, bend: 0.24, end: 0.07 };
const OAK = 0xd6b58e, STEEL_WHITE = 0xeef0f3, SLATE_BLUE = 0x51627e;
const SCONCE_COLOR = 0xfff1e0, LED_COLOR = 0xfff1e0;
const SHELF = { under: 0.18, front: 0.13 };
const MATTRESS_TOP = 0.615;
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
  private lampGlow!: { value: number };
  private lampShade!: THREE.MeshStandardMaterial;
  private dockGlow!: { value: number };
  private lampFull = 0;
  private dockFull = 0;
  private cove!: THREE.Mesh;
  private ledGlow!: THREE.Mesh;
  private readonly leds: THREE.PointLight[] = [];
  private hologram!: Panel;
  private beam!: THREE.Mesh;
  private holoShown = 0;
  private holoTarget = 0;
  private alert = false;
  private ping!: ReturnType<typeof buildPing>;
  private pingOn = false;
  private pingShown = 0;
  private callShown = 0;
  private callTarget = 0;
  private rain!: THREE.Mesh;
  private dust!: Motes;
  private holoDesk!: { group: THREE.Group; update(time: number): void };
  private readonly clock = { value: 0 };
  private readonly lightDirection = new THREE.Vector3();

  constructor() {
    super();
    this.near = 0.05;
    this.far = 1200;
    Object.assign(this.look, makeLook({
      exposure: 1.0, bloom: 0.07, ao: 1.0, saturation: 0.65, contrast: 0.2, vignette: 0.38, grain: 0.016, chroma: 0.004, dof: 0.75, streak: 0.3,
      shadowTint: new THREE.Color(0.0, 0.006, 0.02), highlightTint: new THREE.Color(0, 0, 0),
    }));
    this.clearColor.set(0x0b0d16);
    this.shafts = { direction: this.lightDirection, skyFrom: 5.6 };
  }

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene;
    const rng = new Rng(1207);
    scene.environment = bakeRoomEnvironment(ctx.renderer);
    scene.environmentIntensity = 0.18;

    this.city = buildCityscape(rng.fork(), ctx.quality.density);
    this.city.group.position.set(0.4, -34, -D);
    scene.add(this.city.group);
    await ctx.step('bedroom: city');

    const floor = floorOf(await ctx.assets.picture('floor-bedroom'), W * 2, D * 2, 2.3, 0.55);
    (floor.material as THREE.MeshStandardMaterial).color.setRGB(0.4, 0.34, 0.31);
    scene.add(floor);

    const b = new Builder();
    const wall = 0x46526e, trim = 0xc9cfdc, wallWarm = 0x4a5572;
    const WX0 = -1.15, WX1 = 2.0, WY0 = 0.98, WY1 = 2.34;
    b.box('matte', wall, [W + WX0, H, 0.14], [(-W + WX0) / 2, H / 2, -D - 0.07]);
    b.box('matte', wall, [W - WX1, H, 0.14], [(W + WX1) / 2, H / 2, -D - 0.07]);
    b.box('matte', wall, [WX1 - WX0, WY0, 0.14], [(WX0 + WX1) / 2, WY0 / 2, -D - 0.07]);
    b.box('matte', wall, [WX1 - WX0, H - WY1, 0.14], [(WX0 + WX1) / 2, (H + WY1) / 2, -D - 0.07]);
    b.box('matte', wallWarm, [0.14, H, D * 2], [-W - 0.07, H / 2, 0]);
    b.box('matte', wall, [0.14, H, D * 2], [W + 0.07, H / 2, 0]);
    b.box('matte', wall, [W * 2, H, 0.14], [0, H / 2, D + 0.07]);
    b.box('matte', 0x868da0, [W * 2 + 0.3, 0.12, D * 2 + 0.3], [0, H + 0.06, 0]);
    for (const [sx, sz, len, rot] of [[0, -D + 0.012, W * 2, 0], [0, D - 0.012, W * 2, 0], [-W + 0.012, 0, D * 2, Math.PI / 2], [W - 0.012, 0, D * 2, Math.PI / 2]] as const) {
      b.box('satin', trim, [len, 0.09, 0.022], [sx, 0.045, sz], { rot: [0, rot, 0] });
    }
    b.box('satin', trim, [WX1 - WX0 + 0.16, 0.05, 0.3], [(WX0 + WX1) / 2, WY0 - 0.025, -D + 0.08], { r: 0.012 });
    const frame = [v3(WX0, WY0, 0), v3(WX1, WY0, 0), v3(WX1, WY1, 0), v3(WX0, WY1, 0), v3(WX0, WY0, 0)];
    b.add('metal', 0x2b2f3d, place(sweep(frame, () => 0.035, { radial: 6, polyline: true, steps: 4, startCap: 'flat', endCap: 'flat' }), [0, 0, -D - 0.01]));
    b.box('metal', 0x2b2f3d, [0.04, WY1 - WY0, 0.04], [0.7, (WY0 + WY1) / 2, -D - 0.01]);
    b.finish(scene);
    await ctx.step('bedroom: shell');

    const deskTop = (await sizeOf(ctx, 'study-desk'))[1];
    const [bedWide, , bedLong] = await sizeOf(ctx, 'bed');
    const bx = -W + bedWide / 2 + 0.02, bz = -D + bedLong / 2 + 0.05;
    await dress(ctx, scene, 'bed', [[bx, 0, bz]]);
    const bedside = buildBedside(LAMP.x, LAMP.z);
    scene.add(bedside.group);
    this.lampShade = bedside.shade;
    this.lampGlow = { value: 1.6 };
    this.lampFull = this.lampGlow.value;
    scene.add(buildDesk());
    scene.add(buildPodChair(CHAIR.x, CHAIR.z, 30));
    this.holoDesk = buildHoloStation(1.25, deskTop, -2.22);
    scene.add(this.holoDesk.group);
    scene.add(buildOrb(2.02, deskTop, -1.62));
    scene.add(buildBookStack(0.68, deskTop, -2.38, -8));
    await dress(ctx, scene, 'slate', [[DESK.x - 0.2, deskTop, DESK.z + 0.1, 12]]);
    this.dockGlow = glowOf(await dress(ctx, scene, 'dock', [[BEDROOM.dock.x, deskTop, BEDROOM.dock.z]]));
    this.dockFull = this.dockGlow.value;
    await dress(ctx, scene, 'plant-small', [[DESK.x - 0.62, deskTop, DESK.z - 0.2, 40, 1.15], [1.7, WY0, -D + 0.1, 200, 1.4]]);
    const sx = W - 0.16;
    scene.add(buildShelf(1.02, -0.72, 'lower'), buildShelf(1.6, -0.3, 'upper'));
    await dress(ctx, scene, 'wardrobe', [[WARDROBE.x, 0, WARDROBE.z, 180]]);
    await dress(ctx, scene, 'beanbag', [[BEANBAG.x, 0, BEANBAG.z, -40]]);
    await dress(ctx, scene, 'backpack', [[BAG.x, 0, BAG.z, 35]]);
    await dress(ctx, scene, 'door', [[-1.2, 0, D - 0.07, 180]]);
    const board = buildRoutineBoard(1.25, H * 0.65);
    board.position.set(-W + 0.002, H / 2, 1.2);
    board.rotation.y = Math.PI / 2;
    scene.add(board);
    this.ping = buildPing(1.12, 0.3);
    this.ping.mesh.position.set(0, (H * 0.65) / 2 - 0.26, 0.034);
    board.add(this.ping.mesh);
    scene.add(buildBottle(0.42, deskTop, -2.46));
    scene.add(buildBook(bx + 0.08, MATTRESS_TOP, bz + 0.38, 28));
    await ctx.step('bedroom: furniture');

    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.15, 64), new THREE.MeshStandardMaterial({ map: (await ctx.assets.picture('rug')).map, roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.25, 0.006, 0.35);
    rug.receiveShadow = true;
    scene.add(rug);

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
    scene.add(welcome);

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
    this.rain = new THREE.Mesh(new THREE.PlaneGeometry(WX1 - WX0, WY1 - WY0), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
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

    this.skyFill = new THREE.HemisphereLight(0x7f8fd0, 0x3a3040, 0.5);
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.5);
    this.sun.position.set(-2.2, 3.4, -9);
    this.sun.target.position.set(0.6, 0.6, 0.6);
    this.sun.castShadow = ctx.quality.shadows;
    this.sun.shadow.mapSize.set(ctx.quality.shadowMapSize, ctx.quality.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 1; sc.far = 22;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 6;
    this.lamp = new THREE.PointLight(SCONCE_COLOR, 2.6, 6.5, 1.7);
    this.lamp.position.set(LAMP.x, 0.86, LAMP.z + 0.04);
    const lampGlow = makeHalo(0xfff1e0, 1.5, 0.3);
    lampGlow.position.set(LAMP.x, 0.82, LAMP.z);
    this.cove = new THREE.Mesh(new THREE.BoxGeometry(WX1 - WX0, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.72, 1.0).multiplyScalar(1.8) }));
    this.cove.position.set((WX0 + WX1) / 2, WY1 + 0.14, -D + 0.05);
    const coveLight = new THREE.PointLight(0x8fb0ff, 0.9, 5, 2);
    coveLight.position.set(0.6, 2.3, -2.2);
    scene.add(this.skyFill, this.sun, this.sun.target, this.lamp, lampGlow, this.cove, coveLight);

    const fx = new Builder();
    const SCONCE_R = 0.14;
    const sconces: { at: [number, number, number]; out: [number, number] }[] = [
      { at: [W, 1.78, -1.91], out: [-1, 0] },
      { at: [-W + bedWide / 2 + 0.02, 1.62, -D], out: [0, 1] },
    ];
    for (const { at, out } of sconces) {
      const phiStart = out[0] < 0 ? -Math.PI / 2 : 0;
      const bowl = new THREE.SphereGeometry(SCONCE_R, 32, 12, phiStart, Math.PI, Math.PI / 2, Math.PI / 2);
      bowl.deleteAttribute('uv');
      fx.add('glow', 0x9c8a72, place(bowl, at));
      const cut = new THREE.CircleGeometry(SCONCE_R, 32, out[0] < 0 ? Math.PI / 2 : Math.PI, Math.PI).rotateX(-Math.PI / 2);
      cut.deleteAttribute('uv');
      fx.add('glow', 0xffffff, place(cut, [at[0], at[1] + 0.001, at[2]]));
      const up = new THREE.PointLight(SCONCE_COLOR, 1.2, 4, 1.8);
      up.position.set(at[0] + out[0] * 0.12, at[1] + 0.2, at[2] + out[1] * 0.12);
      const down = new THREE.PointLight(SCONCE_COLOR, 0.35, 3, 2);
      down.position.set(at[0] + out[0] * 0.3, at[1] - 0.15, at[2] + out[1] * 0.3);
      scene.add(up, down);
    }
    fx.finish(scene, { glow: 2.4, shadows: false });
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
    for (const [y, z] of [[1.02, -0.72], [1.6, -0.3]] as const) strip([0.008, 0.005, 1.12], [W - 0.16 - SHELF.front, y + SHELF.under - 0.003, z], [W - 0.2, y + SHELF.under - 0.12, z], 0.3, 1.3);
    {
      const wide = 1.25 + 0.016, tall = H * 0.65 + 0.016, cy = H / 2, cz = 1.2, gap = 0.022, t = 0.008, x = -W + 0.006;
      const outerZ = wide / 2 + gap + t / 2, outerY = tall / 2 + gap + t / 2, spanZ = wide + 2 * (gap + t), spanY = tall + 2 * gap;
      strips.box('glow', LED_COLOR, [0.008, t, spanZ], [x, cy + outerY, cz]);
      strips.box('glow', LED_COLOR, [0.008, t, spanZ], [x, cy - outerY, cz]);
      strips.box('glow', LED_COLOR, [0.008, spanY, t], [x, cy, cz + outerZ]);
      strips.box('glow', LED_COLOR, [0.008, spanY, t], [x, cy, cz - outerZ]);
      const halo = new THREE.PointLight(LED_COLOR, 0.35, 1.8, 2);
      halo.position.set(-W + 0.25, cy, cz);
      halo.userData.power = 0.35;
      this.leds.push(halo);
      scene.add(halo);
    }
    strips.box('glow', LED_COLOR, [W - TOP.retDeep - TOP.bend - TOP.start - 0.06, 0.008, 0.006], [(TOP.start + W - TOP.retDeep - TOP.bend) / 2, TOP.y - TOP.slab - 0.004, -D + TOP.deep + 0.002]);
    this.ledGlow = strips.finish(scene, { glow: 2.2, shadows: false }).glow!;

    this.dust = buildMotes(Math.round(60 * ctx.quality.density), v3(LAMP.x + 0.3, 0.4, LAMP.z + 0.5), v3(1.0, 1.1, 0.9), rng.fork(), this.clock, { a: 0xe8ecf2, b: 0xf4f6fa, size: 0.015, gain: 0.7 });
    scene.add(this.dust.points);

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
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uShow; varying vec2 vUv; void main(){ gl_FragColor = vec4(vec3(0.35, 0.65, 1.0) * (1.0 - vUv.y) * 0.5 * uShow, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }));
    this.beam.position.copy(BEDROOM.phone).add(v3(0, 0.01, 0));
    scene.add(this.beam);

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

  setNight(k: number, immediate = false): void {
    this.nightTarget = k;
    if (immediate) {
      this.night = k;
      this.applyNight();
    }
  }

  private applyNight(): void {
    const n = this.night;
    this.city.setNight(0.75 + 0.25 * n);
    this.city.setOvercast(0.55);
    this.sun.intensity = 0.16;
    this.sun.color.setRGB(0.62, 0.7, 0.95);
    this.skyFill.intensity = 0.14;
    for (const led of this.leds) led.intensity = (led.userData.power as number) * (0.5 + 0.5 * n);
    (this.ledGlow.material as THREE.MeshBasicMaterial).color.setScalar(1.2 + 1.0 * n);
    this.skyFill.color.setRGB(0.5, 0.56, 0.74);
    this.lamp.intensity = 0.3 + 1.9 * n;
    this.lampGlow.value = this.lampFull * (0.2 + 0.8 * n);
    (this.cove.material as THREE.MeshBasicMaterial).color.setRGB(0.8, 0.84, 0.92).multiplyScalar(0.3 + 0.5 * n);
    (this.rain.material as THREE.ShaderMaterial).uniforms.uAmount!.value = n * 0.6;
    this.look.exposure = 0.66 + 0.05 * n;
    this.lightDirection.copy(SUN_DIRECTION).lerp(CITY_GLOW, 0.5).normalize();
    this.look.shafts = 0.04;
    this.look.shaftColor.setRGB(0.6, 0.7, 0.95);
    this.scene.environmentIntensity = 0.08;
  }

  override reset(): void {
    this.setAlert(false);
    this.setMessages(null);
    this.setCall(false);
  }

  setAlert(on: boolean): void {
    this.alert = on;
  }

  setPing(message: { from: string; text: string } | null): void {
    this.pingOn = !!message;
    if (message) this.ping.paint(message.from, message.text);
  }

  setMessages(messages: readonly ChatMessage[] | null, footer?: { left: string; right: string } | null): void {
    if (!messages) {
      this.holoTarget = 0;
      return;
    }
    this.holoTarget = 1;
    const theme = THEMES.real;
    this.hologram.paint((ctx, w, h) => {
      glass(ctx, 24, 24, w - 48, h - 48, theme, { radius: 34, glow: 1.6, borderWidth: 2.5, border: 'rgba(160, 205, 255, 0.75)' });
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
    this.holoDesk.update(time);
    this.lampShade.emissiveIntensity = this.lampGlow.value;
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
    this.pingShown = damp(this.pingShown, this.pingOn ? 1 : 0, 6, dt);
    this.ping.mesh.visible = this.pingShown > 0.01;
    this.ping.material.opacity = this.pingShown * (0.82 + 0.18 * Math.sin(time * 4));
    this.ping.mesh.scale.setScalar(0.9 + 0.1 * this.pingShown);
    const jamie = this.cast.jamie!;
    if (jamie.root.visible) {
      jamie.root.scale.setScalar(0.34 * Math.max(0.001, this.callShown));
      if (this.callShown < 0.01 && this.callTarget === 0) jamie.root.visible = false;
    }
    const callLight = this.scene.getObjectByName('callLight') as THREE.PointLight;
    callLight.intensity = this.callShown * 1.2;
  }
}

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

const buildDesk = (): THREE.Group => {
  const group = new THREE.Group();
  const { y, slab, deep, start, ret, retDeep, bend, end } = TOP;
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
  b.box('satin', STEEL_WHITE, [W - start - 0.04, 0.05, 0.02], [(start + W) / 2, below - 0.025, -D + 0.01], { r: 0.004 });
  b.box('satin', STEEL_WHITE, [0.02, 0.05, ret - 0.04], [W - 0.01, below - 0.025, -D + ret / 2], { r: 0.004 });
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

const buildPing = (wide: number, tall: number): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; paint: (from: string, text: string) => void } => {
  const px = 900, py = Math.round((px * tall) / wide);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = py;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wide, tall), material);
  mesh.visible = false;
  mesh.renderOrder = 2;
  const paint = (from: string, text: string): void => {
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, px, py);
    c.fillStyle = 'rgba(14, 26, 48, 0.96)';
    roundRect(c, 6, 6, px - 12, py - 12, 40);
    c.fill();
    c.strokeStyle = '#8feaff';
    c.lineWidth = 5;
    c.stroke();
    const cy = py / 2;
    c.fillStyle = '#8feaff';
    c.beginPath(); c.arc(78, cy, 34, 0, TAU); c.fill();
    c.fillStyle = '#0e1a30';
    c.font = font(700, 36);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(from.slice(0, 1), 78, cy + 2);
    c.textAlign = 'left';
    c.fillStyle = '#8feaff';
    c.font = font(700, 30);
    c.fillText(from, 136, cy - 36);
    c.fillStyle = '#ffffff';
    c.font = font(500, 34);
    wrap(c, text, px - 170).slice(0, 2).forEach((line, i) => c.fillText(line, 136, cy + 8 + i * 40));
    texture.needsUpdate = true;
  };
  return { mesh, material, paint };
};

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

const buildPodChair = (x: number, z: number, yawDeg: number): THREE.Group => {
  const group = new THREE.Group();
  const y0 = 0.3, back = 0.58, front = 0.12;
  const tallAt = (a: number): number => {
    const b = (1 - Math.cos(a)) / 2;
    return front + (back - front) * b ** 2.8;
  };
  const radiusAt = (y: number): number => {
    const k = Math.min(1, (y - y0) / 0.3);
    const taper = y - y0 > 0.26 ? 0.13 * ((y - y0 - 0.26) / 0.32) ** 1.6 : 0;
    return 0.17 + 0.22 * Math.sin((k * Math.PI) / 2) - taper;
  };
  const point = (a: number, v: number, out = 0): THREE.Vector3 => {
    const y = y0 + v * tallAt(a), r = radiusAt(y) + out;
    return new THREE.Vector3(r * Math.sin(a), y, r * Math.cos(a) * 1.04);
  };
  const NU = 96, NV = 22;
  const pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) pos.push(...point((i / NU) * TAU, j / NV).toArray());
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b2 = a + NU + 1;
    idx.push(a, a + 1, b2, a + 1, b2 + 1, b2);
  }
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shellGeo.setIndex(idx);
  shellGeo.computeVertexNormals();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xd2d1d4, roughness: 0.4, metalness: 0.04, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(radiusAt(y0) + 0.002, 48).rotateX(-Math.PI / 2), shellMat);
  floor.position.y = y0 + 0.001;
  const loop = (v: number, out: number): THREE.CatmullRomCurve3 => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i++) pts.push(point((i / 64) * TAU, v, out));
    return new THREE.CatmullRomCurve3(pts, true);
  };
  const lip = new THREE.Mesh(new THREE.TubeGeometry(loop(1, 0), 200, 0.013, 10, true), shellMat);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(SCONCE_COLOR).multiplyScalar(2.4) });
  const seam = new THREE.Mesh(new THREE.TubeGeometry(loop(0.72, 0.004), 200, 0.0045, 6, true), glowMat);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x7d8598, roughness: 0.88 });
  const padR = radiusAt(0.44) - 0.04;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(padR, padR, 0.07, 48), padMat);
  const roll = new THREE.Mesh(new THREE.TorusGeometry(padR, 0.035, 12, 64), padMat);
  roll.rotation.x = Math.PI / 2;
  pad.position.y = roll.position.y = 0.45;
  pad.position.z = roll.position.z = 0.01;
  group.add(shell, floor, lip, seam, pad, roll);
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bcc3, roughness: 0.3, metalness: 0.55 });
  const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(0.25, 0), new THREE.Vector2(0.25, 0.018), new THREE.Vector2(0.19, 0.028),
    new THREE.Vector2(0.085, 0.07), new THREE.Vector2(0.042, 0.14), new THREE.Vector2(0.034, 0.26), new THREE.Vector2(0.07, 0.3), new THREE.Vector2(0, 0.3)];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 48), steel));
  group.traverse((o) => { if (o instanceof THREE.Mesh && o.material !== glowMat) o.castShadow = o.receiveShadow = true; });
  group.position.set(x, 0, z);
  group.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  return group;
};

const buildBedside = (x: number, z: number): { group: THREE.Group; shade: THREE.MeshStandardMaterial } => {
  const group = new THREE.Group();
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf1f2f5, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const topY = 0.52, R = 0.23;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R - 0.01, 0.035, 64), white);
  top.position.y = topY - 0.0175;
  const edge = new THREE.Mesh(new THREE.TorusGeometry(R - 0.004, 0.0175, 10, 64), white);
  edge.rotation.x = Math.PI / 2;
  edge.position.y = topY - 0.0175;
  const shelf = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 0.02, 64), white);
  shelf.position.y = 0.22;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, topY - 0.04, 24), white);
  stem.position.y = (topY - 0.04) / 2 + 0.02;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.02, 48), white);
  foot.position.y = 0.01;
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(SCONCE_COLOR).multiplyScalar(2) });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 0.035, 0.004, 6, 64), glowMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = topY - 0.04;
  const base = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 20), white);
  base.scale.set(1, 0.85, 1);
  base.position.y = topY + 0.064;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xc9a77a, roughness: 0.3, metalness: 0.8 }));
  neck.position.y = topY + 0.18;
  const shade = new THREE.MeshStandardMaterial({ color: 0xfff1df, emissive: 0xfff1e0, emissiveIntensity: 1.6, roughness: 0.8, side: THREE.DoubleSide });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.15, 48, 1, true), shade);
  drum.position.y = topY + 0.29;
  const books = buildBookStack(0, 0.23, 0, 20);
  books.scale.setScalar(0.8);
  group.add(top, edge, shelf, stem, foot, ring, base, neck, drum, books);
  group.traverse((o) => { if (o instanceof THREE.Mesh && o.material !== glowMat && o.material !== shade) o.castShadow = o.receiveShadow = true; });
  group.position.set(x, 0, z);
  return { group, shade };
};

const buildAstronaut = (): THREE.Group => {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0xf2f3f6, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.04, 6, 16), suit);
  body.position.y = 0.07;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 16), suit);
  head.position.y = 0.14;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0x1a2236, roughness: 0.05, metalness: 0.3, clearcoat: 1 }));
  visor.scale.set(1, 0.8, 0.6);
  visor.position.set(0, 0.142, 0.026);
  const pack = new THREE.Mesh(roundBox(0.05, 0.06, 0.03, 0.008, 2), suit);
  pack.position.set(0, 0.08, -0.035);
  g.add(body, head, visor, pack);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.035, 4, 10), suit);
    arm.position.set(side * 0.042, 0.075, 0.004);
    arm.rotation.z = side * 0.35;
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.025, 4, 10), suit);
    leg.position.set(side * 0.016, 0.022, 0);
    g.add(arm, leg);
  }
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
};

const buildGlassPlanet = (): THREE.Group => {
  const g = new THREE.Group();
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.04, 32), new THREE.MeshStandardMaterial({ map: oakGrain(), roughness: 0.5 }));
  foot.position.y = 0.02;
  const glassBall = new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 20), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.22, clearcoat: 1, depthWrite: false }));
  glassBall.position.y = 0.11;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), new THREE.MeshStandardMaterial({ color: 0xbfd2ff, emissive: 0x6f8fe0, emissiveIntensity: 0.8, roughness: 0.4 }));
  planet.position.y = 0.11;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.004, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(SCONCE_COLOR).multiplyScalar(2.6) }));
  ring.position.y = 0.11;
  ring.rotation.set(Math.PI / 2 - 0.3, 0.2, 0);
  const halo = makeHalo(0xfff1e0, 0.28, 0.35);
  halo.position.y = 0.11;
  g.add(foot, glassBall, planet, ring, halo);
  return g;
};

const buildShelf = (y: number, z: number, which: 'lower' | 'upper'): THREE.Group => {
  const group = new THREE.Group();
  const top = y + SHELF.under + 0.03, len = 1.14, deep = 0.28;
  const plank = new THREE.Mesh(roundBox(deep, 0.03, len, 0.006, 2), new THREE.MeshStandardMaterial({ map: oakGrain(), roughness: 0.5 }));
  plank.position.set(W - deep / 2, top - 0.015, z);
  group.add(plank);
  const bracketMat = new THREE.MeshStandardMaterial({ color: STEEL_WHITE, roughness: 0.35 });
  for (const dz of [-0.4, 0.4]) {
    const arm = new THREE.Mesh(roundBox(deep - 0.04, 0.018, 0.02, 0.004, 1), bracketMat);
    arm.position.set(W - (deep - 0.04) / 2, top - 0.039, z + dz);
    const post = new THREE.Mesh(roundBox(0.018, 0.12, 0.02, 0.004, 1), bracketMat);
    post.position.set(W - 0.009, top - 0.09, z + dz);
    group.add(arm, post);
  }
  const covers = [0xeef0f4, 0x2c313c, 0x2b3b5e, 0xb9bfca, 0xeef0f4, 0x3a4458, 0xdfe3ea, 0x2c313c];
  const lines = [0x8fc4ff, 0xffc890];
  const rng = new Rng(which === 'lower' ? 41 : 77);
  let at = z - len / 2 + 0.06;
  const row = which === 'lower' ? 7 : 8;
  for (let i = 0; i < row; i++) {
    const thick = 0.022 + rng.next() * 0.018, tall = 0.19 + rng.next() * 0.07, d = 0.15 + rng.next() * 0.03;
    const color = covers[(i + (which === 'upper' ? 3 : 0)) % covers.length]!;
    const book = new THREE.Mesh(roundBox(d, tall, thick, 0.003, 1), new THREE.MeshStandardMaterial({ color, roughness: color === 0xb9bfca ? 0.3 : 0.55, metalness: color === 0xb9bfca ? 0.6 : 0 }));
    const lean = i === row - 1 ? 0.2 : 0;
    book.position.set(W - 0.04 - d / 2, top + tall / 2, at + thick / 2);
    book.rotation.x = lean;
    book.castShadow = book.receiveShadow = true;
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.001, tall * 0.55, 0.003), new THREE.MeshBasicMaterial({ color: new THREE.Color(lines[i % 2]!).multiplyScalar(1.8) }));
    line.position.set(W - 0.04 - d - 0.0006, top + tall * 0.5, at + thick / 2);
    line.rotation.x = lean;
    group.add(book, line);
    at += thick + 0.003 + (lean ? 0.03 : 0);
  }
  const stack = buildBookStack(W - 0.14, top, at + 0.12, 90);
  group.add(stack);
  if (which === 'lower') {
    const astro = buildAstronaut();
    astro.position.set(W - 0.15, top, z + 0.2);
    astro.rotation.y = -Math.PI / 2 + 0.4;
    const globe = buildGlassPlanet();
    globe.position.set(W - 0.15, top, z + 0.44);
    group.add(astro, globe);
  } else {
    const dome = buildGlassPlanet();
    dome.position.set(W - 0.15, top, z + 0.45);
    group.add(dome);
  }
  return group;
};

const holoCard = (wide: number, tall: number, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Mesh => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * tall) / wide);
  const c = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  const fill = c.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, 'rgba(120, 170, 255, 0.22)');
  fill.addColorStop(1, 'rgba(70, 120, 230, 0.1)');
  c.fillStyle = fill;
  roundRect(c, 6, 6, w - 12, h - 12, 26);
  c.fill();
  c.strokeStyle = 'rgba(190, 220, 255, 0.95)';
  c.lineWidth = 5;
  c.stroke();
  c.strokeStyle = c.fillStyle = 'rgba(205, 228, 255, 0.95)';
  paint(c, w, h);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wide, tall), new THREE.MeshBasicMaterial({
    map, color: new THREE.Color(1.3, 1.45, 1.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  }));
  mesh.renderOrder = 3;
  return mesh;
};

const buildHoloStation = (x: number, y: number, z: number): { group: THREE.Group; update(time: number): void } => {
  const group = new THREE.Group();
  const puckMat = new THREE.MeshStandardMaterial({ color: 0x2a3142, roughness: 0.35, metalness: 0.5 });
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.024, 48), puckMat);
  puck.position.y = 0.012;
  puck.castShadow = puck.receiveShadow = true;
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.75, 1.0).multiplyScalar(2.6) });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.006, 8, 64), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.025;
  group.add(puck, ring);
  const beamGeo = new THREE.CylinderGeometry(0.3, 0.09, 0.27, 32, 1, true);
  beamGeo.translate(0, 0.16, 0);
  const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; void main(){ gl_FragColor = vec4(vec3(0.35, 0.62, 1.0) * (1.0 - vUv.y) * 0.35, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  }));
  group.add(beam);

  const float = new THREE.Group();
  float.position.y = 0.52;
  group.add(float);
  const screen = holoCard(0.82, 0.46, (c, w, h) => {
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(40, 52); c.lineTo(150, 52); c.stroke();
    c.beginPath(); c.arc(40, 52, 9, 0, TAU); c.stroke();
    for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(w - 50 - i * 30, 50, 8, 0, TAU); c.fill(); }
    c.globalAlpha = 0.35;
    roundRect(c, 40, h - 70, w - 80, 30, 14);
    c.stroke();
    c.globalAlpha = 1;
  });
  const chart = holoCard(0.26, 0.19, (c, w, h) => {
    c.lineWidth = 5;
    c.beginPath(); c.moveTo(40, 40); c.lineTo(110, 40); c.stroke();
    c.globalAlpha = 0.5;
    c.beginPath(); c.moveTo(40, h - 40);
    for (let i = 0; i <= 40; i++) { const t = i / 40; c.lineTo(40 + t * (w - 80), h - 50 - (Math.sin(t * 7) * 0.3 + 0.5 + t * 0.3) * (h - 140)); }
    c.lineTo(w - 40, h - 40); c.closePath(); c.fill();
    c.globalAlpha = 1;
  });
  const list = holoCard(0.26, 0.23, (c, w) => {
    c.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      const yy = 70 + i * 82;
      c.strokeRect(40, yy - 20, 40, 40);
      if (i < 3) { c.beginPath(); c.moveTo(48, yy); c.lineTo(58, yy + 12); c.lineTo(74, yy - 12); c.stroke(); }
      c.globalAlpha = 0.6; c.fillRect(110, yy - 6, w - 160 - (i % 2) * 90, 12); c.globalAlpha = 1;
    }
  });
  chart.position.set(-0.57, -0.05, 0.06);
  chart.rotation.y = 0.35;
  list.position.set(0.57, -0.03, 0.06);
  list.rotation.y = -0.35;
  float.add(screen, chart, list);
  const planet = new THREE.Group();
  planet.position.set(0, -0.01, 0.05);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 40, 24), new THREE.MeshPhysicalMaterial({
    color: 0x9cc4ff, emissive: 0x3d6fd6, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.85, clearcoat: 1,
  }));
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.005, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.6).multiplyScalar(2.4) }));
  band.rotation.set(Math.PI / 2 - 0.35, 0.25, 0);
  planet.add(globe, band);
  float.add(planet);
  const light = new THREE.PointLight(0x7fb0ff, 0.9, 1.8, 2);
  light.position.set(0, 0.42, 0.2);
  group.add(light);
  group.position.set(x, y, z);
  group.rotation.y = -0.22;
  return {
    group,
    update(time) {
      float.position.y = 0.52 + Math.sin(time * 1.1) * 0.006;
      globe.rotation.y = time * 0.4;
      band.rotation.z = time * 0.15;
      (ringMat.color as THREE.Color).setRGB(0.45, 0.75, 1.0).multiplyScalar(2.2 + 0.5 * Math.sin(time * 2));
    },
  };
};

const buildOrb = (x: number, y: number, z: number): THREE.Group => {
  const group = new THREE.Group();
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 32), new THREE.MeshStandardMaterial({ map: oakGrain(), roughness: 0.5 }));
  foot.position.y = 0.015;
  const glassBall = new THREE.Mesh(new THREE.SphereGeometry(0.075, 40, 24), new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.05, transmission: 0.9, thickness: 0.02, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false,
  }));
  glassBall.position.y = 0.1;
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(SCONCE_COLOR).multiplyScalar(3) }));
  core.position.y = 0.09;
  const halo = makeHalo(SCONCE_COLOR, 0.32, 0.5);
  halo.position.y = 0.1;
  const light = new THREE.PointLight(SCONCE_COLOR, 0.5, 1.4, 2);
  light.position.y = 0.12;
  group.add(foot, glassBall, core, halo, light);
  group.position.set(x, y, z);
  return group;
};

const buildBookStack = (x: number, y: number, z: number, yawDeg: number): THREE.Group => {
  const group = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.9 });
  let h = 0;
  for (const [w, d, t, color, turn] of [[0.24, 0.17, 0.035, 0x3e4e6e, 0], [0.21, 0.15, 0.03, 0x6c7a96, 0.12]] as const) {
    const cover = new THREE.Mesh(roundBox(w, t, d, 0.004, 2), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(w - 0.012, t - 0.008, d - 0.006), paper);
    for (const m of [cover, pages]) { m.position.set(0.004, h + t / 2, 0); m.rotation.y = turn; m.castShadow = m.receiveShadow = true; }
    pages.position.x += 0.006;
    group.add(cover, pages);
    h += t;
  }
  group.position.set(x, y, z);
  group.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  return group;
};
