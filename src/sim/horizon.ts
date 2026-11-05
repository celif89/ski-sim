/**
 * Horyzont każdej komórki mapy: kąt wzniesienia przesłaniającego terenu w N kierunkach
 * (domyślnie 32, co 11,25°). Liczony raz przy wczytaniu mapy.
 *
 * Wzdłuż promienia z każdej komórki próbkujemy teren: blisko – siatka gry (10 m), dalej i poza
 * mapą (np. kopuła Pilska po stronie słowackiej) – model terenu okolicy (Copernicus, 30 m).
 * Krok rośnie z odległością. Uwzględniona krzywizna Ziemi z refrakcją:
 * obniżenie = d² · (1 − k) / (2R).
 *
 * Wynik: kąt horyzontu [°] (≥ 0) dla każdej komórki i kierunku oraz współczynnik widoku nieba
 * (sky view factor): średnia z cos²(kąt horyzontu) – 1 dla płaskiej równiny, mniej w dolinach
 * i na stokach.
 */
import { readNumber, readSection } from './params';
import type { TerrainGrid } from './terrainGrid';

/** Model terenu okolicy w PUWG 1992 (do liczenia horyzontu). */
export interface HorizonDem {
  westEastingM: number;
  northNorthingM: number;
  cellSizeM: number;
  widthCells: number;
  heightCells: number;
  elevationM: Float32Array;
}

export interface HorizonParams {
  directions: number;
  maxDistanceM: number;
  stepGrowthFraction: number;
  earthRadiusM: number;
  refractionCoefficient: number;
}

export interface HorizonField {
  directions: number;
  /** Kąt horyzontu [°] dla komórki k i kierunku d: angleDeg[k · directions + d]; kierunek d = azymut d · 360°/N. */
  angleDeg: Float32Array;
  /** Współczynnik widoku nieba 0–1 (NaN poza mapą). */
  skyViewFactor: Float32Array;
}

const FILE = 'data/radiation.json';

export function parseHorizonParams(raw: unknown): HorizonParams {
  const s = readSection(raw, 'horizon', FILE);
  return {
    directions: readNumber(s, 'directions', FILE, { integer: true, min: 4, max: 360 }),
    maxDistanceM: readNumber(s, 'maxDistanceM', FILE, { min: 10 }),
    stepGrowthFraction: readNumber(s, 'stepGrowthFraction', FILE, { min: 0, max: 0.5 }),
    earthRadiusM: readNumber(s, 'earthRadiusM', FILE, { min: 1 }),
    refractionCoefficient: readNumber(s, 'refractionCoefficient', FILE, { min: 0, max: 1 }),
  };
}

/**
 * Liczy horyzont dla wszystkich komórek mapy. `dem` (okolica) może być null – wtedy horyzont
 * tylko z terenu mapy. `onProgress` dostaje część wykonanej pracy 0–1.
 */
export function computeHorizon(
  grid: TerrainGrid,
  dem: HorizonDem | null,
  params: HorizonParams,
  onProgress?: (fraction: number) => void,
): HorizonField {
  const field: HorizonField = {
    directions: params.directions,
    angleDeg: new Float32Array(grid.cellCount * params.directions),
    skyViewFactor: new Float32Array(grid.cellCount).fill(Number.NaN),
  };
  computeHorizonRows(grid, dem, params, 0, grid.heightCells, field, onProgress);
  return field;
}

/**
 * Horyzont tylko dla wierszy [rowStart, rowEnd) – do podziału pracy między kilka wątków.
 * Wyniki wpisywane do `out` (tablice na całą mapę).
 */
