/**
 * Ratraki (etap 7): flota, plan nocy (przydział tras i kolejność – ręczny albo automatyczny według
 * priorytetów), czas pracy = powierzchnia / (szerokość robocza × prędkość) wydłużony przez nachylenie,
 * świeży opad i pryzmy do rozepchnięcia, wyciągarka na stromych odcinkach (z punktem kotwienia),
 * awarie rosnące z wiekiem, paliwo. Skutek: komórki ratrakowane i tryb (mróz – twarda trasa,
 * odwilż – mokra, mokry śnieg ubity przed mrozem – lód).
 */
import type { PointM } from './lifts';
import type { Rng } from './rng';
import { GROOM_HARD, GROOM_ICE, GROOM_WET } from './snowOps';
import type { GroomerType, SnowmakingParams } from './snowmakingParams';

export interface GroomPiste {
  id: string;
  /** Numer grupy (trasa) w operacjach na śniegu: 1, 2, … */
  group: number;
  areaM2: number;
  lengthM: number;
  meanSlopePercent: number;
  /** Komórki trasy od góry (w kolejności osi) i które z nich są na stromych odcinkach (wyciągarka). */
  cells: number[];
  steep: Uint8Array;
  /** Górne końce stromych odcinków (tam musi sięgać lina od punktu kotwienia). */
  steepTops: PointM[];
  freshSnowCm: number;
  pileM3: number;
  priority: number;
  enabled: boolean;
  /** Ratrak przypisany ręcznie (null – automat). */
  groomerId: string | null;
  /** Temperatura powietrza w środku trasy w godzinie nocy (h od 0 = północ dnia ratrakowania; 17,5 → 17:30). */
  airTempC(hour: number): number;
  /** Śnieg na trasie mokry (woda ciekła ponad próg) – przed ratrakowaniem. */
  wetSnow: boolean;
}

export interface GroomerUnit {
  id: string;
  type: GroomerType;
  available: boolean;
}

export interface GroomJob {
  groomerId: string;
  pisteId: string;
  startH: number;
  endH: number;
  /** Cała trasa zrobiona (false – zabrakło czasu do rana). */
  complete: boolean;
  /** Strome odcinki zrobione (ratrak z wyciągarką i kotwa w zasięgu). */
  steepDone: boolean;
  mode: number;
  groomedCells: number[];
}

export interface NightPlanResult {
  jobs: GroomJob[];
  /** Trasy nieratrakowane lub nie do końca. */
  unfinished: string[];
  /** Trasy ze stromymi odcinkami pominiętymi (brak wyciągarki lub kotwy). */
  steepSkipped: string[];
  engineHours: Map<string, number>;
  fuelL: number;
  /** Godzina zakończenia pracy ostatniego ratraka (h zegara, może być > 24). */
  finishH: number;
}

/** Czas ratrakowania trasy [h] (bez stromych odcinków, gdy pominięte). */
export function groomingHours(pi: GroomPiste, type: GroomerType, includeSteep: boolean, p: SnowmakingParams): number {
  const g = p.groomers;
  const steepShare = pi.cells.length ? pi.steep.reduce((a, b) => a + b, 0) / pi.cells.length : 0;
  const area = pi.areaM2 * (includeSteep ? 1 : 1 - steepShare);
  const base = area / (type.widthM * type.speedKmh * 1000);
  const slopeF = 1 + g.slopeFactorPerPercent * Math.max(0, pi.meanSlopePercent - g.slopeFactorFromPercent);
  const freshF = 1 + g.freshFactorPerCm * Math.max(0, pi.freshSnowCm - g.freshThresholdCm);
  return base * slopeF * freshF + pi.pileM3 / g.pilePushM3h;
}

/** Czy lina wyciągarki sięga do stromych odcinków (kotwa bliżej niż zasięg liny od każdego górnego końca). */
export function anchorsReach(tops: PointM[], anchors: { xM: number; yM: number; rangeM: number }[]): boolean {
  return tops.every((t) => anchors.some((a) => Math.hypot(a.xM - t.xM, a.yM - t.yM) <= a.rangeM));
}

/** Tryb ratrakowania z temperatury powietrza podczas pracy i przez resztę nocy. */
export function groomMode(airDuringC: number, minAfterC: number, wetSnow: boolean, p: SnowmakingParams): number {
  const s = p.snow;
  const wetNow = airDuringC > s.groomThawC || wetSnow;
  if (wetNow && minAfterC <= s.iceFrostC) return GROOM_ICE; // mokry ubity przed mrozem – lód
  if (airDuringC > s.groomThawC) return GROOM_WET;
  return GROOM_HARD;
}

