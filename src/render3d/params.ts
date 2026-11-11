/**
 * Etap 3D-0: parametry widoku 3D (data/render3d.json) – tylko rysowanie.
 */
const FILE = 'data/render3d.json';

type Sec = Record<string, unknown>;

function val(sec: Sec, key: string, path: string): unknown {
  const v = (sec[key] as { value?: unknown } | undefined)?.value;
  if (v === undefined) throw new Error(`${FILE}: brak ${path}.${key}`);
  return v;
}
const num = (sec: Sec, key: string, path: string): number => {
  const v = val(sec, key, path);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${FILE}: ${path}.${key} – liczba`);
  return v;
};
const arr = (sec: Sec, key: string, path: string, n?: number): number[] => {
  const v = val(sec, key, path);
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number') || (n !== undefined && v.length !== n)) throw new Error(`${FILE}: ${path}.${key} – lista liczb${n ? ` (${n})` : ''}`);
  return v as number[];
};
const sec = (raw: Sec, key: string): Sec => {
  const s = raw[key];
  if (!s || typeof s !== 'object') throw new Error(`${FILE}: brak sekcji ${key}`);
  return s as Sec;
};

export type Quality = 0 | 1 | 2;
export const QUALITY_NAMES = ['niska', 'średnia', 'wysoka'] as const;

export interface Render3DParams {
  terrain: { chunkCells: number; lodDistancesM: number[]; skirtM: number; backgroundStepCells: number; backgroundDropM: number; snowLineWidthM: number };
  forest: { spacingM: number; heightM: number; shrubSpacingM: number; shrubHeightM: number; variants: number; seed: number };
  quality: { shadowCascades: number[]; shadowMapPx: number[]; shadowFarM: number[]; treesNearM: number[]; ao: number[]; pixelRatio: number[]; peopleMax: number[] };
  camera: { fovDeg: number; minDistanceM: number; maxDistanceM: number; minPitchDeg: number; maxPitchDeg: number; minClearanceM: number; panSpeed: number; rotateSpeedDegS: number; zoomStep: number };
  atmosphere: { fogDensity: number; valleyFogTopM: number; valleyFogStrength: number; exposure: number; nightAmbient: number; pisteLightIntensity: number };
  people: { heightM: number; seatHeightM: number };
  pistes: { poleSpacingM: number; poleHeightM: number; netSlopePercent: number; netHeightM: number };
  governor: { targetFps: number; lowFps: number; windowS: number; minResolutionScale: number; minTreeScale: number; step: number };
}

export function parseRender3DParams(raw: unknown): Render3DParams {
  const r = raw as Sec;
  const t = sec(r, 'terrain');
  const f = sec(r, 'forest');
  const q = sec(r, 'quality');
  const c = sec(r, 'camera');
  const a = sec(r, 'atmosphere');
  const pe = sec(r, 'people');
  const pi = sec(r, 'pistes');
  const nums = <K extends string>(s: Sec, path: string, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, num(s, k, path)])) as Record<K, number>;
  const q3 = (k: string) => arr(q, k, 'quality', 3);
  return {
    terrain: { ...nums(t, 'terrain', ['chunkCells', 'skirtM', 'backgroundStepCells', 'backgroundDropM', 'snowLineWidthM'] as const), lodDistancesM: arr(t, 'lodDistancesM', 'terrain') },
    forest: nums(f, 'forest', ['spacingM', 'heightM', 'shrubSpacingM', 'shrubHeightM', 'variants', 'seed'] as const),
    quality: { shadowCascades: q3('shadowCascades'), shadowMapPx: q3('shadowMapPx'), shadowFarM: q3('shadowFarM'), treesNearM: q3('treesNearM'), ao: q3('ao'), pixelRatio: q3('pixelRatio'), peopleMax: q3('peopleMax') },
    camera: nums(c, 'camera', ['fovDeg', 'minDistanceM', 'maxDistanceM', 'minPitchDeg', 'maxPitchDeg', 'minClearanceM', 'panSpeed', 'rotateSpeedDegS', 'zoomStep'] as const),
    atmosphere: nums(a, 'atmosphere', ['fogDensity', 'valleyFogTopM', 'valleyFogStrength', 'exposure', 'nightAmbient', 'pisteLightIntensity'] as const),
    people: nums(pe, 'people', ['heightM', 'seatHeightM'] as const),
    pistes: nums(pi, 'pistes', ['poleSpacingM', 'poleHeightM', 'netSlopePercent', 'netHeightM'] as const),
    governor: nums(sec(r, 'governor'), 'governor', ['targetFps', 'lowFps', 'windowS', 'minResolutionScale', 'minTreeScale', 'step'] as const),
  };
}
