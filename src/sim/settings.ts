/** Ustawienia symulacji odczytywane z data/settings.json. */
import { readNumber, readSection } from './params';

export interface MapSettings {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
}

export interface SimSettings {
  seed: number;
  map: MapSettings;
}

const FILE = 'data/settings.json';

export function parseSimSettings(raw: unknown): SimSettings {
  const world = readSection(raw, 'world', FILE);
  const map = readSection(raw, 'map', FILE);
  return {
    seed: readNumber(world, 'seed', FILE, { integer: true }),
    map: {
      widthCells: readNumber(map, 'widthCells', FILE, { integer: true, min: 2 }),
      heightCells: readNumber(map, 'heightCells', FILE, { integer: true, min: 2 }),
      cellSizeM: readNumber(map, 'cellSizeM', FILE, { min: 0.1 }),
    },
  };
}
