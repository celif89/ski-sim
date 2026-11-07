/** Etap 7d: atlas wygenerowany przy budowaniu (vite.config.ts, wtyczka sprite-atlas). */
declare module 'virtual:sprite-atlas' {
  import type { GeneratedAtlas } from './atlasGen';
  const atlas: GeneratedAtlas;
  export default atlas;
}
