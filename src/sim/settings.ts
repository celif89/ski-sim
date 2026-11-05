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
}

const FILE = 'data/settings.json';

export function parseSimSettings(raw: unknown): SimSettings {
  const world = readSection(raw, 'world', FILE);
  const terrain = readSection(raw, 'terrain', FILE);
  if (typeof terrain.map !== 'string' || terrain.map.length === 0) throw new Error(`${FILE}: brak nazwy mapy (terrain.map)`);
  return {
    seed: readNumber(world, 'seed', FILE, { integer: true }),
    mapName: terrain.map,
  };
}

export function parseGridSettings(section: Record<string, unknown>, file: string): MapSettings {
  return {
    widthCells: readNumber(section, 'widthCells', file, { integer: true, min: 2 }),
    heightCells: readNumber(section, 'heightCells', file, { integer: true, min: 2 }),
    cellSizeM: readNumber(section, 'cellSizeM', file, { min: 0.1 }),
  };
}
