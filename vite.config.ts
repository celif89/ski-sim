import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { generateAtlas } from './src/render/atlasGen';
import type { AtlasDesc } from './src/render/atlasGen';

// Gra jest publikowana na GitHub Pages pod adresem
// https://celif89.github.io/ski-sim/ – dlatego wersja zbudowana (npm run build) i jej podgląd
// (npm run preview) mają ścieżkę bazową „/ski-sim/”. Serwer deweloperski (npm run dev) używa „/”.
// Ścieżkę można nadpisać zmienną środowiskową BASE_PATH (np. przy zmianie nazwy repozytorium).
const PAGES_BASE_PATH = process.env.BASE_PATH ?? '/ski-sim/';

/**
 * Etap 7d: atlas postaci i maszyn generowany przy budowaniu z data/atlas.json
 * (moduł „virtual:sprite-atlas”: obraz SVG i położenia klatek).
 */
function spriteAtlas(): Plugin {
  const VIRTUAL = 'virtual:sprite-atlas';
  const RESOLVED = '\0' + VIRTUAL;
  const descPath = fileURLToPath(new URL('./data/atlas.json', import.meta.url));
  return {
    name: 'sprite-atlas',
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(descPath);
      const atlas = generateAtlas(JSON.parse(readFileSync(descPath, 'utf8')) as AtlasDesc);
      return `export default ${JSON.stringify(atlas)};`;
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? PAGES_BASE_PATH : '/',
  plugins: [spriteAtlas()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
