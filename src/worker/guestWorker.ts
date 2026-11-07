/**
 * Wątek gości: dzień z gośćmi (src/sim/guests.ts) liczony do godziny zegara gry. Widok tylko
 * odczytuje ramki (położenia, kolejki, zdarzenia). Przewijanie do wybranej godziny (nowy dzień,
 * zmiana ośrodka) w kawałkach, z postępem – wątek cały czas odpowiada na pytania.
 */
import { parseGuestParams } from '../sim/guestParams';
import type { GuestParams } from '../sim/guestParams';
import type { GuestNet } from '../sim/guestNetwork';
import type { GuestConditions, GuestSnow } from '../sim/guests';
import { FRAME_STRIDE, GuestDay, LIFT_STRIDE } from '../sim/guests';
import type { CalendarDate } from '../sim';
import type { SummerFacts } from '../sim/summer';
import { SUMMER_FRAME_STRIDE, SummerDay } from '../sim/summerGuests';
import { parseSummerParams } from '../sim/summerParams';
import type { GuestFrameMessage, GuestRequest, GuestResponse } from './guestProtocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<GuestRequest>) => void) | null;
  postMessage(message: GuestResponse, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let params: GuestParams | null = null;
let seed = 0;
let elevation: Float32Array | null = null;
let net: GuestNet | null = null;
let day: GuestDay | null = null;
/** Etap 7b: dzień letni (gdy trwa sezon letni) – zamiast dnia zimowego. */
let summer: { day: SummerDay; sf: SummerFacts; date: CalendarDate } | null = null;
const SUMMER_STEP_S = 2;
let dayInfo: { date: CalendarDate; guests: number; hours?: { openH: number; closeH: number }; typeShares?: number[] } | null = null;
let cond: GuestConditions | null = null;
let snow: GuestSnow | null = null;
/** Przewijanie w toku (numer – nowsze przerywa starsze) i cel. */
let catchUpId = 0;
let catchingUp = false;
let target = 0;

const yieldToEvents = () => new Promise<void>((r) => setTimeout(r, 0));
/** Liczenie do godziny zegara gry: wątek liczy bez przerwy (kawałkami, z ramką po każdym), aż dojdzie. */
let advanceTarget = 0;
let advancing = false;

async function runAdvanceSummer(budgetMs: number): Promise<void> {
  advancing = true;
  const s = summer;
  try {
    while (s && s === summer && s.day.t + SUMMER_STEP_S <= advanceTarget + 1e-9) {
      const start = performance.now();
      while (s.day.t + SUMMER_STEP_S <= advanceTarget + 1e-9 && performance.now() - start < budgetMs) s.day.step(SUMMER_STEP_S);
      frame(null);
      await yieldToEvents();
    }
  } finally {
    advancing = false;
  }
  frame(null);
}

async function runAdvance(budgetMs: number): Promise<void> {
  if (summer) return runAdvanceSummer(budgetMs);
  advancing = true;
  const d = day;
  let stepped = false;
  try {
    while (d && d === day && !catchingUp) {
      const dt = d.p.operation.stepS;
      if (d.t + dt > advanceTarget + 1e-9) break;
      const start = performance.now();
      while (d.t + dt <= advanceTarget + 1e-9 && performance.now() - start < budgetMs) {
        for (let k = 0; k < 10 && d.t + dt <= advanceTarget + 1e-9; k++) d.step(dt);
      }
      stepped = true;
      frame(null);
      await yieldToEvents();
    }
  } finally {
    advancing = false;
  }
  if (!stepped) frame(null);
}

function post(m: GuestResponse, transfer: Transferable[] = []): void {
  scope.postMessage(m, transfer);
}

function frame(catching: number | null): void {
  if (summer) {
    const sd = summer.day;
    const people = sd.gSize.reduce((a, b) => a + Math.min(12, b), 0);
    const data = new Float32Array((people + 64) * SUMMER_FRAME_STRIDE);
    const count = catching === null ? sd.writeFrame(data) : 0;
    const msg: GuestFrameMessage = { type: 'frame', date: summer.date, timeS: sd.t, count, data, lifts: new Float32Array(0), events: [], counts: null, done: sd.t >= 22 * 3600, catchingUp: catching };
    post(msg, [data.buffer]);
    return;
  }
  const d = day;
  const empty: GuestFrameMessage = { type: 'frame', date: dayInfo?.date ?? null, timeS: d?.t ?? 0, count: 0, data: new Float32Array(0), lifts: new Float32Array(0), events: [], counts: null, done: false, catchingUp: catching };
  if (!d) {
    post(empty);
    return;
  }
  const data = new Float32Array(d.n * FRAME_STRIDE + 64 * FRAME_STRIDE);
  const count = catching === null ? d.writeFrame(data) : 0;
  const lifts = new Float32Array(d.net.lifts.length * LIFT_STRIDE);
  d.writeLifts(lifts);
  const msg: GuestFrameMessage = { ...empty, timeS: d.t, count, data, lifts, events: d.takeEvents(), counts: d.counts(), done: d.done };
  post(msg, [data.buffer, lifts.buffer]);
}

function newDay(): void {
  if (!params || !net || !elevation || !dayInfo) {
    day = null;
    return;
  }
  day = new GuestDay(net, params, { seed, date: dayInfo.date, guests: dayInfo.guests, elevationM: elevation, hours: dayInfo.hours, typeShares: dayInfo.typeShares });
  if (cond) day.setConditions(cond);
  if (snow) day.setSnow(snow);
}

/** Przewinięcie dnia do godziny `to` w kawałkach po ok. 40 ms (z postępem). */
async function catchUpSummer(to: number): Promise<void> {
  const id = ++catchUpId;
  catchingUp = true;
  target = to;
  const s = summer!;
  const from = s.day.t;
  while (s.day.t + SUMMER_STEP_S <= target + 1e-9) {
    const start = performance.now();
    while (s.day.t + SUMMER_STEP_S <= target + 1e-9 && performance.now() - start < 40) s.day.step(SUMMER_STEP_S);
    frame(Math.min(1, (s.day.t - from) / Math.max(1, target - from)));
    await yieldToEvents();
    if (id !== catchUpId) return;
  }
  catchingUp = false;
  frame(null);
}

async function catchUp(to: number): Promise<void> {
  if (summer) return catchUpSummer(to);
  const id = ++catchUpId;
  catchingUp = true;
  target = to;
  const d = day;
  if (!d) {
    catchingUp = false;
    frame(null);
    return;
  }
  const from = d.t;
  const dt = d.p.operation.stepS;
  while (d.t + dt <= target + 1e-9) {
    const start = performance.now();
    while (d.t + dt <= target + 1e-9 && performance.now() - start < 40) {
      for (let k = 0; k < 20 && d.t + dt <= target + 1e-9; k++) d.step(dt);
    }
    frame(Math.min(1, (d.t - from) / Math.max(1, target - from)));
    await yieldToEvents();
    if (id !== catchUpId) return;
  }
  catchingUp = false;
  frame(null);
}

function handle(r: GuestRequest): void {
  switch (r.type) {
    case 'init':
      params = parseGuestParams(r.paramsJson);
      seed = r.seed;
      elevation = r.elevation;
      return;
    case 'net': {
      net = r.net;
      const t = day?.t ?? null;
      newDay();
      if (day && t !== null) void catchUp(t);
      else frame(null);
      return;
    }
    case 'day':
      dayInfo = { date: r.date, guests: r.guests, hours: r.hours, typeShares: r.typeShares };
      newDay();
      void catchUp(r.timeS);
      return;
    case 'advance': {
      if (catchingUp) {
        target = Math.max(target, r.timeS);
        return;
      }
      advanceTarget = r.timeS;
      if (!advancing) void runAdvance(r.budgetMs);
      return;
    }
    case 'conditions':
      cond = r.cond;
      day?.setConditions(r.cond);
      return;
    case 'snow':
      snow = { quality: r.quality, depthCm: r.depthCm, moguls: r.moguls, thin: r.thin };
      day?.setSnow(snow);
      return;
    case 'card':
      post({ type: 'card', requestId: r.requestId, card: day?.card(r.id) ?? null });
      return;
    case 'report':
      post({ type: 'report', requestId: r.requestId, report: day?.report() ?? null });
      return;
    case 'traffic': {
      const perHour = day ? day.trafficPerHour() : null;
      post({ type: 'traffic', requestId: r.requestId, perHour }, perHour ? [perHour.buffer] : []);
      return;
    }
    case 'summerDay': {
      if (!r.day) {
        summer = null;
        frame(null);
        return;
      }
      const sp = parseSummerParams(r.day.summerJson);
      summer = { day: new SummerDay(r.day.net, sp, { seed: r.day.seed, date: r.day.plan.date, plan: r.day.plan, personsPerCar: r.day.personsPerCar }), sf: r.day.sf, date: r.day.plan.date };
      void catchUp(r.day.timeS);
      return;
    }
    case 'summerEconomy': {
      const s = summer;
      post({ type: 'summerEconomy', requestId: r.requestId, date: s?.date ?? null, outcome: s && s.day.t >= 20 * 3600 ? s.day.outcome(s.sf) : null, stats: s ? s.day.stats : null });
      return;
    }
    case 'economy': {
      const summary = day ? day.economySummary() : null;
      post({ type: 'economy', requestId: r.requestId, date: dayInfo?.date ?? null, summary });
      return;
    }
    case 'dayTraffic': {
      const passes = day ? day.passes.slice() : null;
      post({ type: 'dayTraffic', requestId: r.requestId, date: dayInfo?.date ?? null, passes }, passes ? [passes.buffer] : []);
      return;
    }
  }
}

scope.onmessage = (event) => {
  try {
    handle(event.data);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
