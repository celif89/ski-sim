/**
 * Operacje na śniegu z jednego dnia (etap 7): śnieg z armatek (w pryzmach przy hydrantach) i
 * ratrakowanie (rozepchnięcie pryzm wzdłuż trasy, wyrównanie muld, ubicie; przy mrozie twarda trasa,
 * przy odwilży mokra, mokry śnieg ubity przed mrozem – lód). Dokładane do modelu śniegu na koniec dnia
 * tak jak przejazdy gości (SnowWorld), więc zapis gry odtwarza je dokładnie.
 */
import type { SnowParams, SnowState } from './snow';
import { addSnow, removeSnow } from './snow';
import type { SnowmakingParams } from './snowmakingParams';

export const GROOM_HARD = 1;
export const GROOM_WET = 2;
export const GROOM_ICE = 3;

export interface SnowOps {
  /** Śnieg techniczny dodany w komórkach [mm wody] – w pryzmach. */
  addSweMm: Float32Array | null;
  /** Średnia gęstość [kg/m³] i udział wody ciekłej śniegu z armatek tego dnia. */
  addDensityKgM3: number;
  addLiquidFraction: number;
  /** Ratrakowanie: numer trasy (1…; 0 – nie) i tryb (GROOM_HARD / WET / ICE). */
  groomGroup: Int16Array | null;
  groomMode: Uint8Array | null;
}

export function emptyOps(): SnowOps {
  return { addSweMm: null, addDensityKgM3: 450, addLiquidFraction: 0, groomGroup: null, groomMode: null };
}

/** Dokłada operacje dnia do stanu śniegu (masa zachowana przy rozpychaniu pryzm). */
export function applySnowOps(s: SnowState, ops: SnowOps, sp: SnowParams, mp: SnowmakingParams): void {
  const add = ops.addSweMm;
  if (add) {
    for (let k = 0; k < s.n; k++) {
      const swe = add[k];
      if (!(swe > 0)) continue;
      addSnow(s, k, swe, ops.addDensityKgM3, -2, sp, false);
      const liquid = swe * ops.addLiquidFraction;
      if (liquid > 0) {
        s.topSwe[k] -= liquid;
        s.topLiquid[k] += liquid;
      }
      s.pileMm[k] += swe;
      s.techMm[k] += swe;
    }
  }
  const grp = ops.groomGroup;
  const mode = ops.groomMode;
  if (!grp || !mode) return;
  // Rozepchnięcie pryzm: w każdej trasie śnieg z pryzm rozkłada się równo na ratrakowane komórki.
  const sums = new Map<number, { pile: number; tech: number; cells: number }>();
  for (let k = 0; k < s.n; k++) {
    const g = grp[k];
    if (!g) continue;
    let e = sums.get(g);
    if (!e) {
      e = { pile: 0, tech: 0, cells: 0 };
      sums.set(g, e);
    }
    e.cells++;
    if (s.pileMm[k] > 0) {
      const taken = removeSnow(s, k, s.pileMm[k]);
      e.pile += taken;
      const tech = Math.min(s.techMm[k], taken);
      s.techMm[k] -= tech;
      e.tech += tech;
      s.pileMm[k] = 0;
    }
  }
  for (let k = 0; k < s.n; k++) {
    const g = grp[k];
    if (!g) continue;
    const e = sums.get(g)!;
    const m = mode[k];
    const density = m === GROOM_WET ? mp.snow.groomedDensityWetKgM3 : mp.snow.groomedDensityHardKgM3;
    if (e.pile > 0) {
      addSnow(s, k, e.pile / e.cells, density, -2, sp, false);
      s.techMm[k] += e.tech / e.cells;
    }
    if (s.totalWater(k) <= 0) continue;
    s.moguls[k] = 0;
    s.windPacked[k] = 0;
    if (s.topSwe[k] > 0) s.topDensity[k] = Math.max(s.topDensity[k], density);
    if (m === GROOM_HARD || m === GROOM_ICE) {
      // Mróz: woda w śniegu zamarza – twarda trasa; mokry śnieg ubity przed mrozem – lód.
      s.topSwe[k] += s.topLiquid[k];
      s.topLiquid[k] = 0;
      s.topTemp[k] = Math.min(s.topTemp[k], -1);
      if (m === GROOM_ICE) s.topIce[k] = 1;
    }
  }
}

/** Po kroku modelu: śnieg techniczny i pryzmy nie mogą przekraczać śniegu w komórce (topnienie). */
export function clampTechnical(s: SnowState): void {
  for (let k = 0; k < s.n; k++) {
    if (s.techMm[k] <= 0 && s.pileMm[k] <= 0) continue;
    const w = s.totalWater(k);
    if (s.techMm[k] > w) s.techMm[k] = w;
    if (s.pileMm[k] > w) s.pileMm[k] = w;
  }
}
