/**
 * Gra bez grafiki na sztucznym terenie testowym (tests/guestFixture.ts) – do testów etapu 6.
 * Ośrodek „prosty”: orczyk W1 na łagodnym zachodnim stoku, dwie trasy, parking.
 */
import climateJson from '../data/climate/pilsko.json';
import constructionJson from '../data/construction.json';
import economyJson from '../data/economy.json';
import radiationJson from '../data/radiation.json';
import snowJson from '../data/snow.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import type { GameMode } from '../src/sim/economy';
import { parseEconomyParams } from '../src/sim/economyParams';
import { parseGroundParams } from '../src/sim/ground';
import type { HeadlessGameOptions } from '../src/sim/headlessGame';
import { HeadlessGame } from '../src/sim/headlessGame';
import { computeHorizon, parseHorizonParams } from '../src/sim/horizon';
import { designLift } from '../src/sim/lifts';
import { parseRadiationParams } from '../src/sim/radiation';
import type { ResortLayout } from '../src/sim/resort';
import { parseConstructionParams } from '../src/sim/resort';
import { parseSnowParams } from '../src/sim/snow';
import { parseRidingParams } from '../src/sim/snowRiding';
import { parseWeatherParams } from '../src/sim/weather';
import { fixtureGrid, gp, lp, pp } from './guestFixture';

export const ep = parseEconomyParams(economyJson);
const grid = fixtureGrid();
const horizon = computeHorizon(grid, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 1500 });

export function simpleLayout(): ResortLayout {
  const lift = designLift(grid, lp, 'W1', 'orczyk', 'Orczyk', { xM: 150, yM: 1290 }, { xM: 150, yM: 320 });
  return {
    version: 1,
    lifts: [lift],
    pistes: [
      { id: 'T1', name: 'Łagodna', points: [{ xM: 140, yM: 315, widthM: 40 }, { xM: 80, yM: 700, widthM: 40 }, { xM: 90, yM: 1200, widthM: 40 }, { xM: 140, yM: 1300, widthM: 40 }] },
      { id: 'T2', name: 'Druga', points: [{ xM: 160, yM: 315, widthM: 30 }, { xM: 230, yM: 800, widthM: 30 }, { xM: 160, yM: 1300, widthM: 30 }] },
    ],
    bases: [{ id: 'B1', name: 'Parking', xM: 180, yM: 1340, typeId: 'parking' }],
    nextId: 10,
  };
}

export function makeGame(o: Partial<HeadlessGameOptions> & { mode?: GameMode } = {}): HeadlessGame {
  return new HeadlessGame({
    grid,
    horizon,
    forest: new Float32Array(grid.cellCount),
    shrub: new Float32Array(grid.cellCount),
    profile: parseClimateProfile(climateJson),
    weatherParams: parseWeatherParams(wxJson),
    radiationParams: parseRadiationParams(radiationJson),
    snowParams: parseSnowParams(snowJson),
    guestParams: gp,
    liftParams: lp,
    pisteParams: pp,
    clearing: parseConstructionParams(constructionJson).clearing,
    ground: parseGroundParams(constructionJson),
    riding: parseRidingParams(snowJson),
    economy: ep,
    seed: 20261105,
    location: { latDeg: 49.54, lonDeg: 19.32, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } },
    mode: o.mode ?? 'career',
    startDate: { year: 2026, month: 5, day: 1 },
    ...o,
  });
}

/** Prosta polityka gracza: sezon otwarty od 1 grudnia, gdy jest śnieg, do końca marca. */
export function simplePolicy(g: HeadlessGame): void {
  const d = g.state.date;
  const inSeason = d.month === 12 || d.month <= 3;
  if (!inSeason) {
    if (g.state.seasonOpen) g.state.seasonOpen = false;
    return;
  }
  if (!g.state.seasonOpen) g.state.seasonOpen = true;
}
