/**
 * Podłoże terenu (etap 5b): las, łąka wyrównana, łąka naturalna, kamienisty / skała, przecinka po
 * wycince (pniaki – dopóki teren nie zostanie wyrównany). Od podłoża zależy, ile ubitego śniegu trzeba
 * do bezpiecznej jazdy (snowRiding.ts) i ile kosztuje wyrównanie przy budowie trasy.
 * Parametry: data/construction.json (sekcja „ground”).
 */
import { readNumber, readSection } from './params';
import type { TerrainGrid } from './terrainGrid';

export const GROUND_FOREST = 0;
export const GROUND_GRADED = 1;
export const GROUND_MEADOW = 2;
export const GROUND_ROCKY = 3;
export const GROUND_STUMPS = 4;
export const GROUND_NAMES = ['las', 'łąka wyrównana', 'łąka naturalna', 'kamienisty / skała', 'przecinka (pniaki)'] as const;

export interface GroundParams {
  forestShareMin: number;
  rockyShrubShareMin: number;
  rockySlopePercent: number;
  /** Koszt wyrównania [zł/m²] wg podłoża przed wyrównaniem (indeks = kod podłoża). */
  levelingCostPlnPerM2: number[];
  levelingDaysPerHectare: number;
}

const FILE = 'data/construction.json';

export function parseGroundParams(raw: unknown): GroundParams {
  const s = readSection(raw, 'ground', FILE);
  const n = (k: string) => readNumber(s, k, FILE, { min: 0 });
  const meadow = n('levelingCostMeadowPlnPerM2');
  const stumps = n('levelingCostStumpsPlnPerM2');
  return {
    forestShareMin: n('forestShareMin'),
    rockyShrubShareMin: n('rockyShrubShareMin'),
    rockySlopePercent: n('rockySlopePercent'),
    // las (po wycince – pniaki), wyrównana, łąka, kamienisty, pniaki
    levelingCostPlnPerM2: [stumps, 0, meadow, n('levelingCostRockyPlnPerM2'), stumps],
    levelingDaysPerHectare: n('levelingDaysPerHectare'),
  };
}

/** Podłoże pierwotne (przed budową): las, kosodrzewina na rumowisku lub stromizna – skała, reszta – łąka. */
export function initialGround(grid: TerrainGrid, forest: Float32Array | null, shrub: Float32Array | null, p: GroundParams): Uint8Array {
  const out = new Uint8Array(grid.cellCount);
  for (let k = 0; k < grid.cellCount; k++) {
    if ((forest?.[k] ?? 0) >= p.forestShareMin) out[k] = GROUND_FOREST;
    else if ((shrub?.[k] ?? 0) >= p.rockyShrubShareMin || grid.slopePercent[k] >= p.rockySlopePercent) out[k] = GROUND_ROCKY;
    else out[k] = GROUND_MEADOW;
  }
  return out;
}

/** Podłoże po budowie: wycięty las – pniaki; wyrównane trasy – łąka wyrównana. */
export function groundAfterWorks(base: Uint8Array, clearedMask: Uint8Array, gradedMask: Uint8Array | null): Uint8Array {
  const out = base.slice();
  for (let k = 0; k < out.length; k++) {
    if (clearedMask[k] && out[k] === GROUND_FOREST) out[k] = GROUND_STUMPS;
    if (gradedMask && gradedMask[k]) out[k] = GROUND_GRADED;
  }
  return out;
}
