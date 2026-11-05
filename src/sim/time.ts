/**
 * Czas w grze: kalendarz, czas lokalny z czasem zimowym i letnim (zasada UE), dzień juliański.
 *
 * W całej symulacji chwila to liczba milisekund od 1970-01-01 00:00 UTC (jak Date.getTime()).
 * Czas lokalny = UTC + przesunięcie strefy (+1 h zimą, +2 h latem w Polsce).
 * Zasada UE: czas letni od ostatniej niedzieli marca 01:00 UTC do ostatniej niedzieli
 * października 01:00 UTC (dyrektywa 2000/84/WE).
 */

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export interface TimeZoneRule {
  /** Przesunięcie czasu standardowego (zimowego) względem UTC [h]; Polska: +1. */
  standardOffsetHours: number;
  /** Czy obowiązuje czas letni wg zasady UE (+1 h). */
  euDaylightSaving: boolean;
}

export interface LocalDateTime {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  /** Godzina z ułamkiem (np. 13,5 = 13:30). */
  hour: number;
}

/** Chwila UTC ostatniej niedzieli danego miesiąca o 01:00 UTC. */
function lastSundayAt0100Utc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)); // dzień 0 następnego miesiąca = ostatni dzień
  const dow = lastDay.getUTCDay(); // 0 = niedziela
  return Date.UTC(year, month - 1, lastDay.getUTCDate() - dow, 1);
}

/** Czy w danej chwili UTC obowiązuje czas letni (zasada UE). */
export function isEuSummerTime(utcMs: number): boolean {
  const year = new Date(utcMs).getUTCFullYear();
  return utcMs >= lastSundayAt0100Utc(year, 3) && utcMs < lastSundayAt0100Utc(year, 10);
}

/** Przesunięcie czasu lokalnego względem UTC [h] w danej chwili. */
export function utcOffsetHours(utcMs: number, tz: TimeZoneRule): number {
  return tz.standardOffsetHours + (tz.euDaylightSaving && isEuSummerTime(utcMs) ? 1 : 0);
}

/** Czas lokalny → chwila UTC [ms]. W godzinie „podwójnej” (zmiana na zimowy) wybiera czas letni. */
export function localToUtcMs(local: LocalDateTime, tz: TimeZoneRule): number {
  const naive = Date.UTC(local.year, local.month - 1, local.day) + local.hour * MS_PER_HOUR;
  const guess = naive - tz.standardOffsetHours * MS_PER_HOUR;
  const offset = utcOffsetHours(guess - MS_PER_HOUR, tz);
  return naive - offset * MS_PER_HOUR;
}

/** Chwila UTC → czas lokalny. */
export function utcMsToLocal(utcMs: number, tz: TimeZoneRule): LocalDateTime & { summerTime: boolean } {
  const offset = utcOffsetHours(utcMs, tz);
  const shifted = new Date(utcMs + offset * MS_PER_HOUR);
  const hour =
    shifted.getUTCHours() + shifted.getUTCMinutes() / 60 + shifted.getUTCSeconds() / 3600 + shifted.getUTCMilliseconds() / MS_PER_HOUR;
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour,
    summerTime: offset !== tz.standardOffsetHours,
  };
}

/** Dzień juliański (JD) dla chwili UTC. */
export function julianDay(utcMs: number): number {
  return utcMs / MS_PER_DAY + 2440587.5;
}

/** Numer dnia w roku (1 = 1 stycznia). */
export function dayOfYear(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / MS_PER_DAY) + 1;
}

/** Liczba dni w miesiącu. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Data kalendarzowa (bez godziny) przesunięta o n dni. */
export function addDays(date: { year: number; month: number; day: number }, n: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day) + n * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Liczba dni od daty a do daty b (b − a). */
export function daysBetween(a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY);
}

/** Zapis daty „RRRR-MM-DD”. */
export function formatIsoDate(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function parseIsoDate(text: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) throw new Error(`Zły format daty „${text}” (oczekiwano RRRR-MM-DD)`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}
