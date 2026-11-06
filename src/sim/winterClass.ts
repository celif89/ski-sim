/**
 * Ocena zimy (etap 6b): liczba dni sezonu narciarskiego ze śniegiem naturalnym (baza ubita powyżej
 * progu na otwartym terenie) i klasa zimy na tle wielolecia: bardzo słaba / słaba / przeciętna /
 * dobra / bardzo dobra (kwintyle rozkładu z data/winter-classes.json).
 */
import type { ClimateProfile } from './climate';
import { seasonWeather } from './environment';
import type { RadiationParams } from './radiation';
import type { SnowParams } from './snow';
import { runPointSnow } from './snowPoint';
import type { RidingParams } from './snowRiding';
import { packedBaseCm } from './snowRiding';
import type { CalendarDate, Location, WeatherParams } from './weather';

/** Okres liczenia dni: 1 grudnia – 31 marca. */
export function inSkiSeason(d: CalendarDate): boolean {
  return d.month === 12 || d.month <= 3;
}

export interface WinterSnowDays {
  /** Dni z pokrywą ≥ 30 cm i ≥ 10 cm. */
  cover30: number;
  cover10: number;
  /** Dni z bazą ubitą ≥ kolejnych progów [cm]. */
  base: number[];
}

export function winterSnowDays(dates: CalendarDate[], sweMm: number[], depthM: number[], riding: RidingParams, thresholdsCm: number[]): WinterSnowDays {
  const out: WinterSnowDays = { cover30: 0, cover10: 0, base: thresholdsCm.map(() => 0) };
  for (let i = 0; i < dates.length; i++) {
    if (!inSkiSeason(dates[i])) continue;
    const d = depthM[i] * 100;
    if (d >= 30) out.cover30++;
    if (d >= 10) out.cover10++;
    const b = packedBaseCm(sweMm[i], riding);
    thresholdsCm.forEach((t, k) => {
      if (b >= t) out.base[k]++;
    });
  }
  return out;
}

export const WINTER_CLASS_NAMES = ['bardzo słaba', 'słaba', 'przeciętna', 'dobra', 'bardzo dobra'] as const;

export interface WinterClassTable {
  /** Wysokość punktu odniesienia [m]. */
  elevationM: number;
  /** Próg bazy ubitej [cm] (łąka naturalna). */
  baseThresholdCm: number;
  /** Liczby dni ze śniegiem w wielu zimach generatora, rosnąco (rozkład wielolecia). */
  sortedDays: number[];
  /** Średnia liczba dni. */
  meanDays: number;
}

export function parseWinterClasses(raw: unknown): WinterClassTable {
  const r = raw as Record<string, { value: unknown }>;
  const num = (k: string) => {
    const v = r[k]?.value;
    if (typeof v !== 'number') throw new Error(`data/winter-classes.json: brak „${k}”`);
    return v;
  };
  const d = r.sortedDays?.value;
  if (!Array.isArray(d) || d.length < 10 || d.some((x) => typeof x !== 'number')) throw new Error('data/winter-classes.json: „sortedDays” – lista liczb');
  return { elevationM: num('elevationM'), baseThresholdCm: num('baseThresholdCm'), sortedDays: d as number[], meanDays: num('meanDays') };
}

/** Miejsce zimy w rozkładzie wielolecia 0–1 (ranga środkowa – przy remisach połowa równych liczy się jako słabsze). */
export function winterPercentile(days: number, t: WinterClassTable): number {
  let below = 0;
  let equal = 0;
  for (const v of t.sortedDays) {
    if (v < days) below++;
    else if (v === days) equal++;
  }
  return (below + equal / 2) / t.sortedDays.length;
}

/** Klasa zimy 0–4 (kwintyle wielolecia): bardzo słaba … bardzo dobra. */
export function winterClass(days: number, t: WinterClassTable): number {
  return Math.min(4, Math.floor(winterPercentile(days, t) * 5));
}

export interface WinterDeps {
  profile: ClimateProfile;
  weatherParams: WeatherParams;
  snowParams: SnowParams;
  radiationParams: RadiationParams;
  riding: RidingParams;
  location: Location;
}

/** Dni sezonu (1 XII – 31 III) z bazą ≥ progu na otwartym terenie na wysokości odniesienia – zima (seed, rok). */
export function winterSkiDays(seed: number, startYear: number, t: WinterClassTable, d: WinterDeps): number {
  const weather = seasonWeather(d.profile, d.weatherParams, seed, startYear).slice(0, d.weatherParams.seasonLengthDays + 1);
  const run = runPointSnow({
    elevationM: t.elevationM,
    ...d.location,
    weather,
    profile: d.profile,
    weatherParams: d.weatherParams,
    snowParams: d.snowParams,
    radiationParams: d.radiationParams,
    weatherAtPointElevation: false,
  });
  return winterSnowDays(run.dates, run.sweMm, run.depthM, d.riding, [t.baseThresholdCm]).base[0];
}

/**
 * Ziarno pogody kariery: pierwsza zima nie może być z najsłabszych 20 % (start nie jest loterią).
 * Sprawdzamy kolejne ziarna od podanego; później zimy są już losowe (to samo ziarno).
 */
export function careerSeed(baseSeed: number, firstWinterYear: number, t: WinterClassTable, d: WinterDeps, maxTries = 50): { seed: number; days: number; tries: number } {
  let last = { seed: baseSeed, days: 0, tries: 0 };
  for (let i = 0; i < maxTries; i++) {
    const seed = baseSeed + i;
    const days = winterSkiDays(seed, firstWinterYear, t, d);
    last = { seed, days, tries: i + 1 };
    if (winterPercentile(days, t) >= 0.2) return last;
  }
  return last;
}
