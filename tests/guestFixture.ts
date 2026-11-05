/**
 * Sztuczny ośrodek do testów gości. Teren: na dole (y = 1300 m) wszędzie 1000 m n.p.m., w górę stok
 * łagodny na zachodzie (8 %) i stromy na wschodzie (50 %). Domyślnie: wyciąg W1 na zachodzie (z góry
 * trasa zielona) i W2 na wschodzie (trasa czarna); dolne stacje obok siebie przy bazie.
 * Wariant „bliźniaczy”: dwa wyciągi na zachodnią górę (do testu przenoszenia się z kolejki).
 */
import guestsJson from '../data/guests.json';
import liftsJson from '../data/lifts.json';
import pistesJson from '../data/pistes.json';
import { parseGuestParams } from '../src/sim/guestParams';
import type { GuestParams } from '../src/sim/guestParams';
import { buildGuestNet } from '../src/sim/guestNetwork';
import type { GuestNet } from '../src/sim/guestNetwork';
import type { GuestConditions, GuestSnow } from '../src/sim/guests';
import { GuestDay } from '../src/sim/guests';
import { designLift, parseLiftParams } from '../src/sim/lifts';
import { parsePisteParams } from '../src/sim/pistes';
import type { ResortLayout } from '../src/sim/resort';
import { analyzeResort } from '../src/sim/resort';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { computeSlopeAndAspect } from '../src/sim/terrainAnalysis';

export const lp = parseLiftParams(liftsJson);
export const pp = parsePisteParams(pistesJson);
export const gp = parseGuestParams(guestsJson);

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function fixtureGrid(): TerrainGrid {
  const w = 80;
  const h = 140;
  const cell = 10;
  const z = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) * cell;
      const y = (j + 0.5) * cell;
      const s = 0.08 + (0.5 - 0.08) * smooth(250, 550, x);
      z[j * w + i] = 1000 + s * Math.max(0, 1300 - y) - 0.02 * Math.max(0, y - 1300);
    }
  }
  const g = new TerrainGrid(w, h, cell, z);
  computeSlopeAndAspect(g);
  return g;
}

export interface Fixture {
  grid: TerrainGrid;
  layout: ResortLayout;
  net: GuestNet;
}

export function buildFixture(opts: { closeBlack?: boolean; twinLifts?: boolean; liftTypes?: [string, string] } = {}): Fixture {
  const grid = fixtureGrid();
  const [t1, t2] = opts.liftTypes ?? ['kanapa4s', 'kanapa4s'];
  const twin = opts.twinLifts === true;
  const lifts = [
    designLift(grid, lp, 'W1', t1, 'W1', { xM: 380, yM: 1300 }, { xM: 150, yM: 110 }),
    twin ? designLift(grid, lp, 'W2', t2, 'W2', { xM: 430, yM: 1300 }, { xM: 200, yM: 110 }) : designLift(grid, lp, 'W2', t2, 'W2', { xM: 430, yM: 1300 }, { xM: 650, yM: 110 }),
  ];
  const pistes: ResortLayout['pistes'] = [
    { id: 'T1', name: 'Zielona', points: [{ xM: 170, yM: 95, widthM: 40 }, { xM: 150, yM: 400 }, { xM: 150, yM: 1240 }, { xM: 380, yM: 1310 }].map((p) => ({ widthM: 40, ...p })) },
  ];
  if (!twin) {
    pistes.push({
      id: 'T2',
      name: 'Czarna',
      points: [{ xM: 650, yM: 95 }, { xM: 650, yM: 400 }, { xM: 650, yM: 1240 }, { xM: 430, yM: 1310 }].map((p) => ({ widthM: 30, ...p })),
      ...(opts.closeBlack ? { closed: true } : {}),
    });
  }
  const layout: ResortLayout = { version: 1, lifts, pistes, bases: [{ id: 'B1', name: 'Baza', xM: 405, yM: 1340 }], nextId: 10 };
  const analysis = analyzeResort(layout, { grid, lifts: lp, pistes: pp, clearing: { forestCostPlnPerM2: 0, shrubCostPlnPerM2: 0, daysPerHectare: 0 }, forest: null, shrub: null });
  const net = buildGuestNet({
    layout,
    lifts: analysis.lifts,
    pistes: analysis.pistes,
    network: analysis.network,
    liftParams: lp,
    pisteParams: pp,
    stationWalkRadiusM: gp.operation.stationWalkRadiusM,
    foodPoints: [],
    grid: { cellSizeM: grid.cellSizeM, widthCells: grid.widthCells, heightCells: grid.heightCells },
  });
  return { grid, layout, net };
}

export const calmWeather: GuestConditions = { bottomElevM: 1200, topElevM: 1600, tempBottomC: -3, tempTopC: -6, windBottomMs: 2, windTopMs: 4, precipMmH: 0, rain: false, cloud: 0.2 };

export function goodSnow(grid: TerrainGrid): GuestSnow {
  return { quality: new Uint8Array(grid.cellCount).fill(3), depthCm: new Float32Array(grid.cellCount).fill(60), moguls: null };
}

export function newDay(f: Fixture, guests: number, seed = 12345, params: GuestParams = gp): GuestDay {
  const day = new GuestDay(f.net, params, { seed, date: { year: 2027, month: 1, day: 16 }, guests, elevationM: f.grid.elevationM });
  day.setConditions(calmWeather);
  day.setSnow(goodSnow(f.grid));
  return day;
}
