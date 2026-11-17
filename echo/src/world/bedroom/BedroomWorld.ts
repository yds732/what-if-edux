import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST } from '../../characters/cast';
import { blob, lathe, place, sweep, torus, v3 } from '../../core/geo';
import { Rng, TAU, damp } from '../../core/math';
import { makeLook } from '../../render/PostPipeline';
import { bakeRoomEnvironment } from '../../render/env';
import { Panel } from '../../ui/Panel';
import { THEMES, font, glass, roundRect, spaced, wrap } from '../../ui/draw';
import { World, anchor, type Anchor, type BuildContext, type FrameContext } from '../World';
import { makeHalo } from '../haven/atmosphere';
import { buildCityscape, type Cityscape } from '../cityscape';
import { Builder, canvasTexture, makePoster, plankTexture } from '../interior';
import { buildPhone, type PhoneProp } from '../props';

/** The player's room: 4.6 m wide (x), 5.2 m deep (z). The window and desk are on the -Z wall. */
export const BEDROOM = {
  enter: anchor(0.35, 0, 1.3, 0),
  /** Standing at the desk. */
  desk: anchor(0.55, 0, -1.2, 0),
  /** Where the headset rests, on its dock. */
  dock: new THREE.Vector3(0.12, 0.79, -2.08),
  phone: new THREE.Vector3(0.95, 0.752, -1.98),
  /** Centre of the hologram the phone projects. */
  hologram: new THREE.Vector3(0.95, 1.26, -2.06),
} as const satisfies Record<string, Anchor | THREE.Vector3>;

export interface ChatMessage {
  readonly from: 'jamie' | 'you' | 'system';
  readonly text: string;
}

const W = 2.3, D = 2.6, H = 2.7;

export class BedroomWorld extends World {
  readonly id = 'bedroom';
  readonly theme = 'real' as const;
  readonly phone: PhoneProp = buildPhone();
  private city!: Cityscape;
  private night = 1;
  private nightTarget = 1;
  private sun!: THREE.DirectionalLight;
  private skyFill!: THREE.HemisphereLight;
  private lamp!: THREE.PointLight;
  private lampShade!: THREE.Mesh;
  private cove!: THREE.Mesh;
  private hologram!: Panel;
  private beam!: THREE.Mesh;
  private holoShown = 0;
  private holoTarget = 0;
  private alert = false;
  private callShown = 0;
  private callTarget = 0;
  private dockRing!: THREE.Mesh;
  private rain!: THREE.Mesh;

