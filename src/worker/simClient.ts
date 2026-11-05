/** Wątek główny: uruchamia Web Worker symulacji i odbiera od niego wyniki. */
import { TerrainGrid } from '../sim';
import type { MapSettings, TerrainGeneratorParams } from '../sim';
import type { WorkerRequest, WorkerResponse } from './protocol';

export function generateTerrainInWorker(
  map: MapSettings,
  params: TerrainGeneratorParams,
  seed: number,
): Promise<{ grid: TerrainGrid; generationTimeMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'terrainReady') {
        const grid = new TerrainGrid(
          message.widthCells,
          message.heightCells,
          message.cellSizeM,
          new Float32Array(message.elevationBuffer),
        );
        resolve({ grid, generationTimeMs: message.generationTimeMs });
      } else {
        reject(new Error(message.message));
      }
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || 'Błąd w wątku symulacji'));
      worker.terminate();
    };
    const request: WorkerRequest = { type: 'generateTerrain', map, params, seed };
    worker.postMessage(request);
  });
}
