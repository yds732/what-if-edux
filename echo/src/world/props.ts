import * as THREE from 'three';
import { blob, merge, place, roundBox, sweep, tint, v3 } from '../core/geo';

/** Props that travel between worlds and hands. */

export interface HeadsetProp {
  readonly group: THREE.Group;
  /** 0 asleep .. 1 awake: the light along the visor. */
  setPower(k: number): void;
}

/**
 * The Echo headset: a white visor with a line of light across the front. Its +Z is the front, so a wearer
 * looks out along +Z; origin is the centre of the head it would sit on.
 */
export const buildHeadset = (): HeadsetProp => {
  const group = new THREE.Group();
  const R = 0.098;
  const arc = (from: number, to: number, y: number, r = R, n = 14): THREE.Vector3[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = from + ((to - from) * i) / n;
      return v3(Math.sin(a) * r, y, Math.cos(a) * r);
    });
  const shell = merge([
    // the visor wraps the front half of the head, deepest over the eyes
    tint(sweep(arc(-1.5, 1.5, 0), (t) => ({ rx: 0.018 + 0.012 * Math.sin(t * Math.PI), ry: 0.03 + 0.016 * Math.sin(t * Math.PI) }), { radial: 12, steps: 30, up: v3(0, 1, 0) }), 0xf2f3f8),
    tint(place(blob(0.072, 0.038, 0.02, 4), [0, 0, R + 0.014]), 0x16161f),
    // strap around the back
    tint(sweep(arc(1.45, Math.PI * 2 - 1.45, -0.004, R * 1.01, 18), () => ({ rx: 0.005, ry: 0.017 }), { radial: 6, steps: 24, up: v3(0, 1, 0) }), 0x2a2c3a),
  ]);
  const body = new THREE.Mesh(shell, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.2 }));
  body.castShadow = true;
  group.add(body);

  const stripMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const strip = new THREE.Mesh(sweep(arc(-0.62, 0.62, 0.001, R + 0.0345, 12), () => ({ rx: 0.0022, ry: 0.0052 }), { radial: 6, steps: 20, up: v3(0, 1, 0) }), stripMat);
  group.add(strip);
  const glow = new THREE.PointLight(0x7fd8ff, 0, 1.2, 2);
  glow.position.set(0, 0, R + 0.06);
  group.add(glow);

  return {
    group,
    setPower(k) {
      stripMat.color.setRGB(0.35 * k * 4, 0.82 * k * 4, 1.0 * k * 4);
      glow.intensity = 0.5 * k;
    },
  };
};

export interface PhoneProp {
  readonly group: THREE.Group;
  /** 0 dark .. 1 lit; pulses when a message is waiting. */
  setGlow(k: number): void;
}

/** A slim glass phone lying flat; origin at the centre of its back, screen up (+Y). */
export const buildPhone = (): PhoneProp => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(roundBox(0.075, 0.009, 0.155, 0.004, 3), new THREE.MeshPhysicalMaterial({ color: 0x1b1d28, roughness: 0.25, metalness: 0.4, clearcoat: 1 }));
  body.position.y = 0.0045;
  body.castShadow = true;
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.146), screenMat);
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = 0.0092;
  const light = new THREE.PointLight(0x8fd0ff, 0, 1.6, 2);
  light.position.y = 0.12;
  group.add(body, screen, light);
  return {
    group,
    setGlow(k) {
      screenMat.color.setRGB(0.3 * k * 2.2, 0.6 * k * 2.2, 1.0 * k * 2.2);
      light.intensity = 0.7 * k;
    },
  };
};