  constructor() {
    super();
    this.near = 0.05;
    this.far = 1200;
    Object.assign(this.look, makeLook({
      exposure: 1.0, bloom: 0.07, ao: 1.0, saturation: 1.02, contrast: 0.2, vignette: 0.38, grain: 0.016, chroma: 0.004,
      shadowTint: new THREE.Color(0.0, 0.006, 0.02), highlightTint: new THREE.Color(0.02, 0.008, -0.01),
    }));
    this.clearColor.set(0x0b0d16);
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
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), new THREE.MeshStandardMaterial({ map: plankTexture(0x8a6a52, rng.fork(), [2.4, 2.8]), roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
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
    // door on the back wall, and the light switch beside it
    b.box('satin', 0xcfd3df, [0.92, 2.08, 0.05], [-1.2, 1.04, D - 0.02], { r: 0.012 });
    b.cyl('metal', 0x9aa0b0, 0.022, 0.12, [-0.86, 1.0, D - 0.06], { rot: [Math.PI / 2, 0, 0] });

    // ---- bed, against the warm wall, head to the window ----
    const bx = -1.72;
    b.box('satin', 0x3b4258, [1.08, 0.3, 2.16], [bx, 0.15, -1.42], { r: 0.03 });
    b.box('matte', 0xe9e6e0, [1.0, 0.2, 2.06], [bx, 0.39, -1.42], { r: 0.06 });
    b.box('matte', 0x4d638f, [1.06, 0.14, 1.34], [bx, 0.5, -1.06], { r: 0.06 });
    b.box('matte', 0x6e84ae, [1.06, 0.05, 0.28], [bx, 0.565, -1.62], { r: 0.022 });
    b.box('satin', 0x3b4258, [1.1, 0.78, 0.09], [bx, 0.52, -2.5], { r: 0.03 });
    b.add('matte', 0xf2efe9, place(blob(0.34, 0.09, 0.2, 3), [bx, 0.56, -2.2]));
    // a star plush that came with them from the old house
    b.add('matte', 0xf2c14e, place(blob(0.13, 0.13, 0.06, 3, (p) => { const k = 0.66 + 0.34 * Math.cos(Math.atan2(p.y, p.x) * 5); p.x *= k; p.y *= k; }), [bx + 0.22, 0.62, -2.02], [-1.1, 0.5, 0]));
    // bedside table and lamp
    b.box('satin', 0x8b6f5a, [0.42, 0.46, 0.4], [-0.93, 0.23, -2.34], { r: 0.02 });
    b.cyl('metal', 0x3a3d4c, 0.07, 0.02, [-0.93, 0.46, -2.34]);
    b.cyl('metal', 0x3a3d4c, 0.012, 0.22, [-0.93, 0.48, -2.34]);

    // ---- desk under the window ----
    const dx = 0.8, dz = -2.2, dy = 0.74;
    b.box('satin', 0xa58469, [2.0, 0.04, 0.72], [dx, dy - 0.02, dz], { r: 0.012 });
    b.box('satin', 0x40465c, [0.46, 0.66, 0.6], [dx + 0.72, 0.36, dz], { r: 0.02 });
    for (const y of [0.2, 0.42, 0.62]) b.box('metal', 0x9aa0b0, [0.2, 0.012, 0.012], [dx + 0.72, y, dz + 0.306]);
    b.box('satin', 0x40465c, [0.05, 0.7, 0.6], [dx - 0.95, 0.35, dz]);
    // a dark slate on a stand, asleep
    b.box('gloss', 0x10121a, [0.62, 0.36, 0.014], [dx + 0.42, dy + 0.3, dz - 0.24], { r: 0.006, rot: [-0.14, -0.22, 0] });
    b.cyl('metal', 0x3a3d4c, 0.012, 0.14, [dx + 0.42, dy, dz - 0.25]);
    b.cyl('metal', 0x3a3d4c, 0.09, 0.008, [dx + 0.42, dy, dz - 0.25]);
    b.box('satin', 0x2a2d3a, [0.34, 0.012, 0.12], [dx + 0.36, dy + 0.006, dz + 0.02], { r: 0.005, rot: [0, -0.15, 0] });
    // mug, pen pot, a stack of books
    b.cyl('gloss', 0xd96a4f, 0.038, 0.085, [dx - 0.78, dy, dz - 0.14]);
    b.cyl('satin', 0x7fa08f, 0.035, 0.1, [dx - 0.62, dy, dz - 0.24]);
    for (const [i, c] of [0x6f8fb8, 0xe0b34e, 0xc9694e].entries()) b.box('matte', c, [0.2 - i * 0.012, 0.03, 0.27 - i * 0.012], [dx - 0.36, dy + 0.015 + i * 0.03, dz - 0.2], { rot: [0, 0.2 - i * 0.16, 0], r: 0.004 });
    // the headset's dock: a disc with a ring of light
    b.cyl('gloss', 0xe9ebf2, 0.11, 0.022, [BEDROOM.dock.x, dy, BEDROOM.dock.z]);
    b.cyl('satin', 0xd0d4e0, 0.03, 0.03, [BEDROOM.dock.x, dy + 0.02, BEDROOM.dock.z]);
    // chair
    const cx = 0.62, cz = -1.5;
    b.box('matte', 0xdcdfe8, [0.46, 0.08, 0.44], [cx, 0.46, cz], { r: 0.035 });
    b.box('matte', 0xdcdfe8, [0.44, 0.5, 0.07], [cx, 0.76, cz + 0.2], { r: 0.035, rot: [0.12, 0, 0] });
    b.cyl('metal', 0x8e94a6, 0.022, 0.4, [cx, 0.03, cz]);
    b.cyl('metal', 0x8e94a6, 0.24, 0.025, [cx, 0, cz]);

    // ---- shelves on the right wall: books, a plant, a globe, a photograph ----
    const sx = W - 0.14;
    for (const y of [0.9, 1.35, 1.8]) b.box('satin', 0xa58469, [0.26, 0.03, 1.7], [sx, y, -0.5], { r: 0.008 });
    const bookColors = [0x6f8fb8, 0xc9694e, 0xe0b34e, 0x5e8f72, 0xa98cc4, 0xd9d4c8, 0x40465c];
    for (const y of [0.915, 1.365]) {
      let z = -1.28;
      while (z < (y < 1 ? 0.25 : -0.35)) {
        const t = rng.range(0.022, 0.05), h = rng.range(0.19, 0.27);
        const lean = rng.chance(0.12) ? rng.range(0.1, 0.25) : 0;
        b.box('matte', rng.pick(bookColors), [0.17, h, t], [sx, y + h / 2, z + t / 2], { rot: [lean, 0, 0] });
        z += t + 0.004 + lean * 0.12;
      }
    }
    b.cyl('satin', 0xd9d4c8, 0.07, 0.11, [sx, 1.365, -0.05], { top: 0.085 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      b.add('matte', 0x4f8f6a, place(blob(0.03, 0.11, 0.018, 2), [sx + Math.cos(a) * 0.05, 1.56, -0.05 + Math.sin(a) * 0.05], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]));
    }
    b.cyl('metal', 0x8e94a6, 0.05, 0.02, [sx, 1.815, -1.0]);
    b.add('gloss', 0x4f7fb8, place(blob(0.085, 0.085, 0.085, 3), [sx, 1.93, -1.0]));
    b.box('satin', 0x2b2f3d, [0.02, 0.2, 0.27], [sx + 0.02, 1.92, -0.3], { rot: [0, 0, -0.14] });
    b.box('matte', 0xf0d9b8, [0.006, 0.16, 0.23], [sx + 0.006, 1.92, -0.3], { rot: [0, 0, -0.14] });

    // ---- boxes still taped shut: they moved here not long ago ----
    const card = 0xb99468;
    for (const [x, y, z, s, r] of [[1.55, 0.25, 1.95, 0.5, 0.2], [1.62, 0.72, 1.98, 0.42, -0.3], [0.95, 0.2, 2.1, 0.4, 0.5]] as const) {
      b.box('matte', card, [s, s, s], [x, y, z], { rot: [0, r, 0], r: 0.008 });
      b.box('matte', 0xe6dcc6, [s * 1.004, 0.012, 0.07], [x, y + s / 2, z], { rot: [0, r, 0] });
    }
    // school bag slumped by the bed
    b.box('matte', 0x3f6b6a, [0.32, 0.42, 0.17], [-1.0, 0.2, -0.2], { r: 0.07, rot: [-0.16, 0.5, 0] });
    b.box('matte', 0x355a59, [0.24, 0.17, 0.05], [-0.95, 0.15, -0.1], { r: 0.022, rot: [-0.16, 0.5, 0] });
    b.box('matte', 0xe9e4d8, [0.05, 0.03, 0.02], [-0.95, 0.2, -0.07], { rot: [-0.16, 0.5, 0] });
    b.finish(scene);
    await ctx.step('bedroom: furniture');

    // ---- rug, posters, glass ----
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.15, 64), new THREE.MeshStandardMaterial({
      roughness: 0.95,
      map: canvasTexture(512, (c, s) => {
        for (let i = 9; i >= 0; i--) {
          c.fillStyle = ['#3d4a6b', '#55648c', '#e6dcc6', '#c9694e'][i % 4]!;
          c.beginPath();
          c.arc(s / 2, s / 2, (s / 2) * ((i + 1) / 10), 0, TAU);
          c.fill();
        }
      }),
    }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.25, 0.006, 0.35);
    rug.receiveShadow = true;
    scene.add(rug);

    const starMap = makePoster(0.56, 0.76, (c, w, h) => {
      c.fillStyle = '#141a33';
      c.fillRect(0, 0, w, h);
      const r = new Rng(5);
      c.strokeStyle = 'rgba(160,190,255,0.5)';
      c.lineWidth = 2;
      for (const k of [0.18, 0.3, 0.42]) {
        c.beginPath();
        c.arc(w / 2, h * 0.45, w * k, 0, TAU);
        c.stroke();
      }
      c.fillStyle = '#fff';
      for (let i = 0; i < 90; i++) c.fillRect(r.range(20, w - 20), r.range(20, h * 0.86), r.range(1.5, 4), r.range(1.5, 4));
      c.font = font(600, 30);
      c.textAlign = 'center';
      spaced(c, 'NIGHT SKY · 2080', w / 2, h - 40, 4, 'center');
    });
    starMap.position.set(-W + 0.004, 1.78, -1.75);
    starMap.rotation.y = Math.PI / 2;
    const welcome = makePoster(0.5, 0.36, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#f2b880');
      g.addColorStop(1, '#d9735c');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff8ee';
      c.font = font(700, 44);
      c.textAlign = 'center';
      c.fillText('NEW CITY,', w / 2, h * 0.42);
      c.fillText('NEW START', w / 2, h * 0.42 + 54);
      c.font = font(400, 22);
      c.fillText('Harbour District welcomes you', w / 2, h - 44);
    });
    welcome.position.set(-W + 0.004, 1.55, -0.72);
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
        void main(){
          vec2 g = vec2(vUv.x * 120.0, vUv.y * 5.0);
          float col = floor(g.x), speed = 0.25 + 0.5 * h(vec2(col, 1.0));
          float y = fract(g.y * 0.2 + uTime * speed * 0.3 + h(vec2(col, 7.0)));
          float drop = smoothstep(0.0, 0.015, y) * smoothstep(0.11, 0.015, y) * step(0.7, h(vec2(col, 3.0)));
          float thin = 1.0 - smoothstep(0.0, 0.3, abs(fract(g.x) - 0.5));
          gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * drop * thin * 0.22 * uAmount, 1.0);
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
    this.lamp.position.set(-0.93, 0.86, -2.3);
    this.lampShade = new THREE.Mesh(lathe([[0.075, 0.7], [0.13, 0.86], [0.125, 0.87], [0.07, 0.71]], 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.72, 0.42).multiplyScalar(1.6), side: THREE.DoubleSide }));
    this.lampShade.position.set(-0.93, 0, -2.34);
    const lampGlow = makeHalo(0xffb070, 1.5, 0.3);
    lampGlow.position.set(-0.93, 0.8, -2.34);
    // a strip of cool light in the cove above the window
    this.cove = new THREE.Mesh(new THREE.BoxGeometry(WX1 - WX0, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.72, 1.0).multiplyScalar(1.8) }));
    this.cove.position.set((WX0 + WX1) / 2, WY1 + 0.14, -D + 0.05);
    const coveLight = new THREE.PointLight(0x8fb0ff, 0.9, 5, 2);
    coveLight.position.set(0.6, 2.3, -2.2);
    scene.add(this.skyFill, this.sun, this.sun.target, this.lamp, this.lampShade, lampGlow, this.cove, coveLight);

    // ---- phone, dock light, hologram ----
    this.phone.group.position.copy(BEDROOM.phone);
    this.phone.group.rotation.y = 0.35;
    scene.add(this.phone.group);
    this.dockRing = new THREE.Mesh(torus(0.096, 0.005, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1.0).multiplyScalar(2) }));
    this.dockRing.position.set(BEDROOM.dock.x, 0.765, BEDROOM.dock.z);
    scene.add(this.dockRing);

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
    const jamie = this.addPerson('jamie', new Character({ ...CAST.jamie, scale: 0.34 }, ctx.quality.characterDetail));
    jamie.place(BEDROOM.hologram.x, BEDROOM.phone.y + 0.03, BEDROOM.hologram.z + 0.04, 0.12);
    jamie.root.visible = false;
    const callLight = new THREE.PointLight(0x8fd0ff, 0, 1.6, 2);
    callLight.name = 'callLight';
    callLight.position.set(BEDROOM.hologram.x, 1.25, BEDROOM.hologram.z + 0.3);
    scene.add(callLight);

    this.colliders.bounds = { kind: 'rect', minX: -W, maxX: W, minZ: -D, maxZ: D };
    this.colliders.box(bx, -1.42, 0.56, 1.1).box(-0.93, -2.34, 0.22, 0.22).box(dx, dz, 1.02, 0.38).circle(cx, cz, 0.3)
      .box(sx, -0.5, 0.16, 0.88).box(1.58, 1.98, 0.3, 0.3).box(0.95, 2.1, 0.22, 0.22).circle(-1.0, -0.18, 0.2);
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
    (this.lampShade.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.72, 0.42).multiplyScalar(0.5 + 1.4 * n);
    (this.cove.material as THREE.MeshBasicMaterial).color.setRGB(0.55, 0.72, 1.0).multiplyScalar(0.3 + 1.6 * n);
    (this.rain.material as THREE.ShaderMaterial).uniforms.uAmount!.value = n;
    this.look.exposure = 1.0 + 0.22 * n;
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
    this.dockRing.scale.setScalar(1 + 0.03 * Math.sin(time * 2));
    const jamie = this.cast.jamie!;
    if (jamie.root.visible) {
      jamie.root.scale.setScalar(0.34 * Math.max(0.001, this.callShown));
      if (this.callShown < 0.01 && this.callTarget === 0) jamie.root.visible = false;
    }
    const callLight = this.scene.getObjectByName('callLight') as THREE.PointLight;
    callLight.intensity = this.callShown * 1.2;
  }
}

