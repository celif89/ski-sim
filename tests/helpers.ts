import settingsJson from '../data/settings.json';
import terrainJson from '../data/terrain-generator.json';
import { parseSimSettings } from '../src/sim/settings';
import { parseTerrainGeneratorParams } from '../src/sim/terrainGenerator';

export const simSettings = parseSimSettings(settingsJson);
export const terrainParams = parseTerrainGeneratorParams(terrainJson);
export { settingsJson, terrainJson };
