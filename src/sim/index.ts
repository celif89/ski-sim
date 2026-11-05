// Symulacja świata gry. Ten katalog NIE może importować niczego z PixiJS ani z przeglądarki.
export { Rng, hashStringToSeed } from './rng';
export { TerrainGrid } from './terrainGrid';
export { parseSimSettings } from './settings';
export type { SimSettings, MapSettings } from './settings';
export { generateTerrain, parseTerrainGeneratorParams } from './terrainGenerator';
export type { TerrainGeneratorParams } from './terrainGenerator';
