import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = 'https://echo-between-two-worlds.vercel.app/';
const { version } = JSON.parse(await readFile('node_modules/three/package.json', 'utf8'));
const three = 'https://cdn.jsdelivr.net/npm/three@' + version + '/';
const [{ output }] = await build({
  configFile: false, base, publicDir: false,
  build: {
    write: false, target: 'es2022', minify: false,
    lib: { entry: 'mani/entry.ts', formats: ['es'] },
    rolldownOptions: {
      external: id => id === 'three' || id.startsWith('three/'),
      output: { codeSplitting: false },
    },
  },
});
const js = output.find(file => file.type === 'chunk').code;
const css = output.find(file => file.fileName.endsWith('.css')).source;
const imports = { three: three + 'build/three.module.js', 'three/addons/': three + 'examples/jsm/' };
const template = await readFile('index.html', 'utf8');
const html = '<!--__M3D_SINGLEFILE__-->\n' + template
  .replace('</head>', () => '<style>' + css + '</style><script type="importmap">' + JSON.stringify({ imports }) + '</script></head>')
  .replace('<script type="module" src="/src/main.ts"></script>', () =>
    '<script type="module">\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>');
await mkdir('mani/dist', { recursive: true });
await writeFile('mani/dist/scene.html', html);
