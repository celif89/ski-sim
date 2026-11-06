/** Wiadomości wymieniane między widokiem (wątek główny) a wątkami obliczeń (Web Worker). */
import type { SnowOps } from '../sim/snowOps';
import type {
  CalendarDate,
  ContourLine,
  ContourParams,
  EnvironmentStateMessage,
  HillshadeParams,
  HorizonDem,
  HorizonParams,
  Location,
  MapSettings,
  TerrainGeneratorParams,
} from './protocolTypes';

export type { EnvironmentStateMessage } from './protocolTypes';

interface TerrainJobCommon {
  hillshade: HillshadeParams;
  contours: ContourParams;
}

/** Wczytanie mapy z NMT: opis (map.json) i adres pliku wysokości. */
export interface LoadMapRequest extends TerrainJobCommon {
  type: 'loadMap';
  mapJson: unknown;
  elevationUrl: string;
}

/** Teren z generatora proceduralnego (etap 0) – zapas i testy. */
export interface GenerateTerrainRequest extends TerrainJobCommon {
  type: 'generateTerrain';
  map: MapSettings;
  params: TerrainGeneratorParams;
  seed: number;
}

/** Start modułu słońca i pogody (po policzeniu horyzontu). */
export interface InitEnvironmentRequest {
  type: 'initEnvironment';
  horizonDirections: number;
  horizonAngleDeg: Float32Array;
  skyViewFactor: Float32Array;
  climateJson: unknown;
  weatherJson: unknown;
  radiationJson: unknown;
  seed: number;
  location: Location;
}

/** Stan środowiska w danej chwili (czas lokalny). */
export interface EnvironmentStateRequest {
  type: 'environmentState';
  requestId: number;
  date: CalendarDate;
  hour: number;
}

/** Start modelu śniegu (po initEnvironment): pokrycie terenu i parametry śniegu. */
export interface InitSnowRequest {
  type: 'initSnow';
  forest: Float32Array;
  shrub: Float32Array;
  snowJson: unknown;
  /** data/guests.json – wpływ narciarzy na śnieg (etap 5). */
  guestsJson?: unknown;
  /** data/snowmaking.json – śnieg techniczny i ratrakowanie (etap 7). */
  snowmakingJson?: unknown;
}

/** Naśnieżanie i ratrakowanie z dnia `date` (etap 7) – dokładane na koniec dnia jak przejazdy. */
export interface SetOperationsRequest {
  type: 'setOperations';
  date: CalendarDate;
  ops: SnowOps;
}

/** Przejazdy gości w danym dniu (koniec dnia) – model śniegu dolicza ubijanie, zsuwanie i muldy. */
export interface SetTrafficRequest {
  type: 'setTraffic';
  date: CalendarDate;
  passes: Float32Array;
}

/** Stan śniegu na koniec dnia `date` (wątek doliczy brakujące dni sezonu). */
/** Zmiana pokrycia terenu (wycinka) – model śniegu liczy sezon od nowa. */
export interface SetLandCoverRequest {
  type: 'setLandCover';
  forest: Float32Array;
  shrub: Float32Array;
}

export interface SnowStateRequest {
  type: 'snowState';
  requestId: number;
  date: CalendarDate;
  /** Etap 6b: godzina dnia (śnieg na żywo, kroki godzinowe); brak – stan na koniec dnia. */
  hour?: number;
}

/** Suma dobowa promieniowania. */
export interface DailyRadiationRequest {
  type: 'dailyRadiation';
  requestId: number;
  date: CalendarDate;
}

/** Warstwice spakowane do tablic (szybkie przekazanie między wątkami bez kopiowania). */
export interface PackedContours {
  /** Wszystkie punkty wszystkich linii: x0, y0, x1, y1, … [m]. */
  coords: Float32Array;
  /** Indeks pierwszego punktu każdej linii w coords (w punktach, nie liczbach); ostatni = liczba punktów. */
  lineStart: Uint32Array;
  levelM: Float32Array;
  /** Bit 0 – pogrubiona, bit 1 – zamknięta. */
  flags: Uint8Array;
}

