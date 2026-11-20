import { DEG, TAU, clamp, damp } from '../core/math';
import type { BoneName, Rig } from './skeleton';

/** Pitch offsets (degrees) for the character's standing pose. Phase is one full stride. */
export class WalkCycle {
  readonly pitch: Partial<Record<BoneName, number>> = {};
  weight = 0;
  hipsY = 0;
  private phase = 0.25;
  private readonly legLength: number;

  constructor(private readonly rig: Rig) {
    const { shinL, footL, shinR, footR } = rig.bones;
    this.legLength = (shinL.position.length() + footL.position.length() + shinR.position.length() + footR.position.length()) / 2;
  }

  update(distance: number, dt: number): void {
    this.weight = damp(this.weight, distance > 0.0001 ? 1 : 0, 16, dt);
    const leg = this.legLength, stride = leg * 2.4;
    this.phase = (this.phase + distance / stride) % 1;
    if (this.weight < 0.001) {
      this.weight = 0;
      return;
    }
    const reach = stride / 4;
    // Lower the pelvis at heel strike so the planted leg can reach the ground.
    const plantedZ = reach * (1 - 4 * (this.phase % 0.5));
    this.hipsY = Math.sqrt((leg * 0.98) ** 2 - plantedZ ** 2) - leg;
    for (const side of ['L', 'R'] as const) {
      const phase = (this.phase + (side === 'L' ? 0 : 0.5)) % 1;
      const swing = Math.max(0, 2 * phase - 1);
      // During stance the ankle travels backwards exactly as far as the body moves forwards.
      const z = phase < 0.5 ? reach * (1 - 4 * phase) : reach * (2 * swing - 1 - 2 / Math.PI * Math.sin(TAU * swing));
      const thigh = this.rig.bones[`shin${side}`].position.length();
      const calf = this.rig.bones[`foot${side}`].position.length();
      const lift = Math.sin(Math.PI * swing);
      const down = thigh + calf + this.hipsY - leg * 0.24 * lift;
      const ankle = Math.hypot(z, down);
      const hip = -Math.atan2(z, down) - Math.acos(clamp((thigh ** 2 + ankle ** 2 - calf ** 2) / (2 * thigh * ankle), -1, 1));
      const knee = Math.acos(clamp((ankle ** 2 - thigh ** 2 - calf ** 2) / (2 * thigh * calf), -1, 1));
      this.pitch[`leg${side}`] = hip / DEG;
      this.pitch[`shin${side}`] = knee / DEG;
      this.pitch[`foot${side}`] = -(hip + knee) / DEG + 8 * lift;
      this.pitch[`arm${side}`] = 24 * Math.cos(TAU * phase);
    }
  }
}
