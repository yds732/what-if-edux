import '@fontsource-variable/inter/index.css';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import './ui/dom/base.css';

declare global {
  interface Window {
    __READY?: boolean;
    __ERR?: string;
    __INFO?: object;
  }
}

const fail = (e: unknown): void => {
  const text = e instanceof Error ? (e.stack ?? e.message) : String(e);
  window.__ERR ??= text;
  console.error('BOOT', text);
  const boot = document.querySelector<HTMLElement>('.boot');
  if (!boot) return;
  const message = document.createElement('p'), detail = document.createElement('small');
  message.style.cssText = 'max-width:34em;padding:24px;text-align:center;line-height:1.5';
  detail.style.cssText = 'display:block;opacity:.6';
  detail.textContent = text.split('\n')[0] ?? '';
  const hint = /WebGL/i.test(text) ? ' It draws with WebGL 2, which this browser has switched off or does not have: try a current Chrome, Edge, Firefox or Safari.' : '';
  message.append(`ECHO could not start on this device.${hint}`, detail);
  boot.replaceChildren(message);
};
addEventListener('error', (e) => fail(e.error ?? e.message));
addEventListener('unhandledrejection', (e) => fail(e.reason));

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #view canvas');

try {
  await Promise.all([
    ...[300, 400, 500, 600, 700].map((w) => document.fonts.load(`${w} 20px "Inter Variable"`)),
    ...[300, 400, 500].map((w) => document.fonts.load(`${w} 20px "Cormorant Garamond"`)),
  ]);
  if (params.has('shot')) {
    document.querySelector('.boot')?.remove();
    await (await import('./app/shot')).runShot(canvas, params);
  } else {
    await (await import('./app/play')).runGame(canvas, params);
    if (params.has('chapter') || params.has('auto')) document.querySelector('.boot')?.remove();
  }
} catch (e) {
  fail(e);
}
