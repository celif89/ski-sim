/** Wątek główny: komunikacja z wątkiem gości. */
import type { CalendarDate } from '../sim';
import type { GuestNet } from '../sim/guestNetwork';
import type { GuestCard, GuestConditions, GuestDayReport } from '../sim/guests';
import type { GuestFrameMessage, GuestRequest, GuestResponse } from './guestProtocol';

export class GuestClient {
  private readonly worker = new Worker(new URL('./guestWorker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private readonly pending = new Map<number, (m: GuestResponse) => void>();
  onFrame: ((f: GuestFrameMessage) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<GuestResponse>) => {
      const m = event.data;
      if (m.type === 'frame') {
        this.onFrame?.(m);
        return;
      }
      if (m.type === 'error') {
        this.onError?.(m.message);
        return;
      }
      const cb = this.pending.get(m.requestId);
      this.pending.delete(m.requestId);
      cb?.(m);
    };
    this.worker.onerror = (e) => this.onError?.(e.message || 'Błąd w wątku gości');
  }

  private post(r: GuestRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(r, transfer);
  }

  private ask<T extends GuestResponse>(make: (id: number) => GuestRequest): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, (m) => resolve(m as T));
      this.post(make(id));
    });
  }

  init(paramsJson: unknown, seed: number, elevation: Float32Array): void {
    this.post({ type: 'init', paramsJson, seed, elevation });
  }
  setNet(net: GuestNet): void {
    this.post({ type: 'net', net });
  }
  startDay(date: CalendarDate, guests: number, timeS: number): void {
    this.post({ type: 'day', date, guests, timeS });
  }
  advance(timeS: number, budgetMs: number): void {
    this.post({ type: 'advance', timeS, budgetMs });
  }
  setConditions(cond: GuestConditions): void {
    this.post({ type: 'conditions', cond });
  }
  setSnow(quality: Uint8Array, depthCm: Float32Array, moguls: Float32Array | null): void {
    this.post({ type: 'snow', quality, depthCm, moguls });
  }
  async card(id: number): Promise<GuestCard | null> {
    return (await this.ask<{ type: 'card'; requestId: number; card: GuestCard | null }>((requestId) => ({ type: 'card', requestId, id }))).card;
  }
  async report(): Promise<GuestDayReport | null> {
    return (await this.ask<{ type: 'report'; requestId: number; report: GuestDayReport | null }>((requestId) => ({ type: 'report', requestId }))).report;
  }
  async traffic(): Promise<Float32Array | null> {
    return (await this.ask<{ type: 'traffic'; requestId: number; perHour: Float32Array | null }>((requestId) => ({ type: 'traffic', requestId }))).perHour;
  }
  async dayTraffic(): Promise<{ date: CalendarDate | null; passes: Float32Array | null }> {
    return this.ask<{ type: 'dayTraffic'; requestId: number; date: CalendarDate | null; passes: Float32Array | null }>((requestId) => ({ type: 'dayTraffic', requestId }));
  }
}
