/** Pomocnicze do testów naśnieżania: nachylenie i teren do promieniowania bez horyzontu. */
import { prepareSolarTerrain } from '../src/sim/radiation';
import type { TerrainGrid } from '../src/sim/terrainGrid';
export { computeSlopeAndAspect } from '../src/sim/terrainAnalysis';

/** Teren do promieniowania bez przesłonięć (horyzont 0°, pełny widok nieba). */
export function prepareSolarTerrainSafe(grid: TerrainGrid) {
  const dirs = 8;
  return prepareSolarTerrain(grid, { directions: dirs, angleDeg: new Float32Array(grid.cellCount * dirs), skyViewFactor: new Float32Array(grid.cellCount).fill(1) });
}
