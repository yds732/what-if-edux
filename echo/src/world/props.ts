import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';

export interface HeadsetProp {
  readonly group: THREE.Group;
  readonly ready: Promise<void>;
  setPower(k: number): void;
}

const softBox = (w: number, h: number, d: number, r: number, segs: [number, number, number]): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d, ...segs);
  const p = g.attributes.position as THREE.BufferAttribute;
  const inner = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r), v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -inner.x, inner.x), THREE.MathUtils.clamp(v.y, -inner.y, inner.y), THREE.MathUtils.clamp(v.z, -inner.z, inner.z));
    const off = v.clone().sub(c);
    if (off.lengthSq() > 1e-12) v.copy(c).add(off.normalize().multiplyScalar(r));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
};

const bend = (g: THREE.BufferGeometry, R: number, squash = 1): THREE.BufferGeometry => {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = x / R, rr = R + z;
    p.setXYZ(i, rr * Math.sin(a), y, rr * Math.cos(a) * squash);
  }
  g.computeVertexNormals();
  return g;
};

export const buildHeadset = (_assets: AssetLibrary): HeadsetProp => {
  const group = new THREE.Group();
  const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf3f4f6, roughness: 0.28, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0f1c, roughness: 0.04, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 0.9 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x585d68, roughness: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xb9bec8, roughness: 0.25, metalness: 0.85 });
  const seamMat = new THREE.MeshBasicMaterial({ color: 0x5fd8ff, toneMapped: false });
  const R = 0.088;
  const shell = new THREE.Mesh(bend(softBox(0.2, 0.068, 0.034, 0.014, [48, 8, 6]), R + 0.017, 1.05), ceramic);
  const visor = new THREE.Mesh(bend(softBox(0.17, 0.05, 0.008, 0.004, [44, 6, 2]), R + 0.038, 1.05), glass);
  visor.position.y = 0.004;
  const seam = new THREE.Mesh(bend(softBox(0.15, 0.0028, 0.003, 0.0012, [40, 1, 1]), R + 0.038, 1.05), seamMat);
  seam.position.y = -0.0245;
  const rim = new THREE.Mesh(bend(softBox(0.176, 0.056, 0.004, 0.002, [44, 6, 1]), R + 0.0335, 1.05), trim);
  rim.position.y = 0.004;
  const cushion = new THREE.Mesh(bend(softBox(0.17, 0.05, 0.014, 0.006, [40, 6, 3]), R - 0.002, 1.05), pad);
  const bandPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = THREE.MathUtils.lerp(0.62 * Math.PI, 1.38 * Math.PI, i / 48);
    bandPts.push(new THREE.Vector3((R + 0.014) * Math.sin(a), 0.006 * Math.sin((i / 48) * Math.PI), (R + 0.03) * Math.cos(a)));
  }
  const bandGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bandPts), 96, 0.0075, 12);
  bandGeo.scale(1, 2.6, 1);
  const band = new THREE.Mesh(bandGeo, ceramic);
  const bandPad = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bandPts.map((p) => p.clone().multiplyScalar(0.9))), 96, 0.006, 10), pad);
  bandPad.scale.y = 2.4;
  group.add(shell, rim, visor, seam, cushion, band, bandPad);
  for (const side of [-1, 1]) {
    const a = side * 0.62 * Math.PI;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 32), ceramic);
    hub.position.set((R + 0.02) * Math.sin(a), 0, (R + 0.024) * Math.cos(a));
    hub.lookAt(hub.position.clone().multiplyScalar(2));
    hub.rotateX(Math.PI / 2);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.008, 24), glass);
    lens.position.copy(hub.position).multiplyScalar(1 + 0.0065 / hub.position.length());
    lens.lookAt(hub.position.clone().multiplyScalar(2));
    group.add(hub, lens);
  }
  group.traverse((o) => { if (o instanceof THREE.Mesh && o.material !== seamMat) o.castShadow = true; });
  const light = new THREE.PointLight(0x7fd8ff, 0, 1.6, 2);
  light.position.set(0, 0, 0.34);
  group.add(light);
  const setPower = (k: number): void => {
    light.intensity = 0.22 * k;
    seamMat.color.setRGB(0.37, 0.85, 1.0).multiplyScalar(0.25 + 2.4 * k);
  };
  setPower(0);
  return { group, ready: Promise.resolve(), setPower };
};

export interface PhoneProp {
  readonly group: THREE.Group;
  setGlow(k: number): void;
}

export const buildPhone = async (assets: AssetLibrary): Promise<PhoneProp> => {
  const group = new THREE.Group();
  const { entry } = await assets.model('phone');
  const [wide, thick, long] = entry.size!;
  group.add(await assets.instance('phone'));
  const glass = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.12, metalness: 0.2, emissive: 0x000000 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(wide * 0.86, long * 0.92), glass);
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = thick + 0.0004;
  const light = new THREE.PointLight(0x8fd0ff, 0, 1.6, 2);
  light.position.y = 0.12;
  group.add(screen, light);
  return {
    group,
    setGlow(k) {
      glass.emissive.setRGB(0.3 * k * 2.2, 0.6 * k * 2.2, 1.0 * k * 2.2);
      light.intensity = 0.7 * k;
    },
  };
};
