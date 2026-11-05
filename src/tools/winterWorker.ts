/**
 * Wątek pomocniczy raportu „przewiń zimę”: liczy kolejne sezony (rok startu z wiadomości)
 * i odsyła statystyki. Dane wspólne (teren, promieniowanie, parametry) dostaje raz, przy starcie.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { seasonWeather } from '../sim/environment';
import type { SolarCache } from '../sim/snowSeason';
import type { SeasonRunInput } from './winterRuns';
import { runSeasonStats } from './winterRuns';

export type WinterWorkerData = Omit<SeasonRunInput, 'weather' | 'mapAfterDays'> & { seed: number };
export interface WinterJob {
  startYear: number;
  mapAfterDays: number[];
}

const base = workerData as WinterWorkerData;

parentPort!.on('message', ({ startYear, mapAfterDays }: WinterJob) => {
  const weather = seasonWeather(base.profile, base.weatherParams, base.seed, startYear);
  // Promieniowanie bezchmurnego nieba jest takie samo co roku – przesuwamy tylko datę początku.
  const solar: SolarCache = { ...base.solar, startDate: weather[0].date };
  const result = runSeasonStats({ ...base, solar, weather, mapAfterDays });
  const transfer = [
    ...result.pointDepthCm,
    ...result.pointSweMm,
    ...result.pointQuality,
    result.deepDays,
    result.coverDays,
    result.maxDepthCm,
    result.lastCoverDay,
    result.coverDaysAll,
    ...result.maps,
  ].map((a) => a.buffer as ArrayBuffer);
  parentPort!.postMessage({ startYear, result }, transfer);
});
