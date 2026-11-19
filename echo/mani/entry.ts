import '@fontsource-variable/inter/index.css';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '../src/ui/dom/base.css';
import { runGame } from '../src/app/play';
import { Game } from '../src/app/Game';
import { HAVEN } from '../src/world/haven/HavenWorld';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const host = window as Window & { __MANI_EDITOR_PREVIEW__?: boolean; __M3D_EDITOR__?: object };
let editing = host.__MANI_EDITOR_PREVIEW__ === true;
let changeMode: (() => void) | undefined;
addEventListener('m3d:edit-mode', event => {
  editing = (event as CustomEvent<{ editing: boolean }>).detail.editing;
  changeMode?.();
});

async function boot() {
  const params = new URLSearchParams(location.search);
  const preview = editing;
  const game = preview
    ? new Game({ canvas, tier: 'low', fixedScale: 1, maxDpr: 1 })
    : await runGame(canvas, params);
  const { app } = game;
  if (preview) {
    game.setWorld(await game.ensureWorld('haven'));
    game.player.teleport(HAVEN.spawn);
    app.paused = true;
    app.start();
  } else {
    // The ordinary title menu builds Haven asynchronously.
    while (!app.world || !app.info.triangles || (!game.playing && app.fx.fade > 0.003)) {
      await new Promise(requestAnimationFrame);
    }
  }
  app.camera.name = 'Camera';
  app.camera.userData.__m3d_viewcam = 1;
  app.rig.name = 'Player rig';
  const scene = app.world!.scene;
  for (const [index, object] of scene.children.entries()) {
    if (!object.name) object.name = app.world!.id + ' ' + object.type + ' ' + (index + 1);
  }
  host.__M3D_EDITOR__ = {
    get scene() { return app.world!.scene; },
    camera: app.camera, renderer: app.renderer, controls: game.player,
    invalidate: () => app.render(), ready: true,
  };
  document.querySelector('.boot')?.remove();

  // Engine normally opens Test in a fresh document. For in-place Test, isolate
  // the game in a disposable frame so exit restores the edited scene and pose.
  let test: HTMLIFrameElement | undefined;
  changeMode = () => {
    if (!preview) {
      app.paused = editing;
      game.audio.setPaused(editing);
      document.getElementById('ui')!.hidden = editing;
    } else if (!editing && !test) {
      test = document.createElement('iframe');
      test.title = 'Play ECHO';
      test.allow = 'xr-spatial-tracking; fullscreen; autoplay';
      test.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:10';
      const source = document.documentElement.cloneNode(true) as HTMLElement;
      source.querySelector('#ui')!.replaceChildren();
      test.srcdoc = '<!doctype html>' + source.outerHTML;
      document.body.append(test);
      test.focus();
    } else if (editing && test) {
      test.remove();
      test = undefined;
    }
  };
  changeMode();
  window.dispatchEvent(new Event('m3d:scene-ready'));
}

boot().catch(error => {
  document.querySelector('.boot')?.replaceChildren(String(error));
  console.error(error);
});
