/** Wątek główny: uruchamia Web Worker symulacji i odbiera od niego wyniki. */
import { TerrainGrid } from '../sim';
import type { ContourLine } from '../sim';
import { unpackContours } from './protocol';
import type { WorkerRequest, WorkerResponse } from './protocol';

export interface PreparedTerrain {
  grid: TerrainGrid;
  /** Cieniowanie rzeźby 0–1 dla każdej komórki (NaN poza mapą). */
  hillshade: Float32Array;
  contours: ContourLine[];
  timingsMs: Record<string, number>;
}

export function prepareTerrainInWorker(request: WorkerRequest): Promise<PreparedTerrain> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'terrainReady') {
        const grid = new TerrainGrid(
          message.widthCells,
          message.heightCells,
          message.cellSizeM,
          message.elevation,
          message.georef ? { crs: 'EPSG:2180', ...message.georef } : null,
        );
        grid.slopePercent.set(message.slopePercent);
        grid.aspectDeg.set(message.aspectDeg);
        resolve({
          grid,
          hillshade: message.hillshade,
          contours: unpackContours(message.contours),
          timingsMs: message.timingsMs,
        });
      } else {
        reject(new Error(message.message));
      }
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || 'Błąd w wątku symulacji'));
      worker.terminate();
    };
    worker.postMessage(request);
  });
}
