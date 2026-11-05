/** Wątek pomocniczy: horyzont dla części wierszy mapy (praca dzielona na kilka wątków). */
import { TerrainGrid, computeHorizonRows } from '../sim';
import type { HorizonJob, HorizonWorkerMessage } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<HorizonJob>) => void) | null;
  postMessage(message: HorizonWorkerMessage, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const job = event.data;
  const grid = new TerrainGrid(
    job.widthCells,
    job.heightCells,
    job.cellSizeM,
    job.elevation,
    job.georef ? { crs: 'EPSG:2180', ...job.georef } : null,
  );
  const n = job.params.directions;
  const rows = job.rowEnd - job.rowStart;
  const field = {
    directions: n,
    angleDeg: new Float32Array(rows * job.widthCells * n),
    skyViewFactor: new Float32Array(rows * job.widthCells),
  };
  let lastReport = 0;
  computeHorizonRows(
    grid,
    job.dem,
    job.params,
    job.rowStart,
    job.rowEnd,
    field,
    (fraction) => {
      const now = performance.now();
      if (now - lastReport > 200) {
        lastReport = now;
        scope.postMessage({ type: 'progress', fraction });
      }
    },
    job.rowStart,
  );
  const { angleDeg, skyViewFactor } = field;
  scope.postMessage({ type: 'done', rowStart: job.rowStart, rowEnd: job.rowEnd, angleDeg, skyViewFactor }, [
    angleDeg.buffer,
    skyViewFactor.buffer,
  ] as ArrayBuffer[]);
};
