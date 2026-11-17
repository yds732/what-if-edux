/**
 * The reward for finishing a task: the edges of the screen light up gold for a moment and fade, like the room
 * itself is pleased. A plain DOM layer over the canvas, so it costs nothing while it rests.
 */

let layer: HTMLDivElement | null = null;

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const glowScreenEdges = (color = '255, 210, 120'): void => {
  if (typeof document === 'undefined') return;
  if (!layer) {
    layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '40', borderRadius: '0' });
    document.body.append(layer);
  }
  const off = `inset 0 0 0px 0px rgba(${color}, 0)`;
  const on = `inset 0 0 110px 22px rgba(${color}, 0.55), inset 0 0 0 3px rgba(${color}, 0.85)`;
  const soft = `inset 0 0 160px 30px rgba(${color}, 0.22), inset 0 0 0 1px rgba(${color}, 0.3)`;
  layer.getAnimations().forEach((a) => a.cancel());
  layer.animate(
    reduced() ? [{ boxShadow: soft, offset: 0 }, { boxShadow: off }] : [{ boxShadow: off }, { boxShadow: on, offset: 0.18 }, { boxShadow: soft, offset: 0.5 }, { boxShadow: off }],
    { duration: reduced() ? 900 : 1600, easing: 'ease-out' },
  );
};
