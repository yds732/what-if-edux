// Two pages: the What If game (index.html) and the ECHO bedroom scene (echo.html).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: page('./index.html'), echo: page('./echo.html') },
    },
  },
});
