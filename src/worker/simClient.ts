/** Wątek główny: komunikacja z wątkiem obliczeń symulacji (Web Worker). */
import { TerrainGrid } from '../sim';
import type { CalendarDate, ContourLine } from '../sim';
import { unpackContours } from './protocol';
import type {
  DailyRadiationMessage,
  EnvironmentReadyMessage,
  EnvironmentStateMessage,
  InitEnvironmentRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

export interface PreparedTerrain {
  grid: TerrainGrid;
  /** Cieniowanie rzeźby 0–1 dla każdej komórki (NaN poza mapą). */
  hillshade: Float32Array;
  contours: ContourLine[];
  timingsMs: Record<string, number>;
}

/** Trwały wątek obliczeń. Pytania z numerem (requestId) – odpowiedzi trafiają do właściwej obietnicy. */
export class SimClient {
  private readonly worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (m: WorkerResponse) => void; reject: (e: Error) => void }>();
  private oneShot: { resolve: (m: WorkerResponse) => void; reject: (e: Error) => void } | null = null;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const m = event.data;
      const id = 'requestId' in m ? m.requestId : undefined;
      const target = id !== undefined ? this.pending.get(id) : this.oneShot;
      if (id !== undefined) this.pending.delete(id);
      else this.oneShot = null;
      if (!target) return;
      if (m.type === 'error') target.reject(new Error(m.message));
      else target.resolve(m);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Błąd w wątku symulacji');
      this.oneShot?.reject(error);
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    };
  }

  private send(request: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      if ('requestId' in request) this.pending.set(request.requestId, { resolve, reject });
      else this.oneShot = { resolve, reject };
      this.worker.postMessage(request, transfer);
    });
  }

  async prepareTerrain(request: WorkerRequest): Promise<PreparedTerrain> {
    const m = await this.send(request);
    if (m.type !== 'terrainReady') throw new Error('Nieoczekiwana odpowiedź wątku');
    const grid = new TerrainGrid(m.widthCells, m.heightCells, m.cellSizeM, m.elevation, m.georef ? { crs: 'EPSG:2180', ...m.georef } : null);
    grid.slopePercent.set(m.slopePercent);
    grid.aspectDeg.set(m.aspectDeg);
    return { grid, hillshade: m.hillshade, contours: unpackContours(m.contours), timingsMs: m.timingsMs };
  }

  async initEnvironment(request: InitEnvironmentRequest): Promise<EnvironmentReadyMessage> {
    const m = await this.send(request, [request.horizonAngleDeg.buffer, request.skyViewFactor.buffer] as ArrayBuffer[]);
    if (m.type !== 'environmentReady') throw new Error('Nieoczekiwana odpowiedź wątku');
    return m;
  }

  async environmentState(date: CalendarDate, hour: number): Promise<EnvironmentStateMessage> {
    const m = await this.send({ type: 'environmentState', requestId: this.nextId++, date, hour });
    if (m.type !== 'environmentState') throw new Error('Nieoczekiwana odpowiedź wątku');
    return m;
  }

  async dailyRadiation(date: CalendarDate): Promise<DailyRadiationMessage> {
    const m = await this.send({ type: 'dailyRadiation', requestId: this.nextId++, date });
    if (m.type !== 'dailyRadiation') throw new Error('Nieoczekiwana odpowiedź wątku');
    return m;
  }
}