export function computeHorizonRows(
  grid: TerrainGrid,
  dem: HorizonDem | null,
  params: HorizonParams,
  rowStart: number,
  rowEnd: number,
  out: HorizonField,
  onProgress?: (fraction: number) => void,
): void {
  const n = params.directions;
  const w = grid.widthCells;
  const h = grid.heightCells;
  const c = grid.cellSizeM;
  const fine = grid.elevationM;
  const { angleDeg, skyViewFactor } = out;

  // Przesunięcie modelu okolicy względem lokalnych współrzędnych mapy.
  const geo = grid.georef;
  const demOffsetX = dem && geo ? geo.westEastingM - dem.westEastingM : 0; // x_dem = x + offset
  const demOffsetY = dem && geo ? dem.northNorthingM - geo.northNorthingM : 0; // y_dem = y + offset
  let maxElevation = grid.elevationRangeM().maxM;
  if (dem) for (const v of dem.elevationM) if (v > maxElevation) maxElevation = v;
  const curvature = (1 - params.refractionCoefficient) / (2 * params.earthRadiusM);

  const sampleFine = (x: number, y: number): number => {
    const fx = x / c - 0.5;
    const fy = y / c - 0.5;
    if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= h - 1) return Number.NaN;
    const i0 = fx | 0;
    const j0 = fy | 0;
    const tx = fx - i0;
    const ty = fy - j0;
    const k = j0 * w + i0;
    // Jeśli któraś z komórek jest NaN, wynik też NaN → przejście do modelu okolicy.
    return (fine[k] * (1 - tx) + fine[k + 1] * tx) * (1 - ty) + (fine[k + w] * (1 - tx) + fine[k + w + 1] * tx) * ty;
  };
  const sampleDem = (x: number, y: number): number => {
    if (!dem) return Number.NaN;
    const fx = (x + demOffsetX) / dem.cellSizeM - 0.5;
    const fy = (y + demOffsetY) / dem.cellSizeM - 0.5;
    if (fx < 0 || fy < 0 || fx >= dem.widthCells - 1 || fy >= dem.heightCells - 1) return Number.NaN;
    const i0 = fx | 0;
    const j0 = fy | 0;
    const tx = fx - i0;
    const ty = fy - j0;
    const e = dem.elevationM;
    const dw = dem.widthCells;
    const k = j0 * dw + i0;
    return (e[k] * (1 - tx) + e[k + 1] * tx) * (1 - ty) + (e[k + dw] * (1 - tx) + e[k + dw + 1] * tx) * ty;
  };

  const dirX = new Float64Array(n);
  const dirY = new Float64Array(n);
  for (let d = 0; d < n; d++) {
    const az = (2 * Math.PI * d) / n;
    dirX[d] = Math.sin(az); // wschód
    dirY[d] = -Math.cos(az); // y lokalne rośnie na południe
  }
  const minStep = c;

  for (let j = rowStart; j < rowEnd; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const z0 = fine[k];
      if (Number.isNaN(z0)) {
        for (let d = 0; d < n; d++) angleDeg[k * n + d] = Number.NaN;
        skyViewFactor[k] = Number.NaN;
        continue;
      }
      const x0 = (i + 0.5) * c;
      const y0 = (j + 0.5) * c;
      let svfSum = 0;
      for (let d = 0; d < n; d++) {
        let maxTan = 0;
        let dist = minStep;
        while (dist <= params.maxDistanceM) {
          // Dalej nic już nie może podnieść horyzontu.
          if ((maxElevation - z0) / dist <= maxTan) break;
          const x = x0 + dirX[d] * dist;
          const y = y0 + dirY[d] * dist;
          let z = sampleFine(x, y);
          if (Number.isNaN(z)) {
            z = sampleDem(x, y);
            if (Number.isNaN(z)) {
              // Poza oboma modelami: koniec promienia (chyba że jeszcze jesteśmy blisko mapy).
              if (!dem) break;
              const fxd = (x + demOffsetX) / dem.cellSizeM;
              const fyd = (y + demOffsetY) / dem.cellSizeM;
              if (fxd < 0 || fyd < 0 || fxd > dem.widthCells || fyd > dem.heightCells) break;
              dist += Math.max(minStep, dist * params.stepGrowthFraction);
              continue;
            }
          }
          const t = (z - dist * dist * curvature - z0) / dist;
          if (t > maxTan) maxTan = t;
          dist += Math.max(minStep, dist * params.stepGrowthFraction);
        }
        const angle = Math.atan(maxTan);
        angleDeg[k * n + d] = (angle * 180) / Math.PI;
        const cosA = Math.cos(angle);
        svfSum += cosA * cosA;
      }
      skyViewFactor[k] = svfSum / n;
    }
    if (onProgress && (j & 15) === 0) onProgress((j - rowStart) / Math.max(1, rowEnd - rowStart));
  }
  onProgress?.(1);
}

/** Kąt horyzontu [°] w kierunku azymutu [°] – interpolacja liniowa między kierunkami. */
export function horizonAngleAt(field: HorizonField, cellIndex: number, azimuthDeg: number): number {
  const n = field.directions;
  const pos = ((((azimuthDeg % 360) + 360) % 360) / 360) * n;
  const d0 = Math.floor(pos) % n;
  const d1 = (d0 + 1) % n;
  const f = pos - Math.floor(pos);
  const base = cellIndex * n;
  return field.angleDeg[base + d0] * (1 - f) + field.angleDeg[base + d1] * f;
}
