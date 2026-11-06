/**
 * Śnieg a jazda (etap 5b). Baza ubita = zapas wody w śniegu (SWE) przeliczony na śnieg o gęstości
 * ubitej trasy – tyle zostaje po ubiciu (10 cm puchu o gęstości 100 kg/m³ = 10 mm wody = ok. 2,4 cm
 * bazy). Minimalna baza do bezpiecznej jazdy zależy od podłoża (łąka wyrównana mniej, kamienie
 * i pniaki więcej). Parametry: data/snow.json (sekcja „riding”).
 */
import { GROUND_FOREST, GROUND_GRADED, GROUND_MEADOW, GROUND_ROCKY, GROUND_STUMPS } from './ground';
import { readNumber, readSection } from './params';

export interface RidingParams {
  packedDensityKgM3: number;
  /** Minimalna baza [cm] wg kodu podłoża (las – nieprzejezdny: Infinity). */
  minBaseCmByGround: number[];
}

const FILE = 'data/snow.json';

export function parseRidingParams(raw: unknown): RidingParams {
  const s = readSection(raw, 'riding', FILE);
  const n = (k: string) => readNumber(s, k, FILE, { min: 0 });
  const min: number[] = [];
  min[GROUND_FOREST] = Infinity;
  min[GROUND_GRADED] = n('minBaseGradedCm');
  min[GROUND_MEADOW] = n('minBaseMeadowCm');
  min[GROUND_ROCKY] = n('minBaseRockyCm');
  min[GROUND_STUMPS] = n('minBaseStumpsCm');
  return { packedDensityKgM3: readNumber(s, 'packedDensityKgM3', FILE, { min: 1 }), minBaseCmByGround: min };
}

/** Baza ubita (równoważna) [cm] z zapasu wody w śniegu [mm = kg/m²]. */
export function packedBaseCm(sweMm: number, p: RidingParams): number {
  return sweMm > 0 ? (sweMm / p.packedDensityKgM3) * 100 : 0;
}

/** Minimalna baza [cm] na danym podłożu. */
export function minBaseCm(ground: number, p: RidingParams): number {
  return p.minBaseCmByGround[ground] ?? p.minBaseCmByGround[GROUND_MEADOW];
}

/** Jak bardzo za cienko (0 – baza wystarcza, 1 – brak śniegu): (minimum − baza) / minimum. */
export function thinSeverity(baseCm: number, minCm: number): number {
  if (!(minCm > 0) || !Number.isFinite(minCm)) return 0;
  return Math.min(1, Math.max(0, (minCm - baseCm) / minCm));
}

/** Pole „za cienko” w komórkach (0–1) – do gości i nakładki. Las pomijamy (0 – tam się nie jeździ). */
export function thinField(sweMm: Float32Array, ground: Uint8Array, p: RidingParams): Float32Array {
  const out = new Float32Array(sweMm.length);
  for (let k = 0; k < out.length; k++) {
    if (ground[k] === GROUND_FOREST) continue;
    const swe = sweMm[k];
    out[k] = thinSeverity(Number.isNaN(swe) ? 0 : packedBaseCm(swe, p), minBaseCm(ground[k], p));
  }
  return out;
}

export interface ThinSegment {
  fromM: number;
  toM: number;
  /** Najcieńsza baza na odcinku i wymagana w tym miejscu [cm]. */
  baseCm: number;
  neededCm: number;
}

/**
 * Odcinki osi trasy, gdzie baza jest cieńsza niż minimum dla podłoża (sąsiednie próbki łączone).
 * axis – próbki osi (odległość, położenie); cellAt – indeks komórki dla punktu.
 */
export function thinSegments(
  axis: { distanceM: number; xM: number; yM: number }[],
  cellAt: (xM: number, yM: number) => number,
  sweMm: Float32Array,
  ground: Uint8Array,
  p: RidingParams,
): ThinSegment[] {
  const out: ThinSegment[] = [];
  let cur: ThinSegment | null = null;
  let worstRatio = Infinity;
  for (let i = 0; i < axis.length; i++) {
    const s = axis[i];
    const k = cellAt(s.xM, s.yM);
    const g = k >= 0 ? ground[k] : GROUND_MEADOW;
    const need = minBaseCm(g === GROUND_FOREST ? GROUND_STUMPS : g, p);
    const base = k >= 0 && !Number.isNaN(sweMm[k]) ? packedBaseCm(sweMm[k], p) : 0;
    if (base < need) {
      const half = i + 1 < axis.length ? (axis[i + 1].distanceM - s.distanceM) / 2 : 0;
      const from = Math.max(0, s.distanceM - (i > 0 ? (s.distanceM - axis[i - 1].distanceM) / 2 : 0));
      if (!cur) {
        cur = { fromM: from, toM: s.distanceM + half, baseCm: base, neededCm: need };
        worstRatio = base / need;
      } else {
        cur.toM = s.distanceM + half;
        if (base / need < worstRatio) {
          worstRatio = base / need;
          cur.baseCm = base;
          cur.neededCm = need;
        }
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
      worstRatio = Infinity;
    }
  }
  if (cur) out.push(cur);
  return out;
}
