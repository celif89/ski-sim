/**
 * Wątek główny: liczenie horyzontu w kilku wątkach naraz (podział wierszy mapy) i zapis wyniku
 * w pamięci podręcznej przeglądarki (IndexedDB). Przy następnym uruchomieniu – odczyt z pamięci.
 */
import type { HorizonDem, HorizonField, HorizonParams, TerrainGrid } from '../sim';
import type { HorizonJob, HorizonWorkerMessage } from './protocol';

const DB_NAME = 'ski-sim';
const STORE = 'horizon';
/** Wersja algorytmu – zmiana unieważnia zapisane horyzonty. */
const ALGORITHM_VERSION = 1;
const MAX_WORKERS = 8;

/** Skrót (FNV-1a) danych wejściowych – klucz w pamięci podręcznej. */
function hashInputs(grid: TerrainGrid, dem: HorizonDem | null, params: HorizonParams): string {
  let h = 0x811c9dc5;
  const feed = (bytes: Uint8Array) => {
    for (let k = 0; k < bytes.length; k++) {
      h ^= bytes[k];
      h = Math.imul(h, 0x01000193);
    }
  };
  feed(new Uint8Array(grid.elevationM.buffer, grid.elevationM.byteOffset, grid.elevationM.byteLength));
  if (dem) feed(new Uint8Array(dem.elevationM.buffer, dem.elevationM.byteOffset, dem.elevationM.byteLength));
  feed(new TextEncoder().encode(JSON.stringify({ params, v: ALGORITHM_VERSION, w: grid.widthCells, h: grid.heightCells, g: grid.georef, d: dem && { ...dem, elevationM: null } })));
  return `h${(h >>> 0).toString(16)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCache(key: string): Promise<HorizonField | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result as { directions: number; angleDeg: ArrayBuffer; skyViewFactor: ArrayBuffer } | undefined;
        resolve(v ? { directions: v.directions, angleDeg: new Float32Array(v.angleDeg), skyViewFactor: new Float32Array(v.skyViewFactor) } : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeCache(key: string, field: HorizonField): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear(); // trzymamy tylko jeden (aktualny) horyzont
    store.put({ directions: field.directions, angleDeg: field.angleDeg.buffer.slice(0), skyViewFactor: field.skyViewFactor.buffer.slice(0) }, key);
  } catch {
    // Brak pamięci podręcznej (np. tryb prywatny) – nic się nie stanie, policzymy następnym razem.
  }
}

export async function computeHorizonCached(
  grid: TerrainGrid,
  dem: HorizonDem | null,
  params: HorizonParams,
  onProgress: (fraction: number) => void,
): Promise<{ field: HorizonField; fromCache: boolean; timeMs: number }> {
  const t0 = performance.now();
  const key = hashInputs(grid, dem, params);
  const cached = await readCache(key);
  if (cached && cached.angleDeg.length === grid.cellCount * params.directions) {
    return { field: cached, fromCache: true, timeMs: performance.now() - t0 };
  }
  const workers = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 4) - 1));
  const n = params.directions;
  const field: HorizonField = {
    directions: n,
    angleDeg: new Float32Array(grid.cellCount * n),
    skyViewFactor: new Float32Array(grid.cellCount),
  };
  // Więcej, mniejszych porcji niż wątków – równomierne obciążenie (góry liczą się dłużej niż doliny).
  const chunks: [number, number][] = [];
  const chunkRows = Math.max(4, Math.ceil(grid.heightCells / (workers * 4)));
  for (let r = 0; r < grid.heightCells; r += chunkRows) chunks.push([r, Math.min(grid.heightCells, r + chunkRows)]);
  let doneRows = 0;
  const partial = new Map<number, number>();
  const report = () => {
    let p = doneRows;
    for (const v of partial.values()) p += v;
    onProgress(p / grid.heightCells);
  };
  const queue = [...chunks];
  await Promise.all(
    Array.from({ length: workers }, async (_, wi) => {
      const worker = new Worker(new URL('./horizonWorker.ts', import.meta.url), { type: 'module' });
      try {
        for (let chunk = queue.shift(); chunk; chunk = queue.shift()) {
          const [rowStart, rowEnd] = chunk;
          const job: HorizonJob = {
            widthCells: grid.widthCells,
            heightCells: grid.heightCells,
            cellSizeM: grid.cellSizeM,
            georef: grid.georef ? { westEastingM: grid.georef.westEastingM, northNorthingM: grid.georef.northNorthingM } : null,
            elevation: grid.elevationM,
            dem,
            params,
            rowStart,
            rowEnd,
          };
          await new Promise<void>((resolve, reject) => {
            worker.onmessage = (event: MessageEvent<HorizonWorkerMessage>) => {
              const m = event.data;
              if (m.type === 'progress') {
                partial.set(wi, m.fraction * (rowEnd - rowStart));
                report();
                return;
              }
              field.angleDeg.set(m.angleDeg, m.rowStart * grid.widthCells * n);
              field.skyViewFactor.set(m.skyViewFactor, m.rowStart * grid.widthCells);
              partial.delete(wi);
              doneRows += rowEnd - rowStart;
              report();
              resolve();
            };
            worker.onerror = (e) => reject(new Error(e.message || 'Błąd w wątku horyzontu'));
            worker.postMessage(job);
          });
        }
      } finally {
        worker.terminate();
      }
    }),
  );
  await writeCache(key, field);
  return { field, fromCache: false, timeMs: performance.now() - t0 };
}
