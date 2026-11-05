import { TerrainGrid } from '../src/sim/terrainGrid';
import { computeSlopeAndAspect } from '../src/sim/terrainAnalysis';

/**
 * Płaszczyzna o zadanym nachyleniu [%] opadająca w kierunku azymutu [°] (0 = N, 90 = E, 180 = S).
 * z = z0 − s · (odległość w kierunku spadku).
 */
export function planeGrid(
  slopePercent: number,
  downhillAzimuthDeg: number,
  options: { width?: number; height?: number; cellSizeM?: number; baseM?: number } = {},
): TerrainGrid {
  const width = options.width ?? 30;
  const height = options.height ?? 25;
  const cell = options.cellSizeM ?? 10;
  const base = options.baseM ?? 1000;
  const s = slopePercent / 100;
  const az = (downhillAzimuthDeg * Math.PI) / 180;
  const elevation = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const east = (i + 0.5) * cell;
      const north = -(j + 0.5) * cell; // y lokalne rośnie na południe
      elevation[j * width + i] = base - s * (east * Math.sin(az) + north * Math.cos(az));
    }
  }
  const grid = new TerrainGrid(width, height, cell, elevation);
  computeSlopeAndAspect(grid);
  return grid;
}

export function flatGrid(elevationM: number, width = 20, height = 20, cell = 10): TerrainGrid {
  const grid = new TerrainGrid(width, height, cell, new Float32Array(width * height).fill(elevationM));
  computeSlopeAndAspect(grid);
  return grid;
}
