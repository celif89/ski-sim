/**
 * Web Worker symulacji – tu wykonują się ciężkie obliczenia, żeby nie zacinać widoku.
 * W etapie 0 tylko generuje teren; w kolejnych etapach dojdzie tu pogoda, śnieg, goście itd.
 */
import { generateTerrain } from '../sim';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  try {
    switch (request.type) {
      case 'generateTerrain': {
        const startMs = performance.now();
        const grid = generateTerrain(request.map, request.params, request.seed);
        const buffer = grid.elevationM.buffer as ArrayBuffer;
        scope.postMessage(
          {
            type: 'terrainReady',
            widthCells: grid.widthCells,
            heightCells: grid.heightCells,
            cellSizeM: grid.cellSizeM,
            elevationBuffer: buffer,
            generationTimeMs: performance.now() - startMs,
          },
          [buffer],
        );
        break;
      }
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
