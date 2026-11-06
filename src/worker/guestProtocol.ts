/**
 * Wiadomości między widokiem a wątkiem gości (guestWorker). Wątek trzyma dzień z gośćmi
 * (src/sim/guests.ts) i liczy go do godziny zegara gry; widok dostaje ramki z położeniami.
 */
import type { CalendarDate } from '../sim';
import type { GuestNet } from '../sim/guestNetwork';
import type { GuestCard, GuestConditions, GuestCounts, GuestDayReport, GuestEvent } from '../sim/guests';

export type GuestRequest =
  | { type: 'init'; paramsJson: unknown; seed: number; elevation: Float32Array }
  | { type: 'net'; net: GuestNet }
  | { type: 'day'; date: CalendarDate; guests: number; timeS: number }
  | { type: 'advance'; timeS: number; budgetMs: number }
  | { type: 'conditions'; cond: GuestConditions }
  | { type: 'snow'; quality: Uint8Array; depthCm: Float32Array; moguls: Float32Array | null; thin: Float32Array | null }
  | { type: 'card'; requestId: number; id: number }
  | { type: 'report'; requestId: number }
  | { type: 'traffic'; requestId: number }
  | { type: 'dayTraffic'; requestId: number };

export interface GuestFrameMessage {
  type: 'frame';
  date: CalendarDate | null;
  timeS: number;
  /** Liczba osób w `data` (po FRAME_STRIDE liczb) i stan wyciągów (po LIFT_STRIDE liczb). */
  count: number;
  data: Float32Array;
  lifts: Float32Array;
  events: GuestEvent[];
  counts: GuestCounts | null;
  done: boolean;
  /** Przewijanie do wybranej godziny: postęp 0–1 (null – zwykła ramka). */
  catchingUp: number | null;
}

export type GuestResponse =
  | GuestFrameMessage
  | { type: 'card'; requestId: number; card: GuestCard | null }
  | { type: 'report'; requestId: number; report: GuestDayReport | null }
  | { type: 'traffic'; requestId: number; perHour: Float32Array | null }
  | { type: 'dayTraffic'; requestId: number; date: CalendarDate | null; passes: Float32Array | null }
  | { type: 'error'; message: string };
