// Pages: the What If game (index.html), ECHO Scene 1 at school (scene1.html) and the ECHO bedroom scene (echo.html).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: page('./index.html'), scene1: page('./scene1.html'), echo: page('./echo.html') },
    },
  },
});
