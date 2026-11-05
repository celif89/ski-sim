/**
 * Wątek obliczeń symulacji (Web Worker) – trzyma stan świata i odpowiada na pytania widoku.
 * Widok tylko odczytuje wyniki.
 *  – loadMap / generateTerrain: teren, nachylenie, ekspozycja, cieniowanie, warstwice,
 *  – initEnvironment: horyzont (policzony w wątkach pomocniczych), klimat, generator pogody,
 *  – environmentState: Słońce, pogoda, nasłonecznienie i temperatura w danej chwili,
 *  – dailyRadiation: suma dobowa promieniowania.
 */
import {
  computeContours,
  computeHillshade,
  computeSlopeAndAspect,
  createGridFromMap,
  generateTerrain,
  parseClimateProfile,
  parseMapDefinition,
  parseRadiationParams,
  parseWeatherParams,
} from '../sim';
import type { TerrainGrid } from '../sim';
import { Environment } from '../sim/environment';
import { packContours } from './protocol';
import type { TerrainReadyMessage, WorkerRequest, WorkerResponse } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let grid: TerrainGrid | null = null;
let environment: Environment | null = null;

async function handle(request: WorkerRequest): Promise<void> {
  switch (request.type) {
    case 'loadMap':
    case 'generateTerrain': {
      const timingsMs: Record<string, number> = {};
      let t = performance.now();
      const lap = (name: string) => {
        const now = performance.now();
        timingsMs[name] = Math.round(now - t);
        t = now;
      };
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
      // Kopie warstw dla widoku (wątek zachowuje oryginały do dalszych obliczeń).
      const message: TerrainReadyMessage = {
        type: 'terrainReady',
        widthCells: grid.widthCells,
        heightCells: grid.heightCells,
        cellSizeM: grid.cellSizeM,
        georef: grid.georef ? { westEastingM: grid.georef.westEastingM, northNorthingM: grid.georef.northNorthingM } : null,
        elevation: grid.elevationM.slice(),
        slopePercent: grid.slopePercent.slice(),
        aspectDeg: grid.aspectDeg.slice(),
        hillshade,
        contours,
        timingsMs,
      };
      scope.postMessage(message, [
        message.elevation.buffer,
        message.slopePercent.buffer,
        message.aspectDeg.buffer,
        hillshade.buffer,
        contours.coords.buffer,
        contours.lineStart.buffer,
        contours.levelM.buffer,
        contours.flags.buffer,
      ] as ArrayBuffer[]);
      return;
    }
    case 'initEnvironment': {
      if (!grid) throw new Error('Najpierw trzeba wczytać teren');
      environment = new Environment(
        grid,
        { directions: request.horizonDirections, angleDeg: request.horizonAngleDeg, skyViewFactor: request.skyViewFactor },
        parseClimateProfile(request.climateJson),
        parseWeatherParams(request.weatherJson),
        parseRadiationParams(request.radiationJson),
        request.seed,
        request.location,
      );
      scope.postMessage({ type: 'environmentReady', bottomElevationM: environment.bottomElevationM, topElevationM: environment.topElevationM });
      return;
    }
    case 'environmentState': {
      if (!environment) throw new Error('Moduł słońca i pogody nie jest gotowy');
      const state = environment.stateAt(request.date, request.hour);
      scope.postMessage({ type: 'environmentState', requestId: request.requestId, ...state }, [
        state.insolationWm2.buffer,
        state.temperatureC.buffer,
      ] as ArrayBuffer[]);
      return;
    }
    case 'dailyRadiation': {
      if (!environment) throw new Error('Moduł słońca i pogody nie jest gotowy');
      const sumKwhM2 = environment.dailyRadiation(request.date);
      scope.postMessage({ type: 'dailyRadiation', requestId: request.requestId, date: request.date, sumKwhM2 }, [sumKwhM2.buffer as ArrayBuffer]);
      return;
    }
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  handle(request).catch((error: unknown) => {
    scope.postMessage({
      type: 'error',
      requestId: 'requestId' in request ? request.requestId : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