export interface TerrainReadyMessage {
  type: 'terrainReady';
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  georef: { westEastingM: number; northNorthingM: number } | null;
  elevation: Float32Array;
  slopePercent: Float32Array;
  aspectDeg: Float32Array;
  hillshade: Float32Array;
  contours: PackedContours;
  timingsMs: Record<string, number>;
}

export interface EnvironmentReadyMessage {
  type: 'environmentReady';
  bottomElevationM: number;
  topElevationM: number;
}

export interface DailyRadiationMessage {
  type: 'dailyRadiation';
  requestId: number;
  date: CalendarDate;
  sumKwhM2: Float32Array;
}

export interface SnowReadyMessage {
  type: 'snowReady';
}

export interface SnowProgressMessage {
  type: 'snowProgress';
  phase: 'radiation' | 'days' | 'hours';
  fraction: number;
  date?: CalendarDate;
}

export interface SnowStateMessage {
  type: 'snowState';
  requestId: number;
  date: CalendarDate;
  depthCm: Float32Array;
  sweMm: Float32Array;
  densityKgM3: Float32Array;
  quality: Uint8Array;
  moguls: Uint8Array;
  pileMm: Float32Array;
  techMm: Float32Array;
  liquidMm: Float32Array;
  /** Etap 6b: godzina stanu na żywo (brak – koniec dnia). */
  hour?: number;
  /** Czas liczenia kroków godzinowych tego pytania [ms] (pomiar wydajności). */
  liveMs?: number;
}

export interface WorkerErrorMessage {
  type: 'error';
  requestId?: number;
  message: string;
}

export type WorkerRequest =
  | LoadMapRequest
  | GenerateTerrainRequest
  | InitEnvironmentRequest
  | EnvironmentStateRequest
  | DailyRadiationRequest
  | InitSnowRequest
  | SetLandCoverRequest
  | SetTrafficRequest
  | SetOperationsRequest
  | SnowStateRequest;
export type WorkerResponse =
  | TerrainReadyMessage
  | EnvironmentReadyMessage
  | EnvironmentStateMessage
  | DailyRadiationMessage
  | SnowReadyMessage
  | SnowProgressMessage
  | SnowStateMessage
  | WorkerErrorMessage;

// ---------------------------------------------------------------- wątki horyzontu

export interface HorizonJob {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  georef: { westEastingM: number; northNorthingM: number } | null;
  elevation: Float32Array;
  dem: HorizonDem | null;
  params: HorizonParams;
  rowStart: number;
  rowEnd: number;
}

export type HorizonWorkerMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; rowStart: number; rowEnd: number; angleDeg: Float32Array; skyViewFactor: Float32Array };

// ---------------------------------------------------------------- warstwice

export function packContours(lines: ContourLine[]): PackedContours {
  let totalPoints = 0;
  for (const l of lines) totalPoints += l.points.length / 2;
  const coords = new Float32Array(totalPoints * 2);
  const lineStart = new Uint32Array(lines.length + 1);
  const levelM = new Float32Array(lines.length);
  const flags = new Uint8Array(lines.length);
  let p = 0;
  lines.forEach((l, n) => {
    lineStart[n] = p;
    coords.set(l.points, p * 2);
    p += l.points.length / 2;
    levelM[n] = l.levelM;
    flags[n] = (l.major ? 1 : 0) | (l.closed ? 2 : 0);
  });
  lineStart[lines.length] = p;
  return { coords, lineStart, levelM, flags };
}

export function unpackContours(packed: PackedContours): ContourLine[] {
  const lines: ContourLine[] = [];
  for (let n = 0; n < packed.levelM.length; n++) {
    lines.push({
      levelM: packed.levelM[n],
      major: (packed.flags[n] & 1) !== 0,
      closed: (packed.flags[n] & 2) !== 0,
      points: packed.coords.subarray(packed.lineStart[n] * 2, packed.lineStart[n + 1] * 2),
    });
  }
  return lines;
}
