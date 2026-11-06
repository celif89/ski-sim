/**
 * Kalendarz gry (etap 6): pory roku (lato – budowa, jesień – przygotowania, zima – eksploatacja,
 * wiosna – raport sezonu), dzień tygodnia, ferie zimowe w turach według województw (wzór z roku
 * szkolnego 2025/26 przenoszony na kolejne lata – ten sam tydzień ISO), przerwa świąteczna.
 */
import type { EconomyParams } from './economyParams';
import { addDays, daysBetween, parseIsoDate } from './time';
import type { CalendarDate } from './weather';

export type YearPhase = 'summer' | 'autumn' | 'winter' | 'spring';
export const PHASE_NAMES: Record<YearPhase, string> = { summer: 'lato – budowa', autumn: 'jesień – przygotowania', winter: 'zima – sezon', spring: 'wiosna – koniec sezonu' };

/** Dzień tygodnia: 0 – poniedziałek … 6 – niedziela. */
export function weekdayIndex(d: CalendarDate): number {
  const ms = Date.UTC(d.year, d.month - 1, d.day);
  return (new Date(ms).getUTCDay() + 6) % 7;
}

export function yearPhase(d: CalendarDate, p: EconomyParams): YearPhase {
  const c = p.calendar;
  const m = d.month;
  const inRange = (from: number, to: number) => (from <= to ? m >= from && m < to : m >= from || m < to);
  if (inRange(c.summerStartMonth, c.autumnStartMonth)) return 'summer';
  if (inRange(c.autumnStartMonth, c.winterStartMonth)) return 'autumn';
  if (inRange(c.winterStartMonth, c.springStartMonth)) return 'winter';
  return 'spring';
}

/** Rok początku sezonu (sezon od października – jak pogoda): grudzień 2026 i luty 2027 → 2026. */
export function seasonStartYear(d: CalendarDate, seasonStartMonth = 10): number {
  return d.month >= seasonStartMonth ? d.year : d.year - 1;
}

/** Poniedziałek tygodnia ISO `week` w roku `year`. */
export function isoWeekMonday(year: number, week: number): CalendarDate {
  const jan4 = { year, month: 1, day: 4 };
  const monday1 = addDays(jan4, -weekdayIndex(jan4));
  return addDays(monday1, (week - 1) * 7);
}

/** Numer tygodnia ISO daty. */
export function isoWeek(d: CalendarDate): { year: number; week: number } {
  const thursday = addDays(d, 3 - weekdayIndex(d));
  const jan4 = { year: thursday.year, month: 1, day: 4 };
  const monday1 = addDays(jan4, -weekdayIndex(jan4));
  return { year: thursday.year, week: Math.floor(daysBetween(monday1, thursday) / 7) + 1 };
}

export interface FeriaPeriod {
  from: CalendarDate;
  /** Pierwszy dzień po feriach. */
  to: CalendarDate;
  regions: string[];
}

/** Tury ferii w danym roku kalendarzowym (styczeń–marzec roku `year`). */
export function feriePeriods(year: number, p: EconomyParams): FeriaPeriod[] {
  return p.ferie.turns.map((t) => {
    const w = isoWeek(parseIsoDate(t.start)).week;
    const monday = isoWeekMonday(year, w);
    const from = addDays(monday, -2); // sobota przed
    return { from, to: addDays(from, p.ferie.durationDays), regions: t.regions };
  });
}

const inPeriod = (d: CalendarDate, a: CalendarDate, b: CalendarDate) => daysBetween(a, d) >= 0 && daysBetween(d, b) > 0;

/** Udział gości (wg wag regionów) z regionów, które mają dziś ferie (0–1). */
export function feriaShare(d: CalendarDate, p: EconomyParams): { share: number; regions: string[] } {
  if (d.month > 4 && d.month < 12) return { share: 0, regions: [] };
  const regions: string[] = [];
  let share = 0;
  for (const f of feriePeriods(d.year, p)) {
    if (!inPeriod(d, f.from, f.to)) continue;
    for (const r of f.regions) {
      regions.push(r);
      share += p.ferie.regionWeights[r] ?? 0;
    }
  }
  return { share: Math.min(1, share), regions };
}

/** Przerwa świąteczna (od christmasStartDay grudnia do 1 stycznia włącznie). */
export function isChristmasBreak(d: CalendarDate, p: EconomyParams): boolean {
  return (d.month === 12 && d.day >= p.demand.christmasStartDay) || (d.month === 1 && d.day === 1);
}

export type DayKind = 'weekday' | 'weekend' | 'holiday';

export interface DayInfo {
  weekday: number;
  phase: YearPhase;
  kind: DayKind;
  christmas: boolean;
  feria: { share: number; regions: string[] };
  /** Opis dla panelu („sobota, ferie: śląskie”). */
  label: string;
}

const DAY_NAMES = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];

export function dayInfo(d: CalendarDate, p: EconomyParams): DayInfo {
  const weekday = weekdayIndex(d);
  const christmas = isChristmasBreak(d, p);
  const feria = feriaShare(d, p);
  const publicHoliday = d.month === 1 && (d.day === 1 || d.day === 6);
  const kind: DayKind = christmas || feria.share > 0.2 ? 'holiday' : weekday >= 5 || publicHoliday ? 'weekend' : 'weekday';
  const parts = [DAY_NAMES[weekday]];
  if (christmas) parts.push('przerwa świąteczna');
  if (d.month === 12 && d.day === 31) parts.push('Sylwester');
  if (publicHoliday) parts.push('święto');
  if (feria.regions.length) parts.push(`ferie: ${feria.regions.join(', ')}`);
  return { weekday, phase: yearPhase(d, p), kind, christmas, feria, label: parts.join(', ') };
}
