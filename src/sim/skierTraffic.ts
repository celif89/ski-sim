/**
 * Wpływ narciarzy na śnieg (etap 5): przejazdy przez komórkę w ciągu dnia
 *  – ubijają górną warstwę (gęstość rośnie do gęstości ubitego śniegu, grubość maleje, masa ta sama),
 *  – zsuwają śnieg w dół stoku na stromiznach (z komórki ubywa, w komórce niżej przybywa) – tak
 *    powstają przetarcia na stromych odcinkach i w zwężeniach (ten sam ruch na węższym pasie daje
 *    więcej przejazdów na komórkę),
 *  – tworzą muldy na stromych odcinkach (rosną z liczbą przejazdów; zasypuje je świeży śnieg,
 *    niszczy odwilż; ratraki – etap 7).
 * Liczone raz na dobę, po kroku modelu śniegu (snowWorld), z przejazdów zebranych przez gości.
 */
import type { SnowImpactParams } from './guestParams';
import type { SnowParams } from './snow';
import { SnowState, addSnow, removeSnow } from './snow';

export interface TrafficDomain {
  elevationM: Float32Array;
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
}

/** Komórka najniżej położona wśród 8 sąsiadów (−1 – brak niższej: dno, krawędź). */
export function downhillNeighbors(d: TrafficDomain): Int32Array {
  const { widthCells: w, heightCells: h, elevationM: z } = d;
  const out = new Int32Array(w * h).fill(-1);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const zk = z[k];
      if (Number.isNaN(zk)) continue;
      let best = -1;
      let bestDrop = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const n = nj * w + ni;
          const zn = z[n];
          if (Number.isNaN(zn)) continue;
          const drop = (zk - zn) / (di && dj ? Math.SQRT2 : 1);
          if (drop > bestDrop) {
            bestDrop = drop;
            best = n;
          }
        }
      }
      out[k] = best;
    }
  }
  return out;
}

/** Nachylenie w dół do najniższego sąsiada [%]. */
function slopeTo(d: TrafficDomain, k: number, n: number): number {
  const w = d.widthCells;
  const dx = (n % w) - (k % w);
  const dy = Math.floor(n / w) - Math.floor(k / w);
  return (100 * (d.elevationM[k] - d.elevationM[n])) / (Math.hypot(dx, dy) * d.cellSizeM);
}

export interface TrafficResult {
  /** Śnieg przesunięty w dół stoku [mm·komórka] (bilans masy: tyle samo zabrane, co dodane). */
  movedMm: number;
  packedCells: number;
}

/**
 * Stosuje przejazdy jednego dnia do stanu śniegu. passes – przejazdy przez komórkę (≈ liczba
 * narciarzy przecinających komórkę 10 m). Masa śniegu zachowana (zsuwanie tylko przenosi).
 */
export function applySkierTraffic(s: SnowState, d: TrafficDomain, down: Int32Array, passes: Float32Array, p: SnowImpactParams, sp: SnowParams): TrafficResult {
  let moved = 0;
  let packed = 0;
  for (let k = 0; k < passes.length; k++) {
    const n = passes[k];
    if (!(n > 0) || s.totalWater(k) < sp.minSweMm) continue;
    // 1. Ubijanie: gęstość górnej warstwy dąży do gęstości śniegu ubitego (masa bez zmian).
    const f = 1 - Math.exp(-n / Math.max(1e-6, p.passesToPack));
    if (s.topSwe[k] > 0 && s.topDensity[k] < p.packedDensityKgM3) {
      s.topDensity[k] += (p.packedDensityKgM3 - s.topDensity[k]) * f;
      s.windPacked[k] = 0;
      packed++;
    }
    if (s.botSwe[k] > 0 && s.botDensity[k] < p.packedDensityKgM3) s.botDensity[k] += (p.packedDensityKgM3 - s.botDensity[k]) * f * 0.3;
    const nb = down[k];
    if (nb < 0) continue;
    const slope = slopeTo(d, k, nb);
    // 2. Zsuwanie w dół stoku (na stromiznach) – rośnie liniowo z nachyleniem i z liczbą przejazdów.
    if (slope > p.scrapeMinSlopePercent) {
      const want = p.scrapeMmPerPass * n * ((slope - p.scrapeMinSlopePercent) / Math.max(1e-6, p.scrapeRefSlopePercent - p.scrapeMinSlopePercent));
      const temp = s.topSwe[k] > 0 ? s.topTemp[k] : s.botTemp[k];
      const got = removeSnow(s, k, Math.min(want, 0.5 * (s.topSwe[k] + s.botSwe[k])));
      if (got > 0) {
        addSnow(s, nb, got, p.packedDensityKgM3, temp, sp, false);
        moved += got;
      }
    }
    // 3. Muldy na stromych odcinkach (nie na lodzie).
    if (slope > p.mogulMinSlopePercent && !s.topIce[k]) {
      const steep = Math.min(1, (slope - p.mogulMinSlopePercent) / p.mogulMinSlopePercent);
      s.moguls[k] = Math.min(1, s.moguls[k] + (n / Math.max(1, p.passesToMoguls)) * steep);
    }
  }
  return { movedMm: moved, packedCells: packed };
}

/**
 * Zanik muld w ciągu doby: świeży śnieg zasypuje (spadek 1 − e^(−opad/mogulFillMm)), odwilż
 * (mokra powierzchnia) je niszczy. sweBefore – zapas wody w komórkach z muldami przed dobą.
 */
export function decayMoguls(s: SnowState, cells: number[], sweBefore: number[], p: SnowImpactParams): void {
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i];
    if (s.moguls[k] <= 0) continue;
    const fresh = Math.max(0, s.totalWater(k) - sweBefore[i]);
    let m = s.moguls[k] * Math.exp(-fresh / Math.max(1e-6, p.mogulFillMm));
    if (s.topLiquid[k] > 0) m *= 1 - p.mogulMeltDecayPerDay;
    s.moguls[k] = m < 0.01 ? 0 : m;
  }
}
