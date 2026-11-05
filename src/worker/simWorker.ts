/**
 * Web Worker symulacji – tu wykonują się ciężkie obliczenia, żeby nie zacinać widoku.
 * Etap 1: wczytanie mapy (lub generator), nachylenie, ekspozycja, cieniowanie rzeźby, warstwice.
 */
import {
  computeContours,
  computeHillshade,
  computeSlopeAndAspect,
  createGridFromMap,
  generateTerrain,
  parseMapDefinition,
} from '../sim';
import type { TerrainGrid } from '../sim';
import { packContours } from './protocol';
import type { TerrainReadyMessage, WorkerRequest, WorkerResponse } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

async function handle(request: WorkerRequest): Promise<void> {
  const timingsMs: Record<string, number> = {};
  let t = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    timingsMs[name] = Math.round(now - t);
    t = now;
  };

  let grid: TerrainGrid;
  if (request.type === 'loadMap') {
    const def = parseMapDefinition(request.mapJson);
    const response = await fetch(request.elevationUrl);
    if (!response.ok) throw new Error(`Nie udało się pobrać pliku wysokości (HTTP ${response.status})`);
    grid = createGridFromMap(def, await response.arrayBuffer());
    lap('wczytanie mapy');
  } else {
    grid = generateTerrain(request.map, request.params, request.seed);
    lap('generator terenu');
  }
  computeSlopeAndAspect(grid);
  lap('nachylenie i ekspozycja');
  const hillshade = computeHillshade(grid, request.hillshade);
  lap('cieniowanie');
  const contours = packContours(computeContours(grid, request.contours));
  lap('warstwice');

  const message: TerrainReadyMessage = {
    type: 'terrainReady',
    widthCells: grid.widthCells,
    heightCells: grid.heightCells,
    cellSizeM: grid.cellSizeM,
    georef: grid.georef ? { westEastingM: grid.georef.westEastingM, northNorthingM: grid.georef.northNorthingM } : null,
    elevation: grid.elevationM,
    slopePercent: grid.slopePercent,
    aspectDeg: grid.aspectDeg,
    hillshade,
    contours,
    timingsMs,
  };
  scope.postMessage(message, [
    grid.elevationM.buffer,
    grid.slopePercent.buffer,
    grid.aspectDeg.buffer,
    hillshade.buffer,
    contours.coords.buffer,
    contours.lineStart.buffer,
    contours.levelM.buffer,
    contours.flags.buffer,
  ] as ArrayBuffer[]);
}

scope.onmessage = (event) => {
  handle(event.data).catch((error: unknown) => {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
};
