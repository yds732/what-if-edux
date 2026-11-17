import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  // hashed files go to build/, apart from public/assets: models keep their names when remade, so only build/ is cached for ever (vercel.json)
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, assetsDir: 'build' },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
