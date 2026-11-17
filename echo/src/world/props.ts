import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { addGlow } from '../assets/glow';

/** Props that travel between worlds and hands. Each is a group at once, and wears its model when that arrives. */

export interface HeadsetProp {
  readonly group: THREE.Group;
  /** Settles once the model is on. */
  readonly ready: Promise<void>;
  /** 0 asleep .. 1 awake: the light along the visor. */
  setPower(k: number): void;
}

/**
 * The Echo headset. Its +Z is the front, so a wearer looks out along +Z; the origin is the centre of the head it
 * would sit on.
 */
export const buildHeadset = (assets: AssetLibrary): HeadsetProp => {
  const group = new THREE.Group();
  // out in front of the visor: the hands that hold the band are beside it, and would be bleached by a light between them
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
    // the model stands on its origin: the band goes around the middle of the head
    model.position.y = -entry.size![1] / 2;
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // the headset alone has its light turned up and down, so it keeps a material of its own
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
  /** 0 dark .. 1 lit; pulses when a message is waiting. */
  setGlow(k: number): void;
}

/** A slim phone lying flat: origin at the centre of its back, screen up (+Y). Resolves with its model on. */
export const buildPhone = async (assets: AssetLibrary): Promise<PhoneProp> => {
  const group = new THREE.Group();
  const { entry } = await assets.model('phone');
  const [wide, thick, long] = entry.size!;
  group.add(await assets.instance('phone'));
  // the glass is the game's own, so that it can light up
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
