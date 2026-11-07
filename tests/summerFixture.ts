/**
 * Ośrodek testowy lata (etap 7b) na sztucznym terenie (tests/guestFixture.ts): kanapa z parkingu na
 * górę łagodnego zachodniego stoku, orczyk obok, ścieżka spacerowa, restauracja na górze, trasa
 * rowerowa i tor saneczkowy; budowa gotowa (piaskownica).
 */
import climateJson from '../data/climate/pilsko.json';
import summerJson from '../data/summer.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import type { GameState } from '../src/sim/economy';
import { markAllBuilt, newGameState, objectCosts, resortFacts } from '../src/sim/economy';
import { withSummer } from '../src/sim/economyParams';
import { designLift } from '../src/sim/lifts';
import type { ResortAnalysis, ResortLayout } from '../src/sim/resort';
import { analyzeResort } from '../src/sim/resort';
import type { SummerFacts, SummerPlan, SummerWeather } from '../src/sim/summer';
import { ensureSummer, summerDayInfo, summerFacts } from '../src/sim/summer';
import { SummerDay, summerNetFor } from '../src/sim/summerGuests';
import { parseSummerParams } from '../src/sim/summerParams';
import { inspectionStatus } from '../src/sim/inspections';
import { parseWeatherParams } from '../src/sim/weather';
import { WeatherBook } from '../src/sim/weatherBook';
import type { CalendarDate } from '../src/sim/weather';
import { ep as epWinter } from './economyFixture';
import { fixtureGrid, lp, pp } from './guestFixture';

export const sp = parseSummerParams(summerJson);
export const ep = withSummer(epWinter, sp);
export const grid = fixtureGrid();
export const book = new WeatherBook(parseClimateProfile(climateJson), parseWeatherParams(wxJson), 20261105, { latDeg: 49.54, lonDeg: 19.32, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } }, 1000, 1100);

export function summerLayout(o: { racks?: boolean; orczyk?: boolean } = {}): ResortLayout {
  const chair = { ...designLift(grid, lp, 'W1', 'kanapa4s', 'Kanapa', { xM: 180, yM: 1300 }, { xM: 180, yM: 320 }), ...(o.racks ? { bikeRacks: true } : {}) };
  const lifts = [chair];
  if (o.orczyk) lifts.push(designLift(grid, lp, 'W2', 'orczyk', 'Orczyk', { xM: 100, yM: 1300 }, { xM: 100, yM: 700 }));
  return {
    version: 1,
    lifts,
    pistes: [{ id: 'T1', name: 'Trasa', points: [{ xM: 170, yM: 315, widthM: 40 }, { xM: 120, yM: 800, widthM: 40 }, { xM: 160, yM: 1290, widthM: 40 }] }],
    bases: [{ id: 'B1', name: 'Parking', xM: 205, yM: 1340, typeId: 'parking' }],
    buildings: [
      { id: 'G1', typeId: 'gastronomy', name: 'Restauracja na górze', xM: 210, yM: 300 },
      { id: 'P1', typeId: 'playground', name: 'Plac zabaw', xM: 240, yM: 1320 },
    ],
    trails: [
      { id: 'S1', name: 'Ścieżka na górę', kind: 'walk', points: [{ xM: 230, yM: 1330 }, { xM: 230, yM: 800 }, { xM: 215, yM: 310 }] },
      { id: 'R1', name: 'Trasa rowerowa', kind: 'bike', points: [{ xM: 190, yM: 330 }, { xM: 60, yM: 800 }, { xM: 170, yM: 1290 }] },
      { id: 'Z1', name: 'Tor saneczkowy', kind: 'toboggan', points: [{ xM: 260, yM: 900 }, { xM: 260, yM: 1300 }] },
    ],
    nextId: 50,
  };
}

export interface SummerWorld {
  layout: ResortLayout;
  analysis: ResortAnalysis;
  state: GameState;
  sf: SummerFacts;
  facts: ReturnType<typeof resortFacts>;
}

export function summerWorld(layout: ResortLayout, date: CalendarDate = { year: 2027, month: 7, day: 17 }): SummerWorld {
  const analysis = analyzeResort(layout, { grid, lifts: lp, pistes: pp, clearing: { forestCostPlnPerM2: 0, shrubCostPlnPerM2: 0, daysPerHectare: 0 }, forest: null, shrub: null, summer: sp });
  const state = newGameState({ mode: 'sandbox', seed: 7, date, ep });
  markAllBuilt(state, objectCosts(layout, analysis, ep));
  ensureSummer(state, sp).open = true;
  const facts = resortFacts(layout, analysis, null, state, lp, ep);
  // Bez sieci gości zimowych facts.lifts nie wie o czasie wjazdu – uzupełnia go summerFacts z długości.
  const sf = summerFacts(layout, analysis.trails!, facts, state, lp, sp, ep, (id) => inspectionStatus(state, id, state.date) === 'ok');
  return { layout, analysis, state, sf, facts };
}

export const calm: SummerWeather = { stormProbability: 0, storm: false, stormFromH: 0, stormToH: 0, tmaxBottomC: 22, heat: false, precipMm: 0, rainFromH: 0, rainToH: 0, windTopMs: 3 };

export function plan(byType: number[], weather: SummerWeather = calm, date: CalendarDate = { year: 2027, month: 7, day: 17 }): SummerPlan {
  return {
    date,
    open: true,
    info: summerDayInfo(date, sp),
    weather,
    byType,
    guests: byType.reduce((a, b) => a + b, 0),
    demand: byType.reduce((a, b) => a + b, 0),
    parkingLimit: 1e9,
    factors: { pool: 0, day: 1, month: 1, forecast: 1, noise: 1 },
    hours: { openH: sp.season.openH, closeH: sp.season.closeH },
  };
}

export function runSummerDay(w: SummerWorld, p: SummerPlan, check?: (d: SummerDay) => void): SummerDay {
  const net = summerNetFor(w.layout, w.analysis.trails!, w.sf, w.facts, () => true, { walkLines: [], destinations: [{ kind: 'peak', name: 'Szczyt', xM: 200, yM: 150 }] }, (x, y) => grid.sampleElevationM(x, y), sp);
  const day = new SummerDay(net, sp, { seed: 11, date: p.date, plan: p, personsPerCar: ep.demand.personsPerCar });
  for (let t = 0; t < 22 * 3600; t += 2) {
    day.step(2);
    check?.(day);
  }
  return day;
}
