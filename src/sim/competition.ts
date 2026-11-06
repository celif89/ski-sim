/**
 * Konkurencja (etap 6): wirtualne ośrodki w regionie. Śnieg naturalny z tej samej pogody (model
 * w punkcie, na wysokości ok. 1/3 między dołem a górą ośrodka – tam decyduje się otwarcie), do tego
 * naśnieżanie przy mrozie na części tras. Wynik: dzień po dniu – otwarte km tras i ocena śniegu.
 */
import type { CompetitorDef, EconomyParams } from './economyParams';
import type { RadiationParams } from './radiation';
import type { SnowParams } from './snow';
import { runPointSnow } from './snowPoint';
import { daysBetween } from './time';
import type { CalendarDate, Location } from './weather';
import { dailyAtElevation } from './weather';
import type { WeatherBook } from './weatherBook';

export interface CompetitorDay {
  name: string;
  open: boolean;
  kmOpen: number;
  /** Ocena śniegu 0–1. */
  snowScore: number;
  baseCm: number;
  dayPln: number;
  reputation: number;
}

export interface CompetitorSeason {
  startYear: number;
  /** Indeks dnia od 1 października (pierwszy dzień serii pogody). */
  firstDate: CalendarDate;
  days: CompetitorDay[][];
}

export interface CompetitionInput {
  book: WeatherBook;
  ep: EconomyParams;
  snowParams: SnowParams;
  radiationParams: RadiationParams;
  location: Location;
  packedDensityKgM3: number;
}

/** Sezon wszystkich konkurentów (tablica dni × konkurentów). */
export function competitorSeason(startYear: number, o: CompetitionInput): CompetitorSeason {
  const series = o.book.series(startYear);
  const c = o.ep.competitors;
  const days = series.length - 1;
  const perComp = c.list.map((def) => oneCompetitor(def, series, days, o));
  const out: CompetitorDay[][] = [];
  for (let d = 0; d < days; d++) out.push(perComp.map((pc) => pc[d]));
  return { startYear, firstDate: series[0].date, days: out };
}

function oneCompetitor(def: CompetitorDef, series: ReturnType<WeatherBook['series']>, days: number, o: CompetitionInput): CompetitorDay[] {
  const c = o.ep.competitors;
  const z = def.bottomM + (def.topM - def.bottomM) * 0.35;
  const natural = runPointSnow({
    elevationM: z,
    latDeg: o.location.latDeg,
    lonDeg: o.location.lonDeg,
    timeZone: o.location.timeZone,
    weather: series.slice(0, days + 1),
    profile: o.book.profile,
    weatherParams: o.book.weatherParams,
    snowParams: o.snowParams,
    radiationParams: o.radiationParams,
    weatherAtPointElevation: false,
  });
  const out: CompetitorDay[] = [];
  let madeMm = 0;
  for (let d = 0; d < days; d++) {
    const day = series[d];
    const date = day.date;
    const w = dailyAtElevation(day, z, o.book.profile, o.book.weatherParams);
    const inSeason = (date.month === 12 && date.day >= c.seasonStartDay) || (date.month >= 1 && date.month <= c.seasonEndMonth);
    const snowmakingWindow = date.month >= 11 || date.month <= c.seasonEndMonth;
    if (snowmakingWindow && w.tMeanC <= c.snowmakingMaxTempC) madeMm += c.snowmakingMmPerDay;
    if (w.tMeanC > 0) madeMm = Math.max(0, madeMm - c.meltMmPerDegreeDay * w.tMeanC);
    const natSwe = natural.sweMm[d] ?? 0;
    const madeBase = ((natSwe + madeMm) / o.packedDensityKgM3) * 100;
    const natBase = (natSwe / o.packedDensityKgM3) * 100;
    const madeOpen = madeBase >= c.openBaseCm;
    const natOpen = natBase >= c.openBaseCm;
    const open = inSeason && (madeOpen || natOpen);
    const share = (madeOpen ? def.snowmakingShare : 0) + (natOpen ? 1 - def.snowmakingShare : 0);
    const base = madeOpen ? madeBase : natBase;
    const rain = w.phase === 'rain';
    const snowScore = open ? Math.max(0, Math.min(1, 0.55 + 0.45 * Math.min(1, base / (2 * c.openBaseCm)) - (rain ? 0.2 : 0))) : 0;
    out.push({ name: def.name, open, kmOpen: open ? def.pisteKm * Math.min(1, share) : 0, snowScore, baseCm: base, dayPln: def.dayPln, reputation: def.reputation });
  }
  return out;
}

/** Stan konkurentów w dniu `date` (z policzonego sezonu). */
export function competitorsOn(season: CompetitorSeason, date: CalendarDate): CompetitorDay[] {
  const i = daysBetween(season.firstDate, date);
  if (i >= 0 && i < season.days.length) return season.days[i];
  return season.days[0].map((x) => ({ ...x, open: false, kmOpen: 0, snowScore: 0 }));
}
