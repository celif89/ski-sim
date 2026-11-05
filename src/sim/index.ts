// Symulacja świata gry. Ten katalog NIE może importować niczego z PixiJS ani z przeglądarki.
export { Rng, hashStringToSeed } from './rng';
export { TerrainGrid } from './terrainGrid';
export type { GeoReference } from './terrainGrid';
export { parseSimSettings, parseGridSettings } from './settings';
export type { SimSettings, MapSettings } from './settings';
export { generateTerrain, parseTerrainGeneratorParams } from './terrainGenerator';
export type { TerrainGeneratorParams } from './terrainGenerator';
export { parseMapDefinition, createGridFromMap } from './mapFile';
export type { MapDefinition, ControlPoint } from './mapFile';
export {
  computeSlopeAndAspect,
  computeHillshade,
  hornGradient,
  aspectFromGradient,
  slopePercentToDeg,
  slopeDegToPercent,
} from './terrainAnalysis';
export type { HillshadeParams } from './terrainAnalysis';
export { computeContours, traceLevel, contourLevels, isMajorLevel } from './contours';
export type { ContourLine, ContourParams } from './contours';
export { computeProfile } from './profile';
export type { TerrainProfile, ProfilePoint, ProfileSegment } from './profile';
export { parseSlopeClasses, classifySlope } from './slopeClasses';
export type { SlopeClass } from './slopeClasses';
export { latLonToPuwg92, puwg92ToLatLon } from './geo';
export type { Puwg92Point, LatLon } from './geo';
