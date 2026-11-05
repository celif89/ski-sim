/** Ustawienia symulacji odczytywane z data/settings.json. */
import { readNumber, readSection } from './params';

/** Wymiary siatki terenu. */
export interface MapSettings {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
}

export interface SimSettings {
  seed: number;
  /** Nazwa mapy z data/maps/ albo „procedural” (generator z etapu 0). */
  mapName: string;
  /** Nazwa profilu klimatycznego z data/climate/. */
  climateProfile: string;
  startDate: string;
  startHour: number;
  playDayDurationS: number;
  fallbackLocation: { latDeg: number; lonDeg: number };
}

const FILE = 'data/settings.json';

export function parseSimSettings(raw: unknown): SimSettings {
  const world = readSection(raw, 'world', FILE);
  const terrain = readSection(raw, 'terrain', FILE);
  if (typeof terrain.map !== 'string' || terrain.map.length === 0) throw new Error(`${FILE}: brak nazwy mapy (terrain.map)`);
  const climate = readSection(raw, 'climate', FILE);
  const time = readSection(raw, 'time', FILE);
  const loc = readSection(raw, 'fallbackLocation', FILE);
  if (typeof climate.profile !== 'string') throw new Error(`${FILE}: brak climate.profile`);
  if (typeof time.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(time.startDate)) throw new Error(`${FILE}: zła data time.startDate`);
  return {
    seed: readNumber(world, 'seed', FILE, { integer: true }),
    mapName: terrain.map,
    climateProfile: climate.profile,
    startDate: time.startDate,
    startHour: readNumber(time, 'startHour', FILE, { min: 0, max: 24 }),
    playDayDurationS: readNumber(time, 'playDayDurationS', FILE, { min: 1 }),
    fallbackLocation: { latDeg: readNumber(loc, 'latDeg', FILE, { min: -90, max: 90 }), lonDeg: readNumber(loc, 'lonDeg', FILE, { min: -180, max: 180 }) },
  };
}

export function parseGridSettings(section: Record<string, unknown>, file: string): MapSettings {
  return {
    widthCells: readNumber(section, 'widthCells', file, { integer: true, min: 2 }),
    heightCells: readNumber(section, 'heightCells', file, { integer: true, min: 2 }),
    cellSizeM: readNumber(section, 'cellSizeM', file, { min: 0.1 }),
  };
}