/**
 * Plan nocy: trasy po priorytecie (1 – najważniejsze); każda do przypisanego ratraka albo (automat)
 * do tego, który najwcześniej skończy – trasy ze stromiznami najpierw do ratraka z wyciągarką.
 * Ratrak pracuje od windowStartH do windowEndH następnego dnia (najwyżej maxShiftH); czego nie
 * zdąży – zostaje nieratrakowane (część trasy od dołu).
 */
export function planNight(pistes: GroomPiste[], groomers: GroomerUnit[], anchors: { xM: number; yM: number; rangeM: number }[], p: SnowmakingParams): NightPlanResult {
  const g = p.groomers;
  const shiftH = Math.min(g.maxShiftH, (g.windowEndH + 24 - g.windowStartH) % 24 || 24);
  const free = new Map<string, number>();
  for (const u of groomers) if (u.available) free.set(u.id, 0);
  const jobs: GroomJob[] = [];
  const unfinished: string[] = [];
  const steepSkipped: string[] = [];
  const hours = new Map<string, number>();
  let fuel = 0;
  const todo = pistes.filter((x) => x.enabled).sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
  for (const pi of todo) {
    const hasSteep = pi.steep.some((v) => v);
    const anchored = hasSteep && anchorsReach(pi.steepTops, anchors);
    let unit: GroomerUnit | null = null;
    if (pi.groomerId) unit = groomers.find((u) => u.id === pi.groomerId && u.available) ?? null;
    if (!unit) {
      // Automat: ratrak, który najwcześniej skończy; przy stromiznach z kotwą – najpierw z wyciągarką.
      const pool = groomers.filter((u) => u.available && free.has(u.id));
      const pref = hasSteep && anchored ? pool.filter((u) => u.type.winch) : [];
      const list = pref.length ? pref : pool;
      list.sort((a, b) => free.get(a.id)! - free.get(b.id)! || (a.id < b.id ? -1 : 1));
      unit = list[0] ?? null;
    }
    if (!unit) {
      unfinished.push(pi.id);
      continue;
    }
    const steepDone = hasSteep && unit.type.winch && anchored;
    if (hasSteep && !steepDone) steepSkipped.push(pi.id);
    const need = groomingHours(pi, unit.type, steepDone, p);
    const start = free.get(unit.id)! + (free.get(unit.id)! > 0 ? g.transferMin / 60 : 0);
    const left = Math.max(0, shiftH - start);
    const work = Math.min(need, left);
    const complete = work >= need - 1e-9;
    if (!complete) unfinished.push(pi.id);
    if (work <= 0) continue;
    free.set(unit.id, start + work);
    hours.set(unit.id, (hours.get(unit.id) ?? 0) + work);
    fuel += work * unit.type.fuelLph;
    // Komórki: od góry; stromych bez wyciągarki nie ruszamy; przy braku czasu – część od góry.
    const eligible = pi.cells.filter((_, i) => steepDone || !pi.steep[i]);
    const nCells = Math.round(eligible.length * (need > 0 ? work / need : 1));
    const startClock = g.windowStartH + start;
    const endClock = g.windowStartH + start + work;
    const during = pi.airTempC(startClock + work / 2);
    let minAfter = Infinity;
    for (let h = endClock; h <= g.windowEndH + 24 + 0.01; h += 1) minAfter = Math.min(minAfter, pi.airTempC(h));
    jobs.push({ groomerId: unit.id, pisteId: pi.id, startH: startClock, endH: endClock, complete, steepDone, mode: groomMode(during, minAfter, pi.wetSnow, p), groomedCells: eligible.slice(0, nCells) });
  }
  let finish = g.windowStartH;
  for (const j of jobs) finish = Math.max(finish, j.endH);
  return { jobs, unfinished, steepSkipped, engineHours: hours, fuelL: fuel, finishH: finish };
}

/** Awaria ratraka tej nocy (prawdopodobieństwo rośnie z wiekiem). */
export function breakdownTonight(ageYears: number, rng: Rng, p: SnowmakingParams): boolean {
  const g = p.groomers;
  return rng.next() < g.breakdownBasePerNight * (1 + g.breakdownAgeFactor * ageYears);
}
