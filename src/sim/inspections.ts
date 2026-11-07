/**
 * Przeglądy wyciągów (etap 7b): każdy wyciąg ma badanie okresowe ważne rok; gracz wybiera termin
 * przeglądu, a wyciąg w przeglądzie nie wozi (kolej latem – konflikt z sezonem letnim). Wyciąg bez
 * ważnego przeglądu stoi. Domyślny termin – listopad (między sezonami). Koszt przeglądu (economy.json)
 * płacony w dniu rozpoczęcia.
 */
import type { EconomyParams } from './economyParams';
import type { SummerParams } from './summerParams';
import { addDays, daysBetween, formatIsoDate, parseIsoDate } from './time';
import type { CalendarDate } from './weather';

export interface InspectionState {
  /** Do kiedy ważne badanie (włącznie); null – jeszcze nie odebrany (w budowie). */
  validUntil: string | null;
  /** Zaplanowany początek następnego przeglądu. */
  scheduled: string | null;
  /** Trwający przegląd – ostatni dzień (włącznie). */
  activeUntil: string | null;
}

export type InspectionStatus = 'ok' | 'inspection' | 'expired' | 'none';

export const INSPECTION_STATUS_NAMES: Record<InspectionStatus, string> = { ok: 'ważny przegląd', inspection: 'w przeglądzie', expired: 'brak ważnego przeglądu – stoi', none: 'odbiór po budowie' };

interface StateLike {
  inspections?: Record<string, InspectionState>;
}

/** Status wyciągu w danym dniu. */
export function inspectionStatus(state: StateLike, liftId: string, date: CalendarDate): InspectionStatus {
  const s = state.inspections?.[liftId];
  if (!s) return 'ok'; // stare zapisy i gra bez przeglądów – bez ograniczeń
  if (s.activeUntil && daysBetween(date, parseIsoDate(s.activeUntil)) >= 0) return 'inspection';
  if (!s.validUntil) return 'none';
  return daysBetween(date, parseIsoDate(s.validUntil)) >= 0 ? 'ok' : 'expired';
}

export function liftCanRun(state: StateLike, liftId: string, date: CalendarDate): boolean {
  return inspectionStatus(state, liftId, date) === 'ok';
}

/** Domyślny termin przeglądu: najpóźniejszy dzień domyślny (np. 3 XI) nie później niż koniec ważności. */
export function defaultInspectionDate(validUntil: CalendarDate, sp: SummerParams): CalendarDate {
  let y = validUntil.year;
  for (;;) {
    const d = { year: y, month: sp.inspections.defaultMonth, day: sp.inspections.defaultDay };
    if (daysBetween(d, validUntil) >= 0) return d;
    y--;
  }
}

/** Wyciąg zbudowany (odbiór) – ważność od dziś, następny przegląd domyślnie przed końcem ważności. */
export function registerLift(state: StateLike, liftId: string, date: CalendarDate, sp: SummerParams): void {
  state.inspections ??= {};
  const valid = addDays(date, sp.inspections.validityDays);
  state.inspections[liftId] = { validUntil: formatIsoDate(valid), scheduled: formatIsoDate(defaultInspectionDate(valid, sp)), activeUntil: null };
}

/** Gracz ustala termin przeglądu (null – bez terminu). Zwraca komunikat błędu albo null. */
export function scheduleInspection(state: StateLike, liftId: string, date: CalendarDate | null, today: CalendarDate): string | null {
  const s = state.inspections?.[liftId];
  if (!s) return 'Wyciąg nie jest jeszcze odebrany.';
  if (s.activeUntil) return 'Przegląd właśnie trwa.';
  if (date && daysBetween(today, date) < 0) return 'Termin nie może być w przeszłości.';
  s.scheduled = date ? formatIsoDate(date) : null;
  return null;
}

/**
 * Dzień: rozpoczęcie zaplanowanych przeglądów (koszt), zakończenie trwających (ważność na rok).
 * Zwraca koszt i komunikaty.
 */
export function processInspections(
  state: StateLike,
  date: CalendarDate,
  lifts: { id: string; name: string; aerial: boolean; built: boolean }[],
  ep: EconomyParams,
  sp: SummerParams,
): { costPln: number; messages: string[] } {
  state.inspections ??= {};
  let cost = 0;
  const messages: string[] = [];
  const iso = formatIsoDate(date);
  for (const l of lifts) {
    let s = state.inspections[l.id];
    if (!l.built) continue;
    if (!s) {
      registerLift(state, l.id, date, sp);
      s = state.inspections[l.id];
    }
    if (s.activeUntil && daysBetween(parseIsoDate(s.activeUntil), date) > 0) {
      s.activeUntil = null;
      const valid = addDays(date, sp.inspections.validityDays - 1);
      s.validUntil = formatIsoDate(valid);
      s.scheduled = formatIsoDate(defaultInspectionDate(valid, sp));
      messages.push(`${l.name}: przegląd zakończony, ważny do ${s.validUntil}.`);
    }
    if (!s.activeUntil && s.scheduled === iso) {
      const days = l.aerial ? sp.inspections.aerialDays : sp.inspections.surfaceDays;
      s.activeUntil = formatIsoDate(addDays(date, Math.max(1, Math.round(days)) - 1));
      s.scheduled = null;
      cost += l.aerial ? ep.costs.inspectionAerialPln : ep.costs.inspectionSurfacePln;
      messages.push(`${l.name}: przegląd do ${s.activeUntil} – wyciąg nie wozi.`);
    }
  }
  for (const id of Object.keys(state.inspections)) if (!lifts.some((l) => l.id === id)) delete state.inspections[id];
  return { costPln: cost, messages };
}
