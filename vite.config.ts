import { defineConfig } from 'vitest/config';

// Gra jest publikowana na GitHub Pages pod adresem
// https://celif89.github.io/ski-sim/ – dlatego wersja zbudowana (npm run build) i jej podgląd
// (npm run preview) mają ścieżkę bazową „/ski-sim/”. Serwer deweloperski (npm run dev) używa „/”.
// Ścieżkę można nadpisać zmienną środowiskową BASE_PATH (np. przy zmianie nazwy repozytorium).
const PAGES_BASE_PATH = process.env.BASE_PATH ?? '/ski-sim/';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? PAGES_BASE_PATH : '/',
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
