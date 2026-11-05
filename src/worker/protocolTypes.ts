/** Typy z symulacji używane w wiadomościach między wątkami. */
import type { EnvironmentState } from '../sim/environment';

export type {
  CalendarDate,
  ContourLine,
  ContourParams,
  HillshadeParams,
  HorizonDem,
  HorizonParams,
  Location,
  MapSettings,
  TerrainGeneratorParams,
} from '../sim';

export interface EnvironmentStateMessage extends EnvironmentState {
  type: 'environmentState';
  requestId: number;
}
