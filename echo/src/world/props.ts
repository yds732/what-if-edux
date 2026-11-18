import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { addGlow } from '../assets/glow';

export interface HeadsetProp {
  readonly group: THREE.Group;
  readonly ready: Promise<void>;
  setPower(k: number): void;
}

export const buildHeadset = (assets: AssetLibrary): HeadsetProp => {
  const group = new THREE.Group();
  const light = new THREE.PointLight(0x7fd8ff, 0, 1.6, 2);
  light.position.set(0, 0, 0.34);
  group.add(light);
  let power = 0;
  let seam: { value: number } | null = null, full = 0;
  const apply = (): void => {
    light.intensity = 0.22 * power;
    if (seam) seam.value = full * (0.12 + 1.9 * power);
  };
  const ready = assets.model('headset').then(async ({ entry }) => {
    const model = await assets.instance('headset');
    model.position.y = -entry.size![1] / 2;
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const material = (o.material as THREE.MeshStandardMaterial).clone();
      o.material = material;
      if (entry.glow) {
        seam = addGlow(material, entry.glow);
        full = entry.glow.strength;
      }
    });
    group.add(model);
    apply();
  });
  return {
    group,
    ready,
    setPower(k) {
      power = k;
      apply();
    },
  };
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
