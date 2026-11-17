import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST } from '../../characters/cast';
import { place, sweep, v3 } from '../../core/geo';
import { Rng, TAU, damp } from '../../core/math';
import { makeLook } from '../../render/PostPipeline';
import { bakeRoomEnvironment } from '../../render/env';
import { Panel } from '../../ui/Panel';
import { THEMES, font, glass, roundRect, wrap } from '../../ui/draw';
import { World, anchor, type Anchor, type BuildContext, type FrameContext } from '../World';
import { dress, floorOf, framed, glowOf, sizeOf, type Spot } from '../dressing';
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
/** Toward the afternoon sun, and toward the middle of the city's glow at night: both beyond the window. */
const SUN_DIRECTION = new THREE.Vector3(-0.28, 0.28, -0.96).normalize(), CITY_GLOW = new THREE.Vector3(0.12, 0.16, -1).normalize();
/** Boxes still taped shut: they moved here not long ago. */
const BOXES: readonly Spot[] = [[0.72, 0, 2.2, 14], [0.75, 0.44, 2.22, -20, 0.82], [0.12, 0, 2.26, -8, 0.9]];

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
    scene.add(floor);

    const b = new Builder();
    const wall = 0x5d6884, trim = 0xdfe3ee, wallWarm = 0x77627c;
    const WX0 = -1.15, WX1 = 2.0, WY0 = 0.98, WY1 = 2.34; // window opening
    b.box('matte', wall, [W + WX0, H, 0.14], [(-W + WX0) / 2, H / 2, -D - 0.07]);
    b.box('matte', wall, [W - WX1, H, 0.14], [(W + WX1) / 2, H / 2, -D - 0.07]);
    b.box('matte', wall, [WX1 - WX0, WY0, 0.14], [(WX0 + WX1) / 2, WY0 / 2, -D - 0.07]);
    b.box('matte', wall, [WX1 - WX0, H - WY1, 0.14], [(WX0 + WX1) / 2, (H + WY1) / 2, -D - 0.07]);
    b.box('matte', wallWarm, [0.14, H, D * 2], [-W - 0.07, H / 2, 0]);
    b.box('matte', wall, [0.14, H, D * 2], [W + 0.07, H / 2, 0]);
    b.box('matte', wall, [W * 2, H, 0.14], [0, H / 2, D + 0.07]);
    b.box('matte', 0xe6e8f0, [W * 2 + 0.3, 0.12, D * 2 + 0.3], [0, H + 0.06, 0]);
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
    await dress(ctx, scene, 'study-desk', [[DESK.x, 0, DESK.z]]);
    await dress(ctx, scene, 'desk-chair', [[CHAIR.x, 0, CHAIR.z, 205]]);
    await dress(ctx, scene, 'monitor', [[DESK.x + 0.58, deskTop, DESK.z - 0.14, -20]]);
    await dress(ctx, scene, 'slate', [[DESK.x - 0.2, deskTop, DESK.z + 0.1, 12]]);
    this.dockGlow = glowOf(await dress(ctx, scene, 'dock', [[BEDROOM.dock.x, deskTop, BEDROOM.dock.z]]));
    this.dockFull = this.dockGlow.value;
    await dress(ctx, scene, 'plant-small', [[DESK.x - 0.62, deskTop, DESK.z - 0.2, 40, 1.15], [1.7, WY0, -D + 0.1, 200, 1.4]]);
    const sx = W - 0.16;
    await dress(ctx, scene, 'wall-shelf', [[sx, 1.02, -0.72, -90], [sx, 1.6, -0.3, -90]]);
    await dress(ctx, scene, 'wardrobe', [[WARDROBE.x, 0, WARDROBE.z, 180]]);
    await dress(ctx, scene, 'moving-box', BOXES);
    await dress(ctx, scene, 'beanbag', [[BEANBAG.x, 0, BEANBAG.z, -40]]);
    // school bag slumped by the bed
    await dress(ctx, scene, 'backpack', [[BAG.x, 0, BAG.z, 35]]);
    await dress(ctx, scene, 'door', [[-1.2, 0, D - 0.07, 180]]);
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
    this.colliders.box(bx, bz, bedWide / 2, bedLong / 2).box(LAMP.x, LAMP.z, 0.28, 0.28).box(DESK.x, DESK.z, 0.97, 0.38).circle(CHAIR.x, CHAIR.z, 0.3)
      .box(sx, -0.5, 0.16, 0.88).box(WARDROBE.x, WARDROBE.z, 0.57, 0.31).box(0.72, 2.2, 0.26, 0.28).box(0.12, 2.26, 0.22, 0.24)
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
    this.city.setNight(n);
    this.sun.intensity = 3.0 * (1 - n) + 0.3 * n;
    this.sun.color.setRGB(1.0, 0.76 - 0.2 * n, 0.55 + 0.4 * n);
    this.skyFill.intensity = 1.7 * (1 - n) + 0.34 * n;
    this.skyFill.color.setRGB(0.6 - 0.25 * n, 0.66 - 0.2 * n, 0.9);
    this.lamp.intensity = 0.4 + 2.6 * n;
    this.lampGlow.value = this.lampFull * (0.2 + 0.8 * n);
    (this.cove.material as THREE.MeshBasicMaterial).color.setRGB(0.55, 0.72, 1.0).multiplyScalar(0.3 + 1.6 * n);
    (this.rain.material as THREE.ShaderMaterial).uniforms.uAmount!.value = n;
    this.look.exposure = 1.0 + 0.22 * n;
    // by day the low sun comes straight in; at night it is the glow of the city through the rain
    this.lightDirection.copy(SUN_DIRECTION).lerp(CITY_GLOW, n).normalize();
    this.look.shafts = 0.85 * (1 - n) + 0.2 * n;
    this.look.shaftColor.setRGB(1.0 - 0.45 * n, 0.8 - 0.1 * n, 0.55 + 0.45 * n);
    this.scene.environmentIntensity = 0.62 - 0.46 * n;
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

