/** Wczytanie mapy z dysku (data/maps/<mapa>/) – dla narzędzi, raportów i testów (Node). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGridFromMap, createHorizonDem, parseMapDefinition } from '../sim/mapFile';
import { computeSlopeAndAspect } from '../sim/terrainAnalysis';

export const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

function readBuffer(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export function loadMapFromDisk(mapName = 'pilsko') {
  const dir = `${DATA_DIR}maps/${mapName}/`;
  const mapJson = JSON.parse(readFileSync(`${dir}map.json`, 'utf8')) as unknown;
  const def = parseMapDefinition(mapJson);
  const grid = createGridFromMap(def, readBuffer(`${dir}${def.elevationFile}`));
  computeSlopeAndAspect(grid);
  const dem = def.horizonDem ? createHorizonDem(def, readBuffer(`${dir}${def.horizonDem.file}`)) : null;
  return { mapJson, def, grid, dem };
}
