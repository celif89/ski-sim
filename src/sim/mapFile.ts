/**
 * Mapa gry zapisana w plikach: data/maps/<mapa>/map.json (opis) + elevation.f32 (wysokości).
 * Tutaj: odczyt opisu i zbudowanie z niego siatki terenu. Bez dostępu do plików – dane podaje
 * wywołujący (przeglądarka pobiera je przez sieć, testy czytają z dysku).
 */
import { readNumber, readSection } from './params';
import type { HorizonDem } from './horizon';
import { TerrainGrid } from './terrainGrid';

export interface ControlPoint {
  name: string;
  eastingM: number;
  northingM: number;
  /** Wysokość z usługi GUGiK w dniu importu [m n.p.m.] (brak przed pierwszym importem). */
  geoportalElevationM?: number;
  latDeg?: number;
  lonDeg?: number;
}

export interface MapDefinition {
  name: string;
  crs: string;
  westEastingM: number;
  northNorthingM: number;
  cellSizeM: number;
  widthCells: number;
  heightCells: number;
  elevationFile: string;
  controlPoints: ControlPoint[];
  /** Linie granicy państwa w PUWG 1992: [[E, N], …]. */
  borderLines: number[][][];
  /** Opis modelu terenu okolicy (do horyzontu); null, gdy brak. */
  horizonDem: Omit<HorizonDem, 'elevationM'> & { file: string } | null;
}

const FILE = 'map.json';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function parseMapDefinition(raw: unknown): MapDefinition {
  if (!isRecord(raw)) throw new Error(`${FILE}: oczekiwano obiektu JSON`);
  const bounds = readSection(raw, 'bounds', FILE);
  const west = readNumber(bounds, 'westEastingM', FILE);
  const east = readNumber(bounds, 'eastEastingM', FILE);
  const south = readNumber(bounds, 'southNorthingM', FILE);
  const north = readNumber(bounds, 'northNorthingM', FILE);
  const cellSizeM = readNumber(raw, 'cellSizeM', FILE, { min: 0.1 });
  const widthCells = (east - west) / cellSizeM;
  const heightCells = (north - south) / cellSizeM;
  if (!Number.isInteger(widthCells) || !Number.isInteger(heightCells) || widthCells < 2 || heightCells < 2) {
    throw new Error(`${FILE}: granice mapy muszą być wielokrotnością rozmiaru komórki`);
  }
  if (raw.crs !== 'EPSG:2180') throw new Error(`${FILE}: obsługiwany jest tylko układ EPSG:2180 (PUWG 1992)`);
  if (typeof raw.elevationFile !== 'string') throw new Error(`${FILE}: brak pola elevationFile`);

  const controlPoints: ControlPoint[] = [];
  if (Array.isArray(raw.controlPoints)) {
    for (const p of raw.controlPoints) {
      if (!isRecord(p) || typeof p.name !== 'string' || typeof p.eastingM !== 'number' || typeof p.northingM !== 'number') {
        throw new Error(`${FILE}: zły format punktu kontrolnego`);
      }
      controlPoints.push({
        name: p.name,
        eastingM: p.eastingM,
        northingM: p.northingM,
        geoportalElevationM: typeof p.geoportalElevationM === 'number' ? p.geoportalElevationM : undefined,
        latDeg: typeof p.latDeg === 'number' ? p.latDeg : undefined,
        lonDeg: typeof p.lonDeg === 'number' ? p.lonDeg : undefined,
      });
    }
  }

  const borderLines: number[][][] = [];
  if (isRecord(raw.border) && Array.isArray(raw.border.lines)) {
    for (const line of raw.border.lines) {
      if (Array.isArray(line)) borderLines.push(line.filter((pt): pt is number[] => Array.isArray(pt) && pt.length === 2));
    }
  }

  let horizonDem: MapDefinition['horizonDem'] = null;
  if (isRecord(raw.horizonDem)) {
    const hd = raw.horizonDem;
    if (typeof hd.file !== 'string') throw new Error(`${FILE}: horizonDem bez pola file`);
    horizonDem = {
      file: hd.file,
      westEastingM: readNumber(hd, 'westEastingM', FILE),
      northNorthingM: readNumber(hd, 'northNorthingM', FILE),
      cellSizeM: readNumber(hd, 'cellSizeM', FILE, { min: 1 }),
      widthCells: readNumber(hd, 'widthCells', FILE, { integer: true, min: 2 }),
      heightCells: readNumber(hd, 'heightCells', FILE, { integer: true, min: 2 }),
    };
  }

  return {
    name: typeof raw.name === 'string' ? raw.name : 'mapa',
    crs: raw.crs,
    westEastingM: west,
    northNorthingM: north,
    cellSizeM,
    widthCells,
    heightCells,
    elevationFile: raw.elevationFile,
    controlPoints,
    borderLines,
    horizonDem,
  };
}

/** Model terenu okolicy z opisu mapy i zawartości pliku (Float32, little-endian). */
export function createHorizonDem(def: MapDefinition, buffer: ArrayBuffer): HorizonDem {
  const d = def.horizonDem;
  if (!d) throw new Error('Mapa nie ma modelu terenu okolicy (horizonDem) – uruchom npm run import-horizon-dem');
  return { ...d, elevationM: readFloat32LE(buffer, d.widthCells * d.heightCells) };
}

function readFloat32LE(buffer: ArrayBuffer, count: number): Float32Array {
  if (buffer.byteLength !== count * 4) throw new Error(`Plik ma ${buffer.byteLength} B, oczekiwano ${count * 4} B`);
  const view = new DataView(buffer);
  const out = new Float32Array(count);
  for (let k = 0; k < count; k++) out[k] = view.getFloat32(k * 4, true);
  return out;
}

/**
 * Buduje siatkę terenu z opisu mapy i zawartości pliku wysokości (Float32, little-endian).
 */
export function createGridFromMap(def: MapDefinition, elevationBuffer: ArrayBuffer): TerrainGrid {
  const expectedBytes = def.widthCells * def.heightCells * 4;
  if (elevationBuffer.byteLength !== expectedBytes) {
    throw new Error(`Plik wysokości ma ${elevationBuffer.byteLength} B, oczekiwano ${expectedBytes} B`);
  }
  const elevation = readFloat32LE(elevationBuffer, def.widthCells * def.heightCells);
  return new TerrainGrid(def.widthCells, def.heightCells, def.cellSizeM, elevation, {
    crs: 'EPSG:2180',
    westEastingM: def.westEastingM,
    northNorthingM: def.northNorthingM,
  });
}
