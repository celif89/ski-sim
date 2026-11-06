/**
 * Etap 6b: dostępność z parkingu, zjazd wyciągiem w dół, drogi i pojemność parkingów.
 * - wyciąg bez połączenia z parkingiem ma zero pasażerów (i ostrzeżenie przy budowie),
 * - przy zamkniętej dolnej trasie goście wracają zjazdem kanapą (w limicie miejsc),
 * - parking na końcu drogi przyjmuje gości tylko do swojej pojemności; bez drogi – brak dojazdu,
 * - nartostrada: za stroma – ostrzeżenie.
 */
import { describe, expect, it } from 'vitest';
import constructionJson from '../data/construction.json';
import { buildGuestNet } from '../src/sim/guestNetwork';
import { GuestDay } from '../src/sim/guests';
import { designLift } from '../src/sim/lifts';
import type { ResortLayout } from '../src/sim/resort';
import { analyzeResort, parseRoadParams } from '../src/sim/resort';
import { calmWeather, fixtureGrid, goodSnow, gp, lp, pp } from './guestFixture';

const grid = fixtureGrid();
const noCost = { forestCostPlnPerM2: 0, shrubCostPlnPerM2: 0, daysPerHectare: 0 };
const rp = parseRoadParams(constructionJson);

function netOf(layout: ResortLayout, opts: { publicRoads?: { xM: number; yM: number }[][]; capacity?: Map<string, number> } = {}) {
  const a = analyzeResort(layout, { grid, lifts: lp, pistes: pp, clearing: noCost, forest: null, shrub: null, roads: rp, publicRoads: opts.publicRoads ?? null });
  const net = buildGuestNet({
    layout,
    lifts: a.lifts,
    pistes: a.pistes,
    network: a.network,
    liftParams: lp,
    pisteParams: pp,
    stationWalkRadiusM: gp.operation.stationWalkRadiusM,
    foodPoints: [],
    grid: { cellSizeM: grid.cellSizeM, widthCells: grid.widthCells, heightCells: grid.heightCells },
    accessibleBases: a.accessibleBases,
    baseCapacityPersons: opts.capacity ?? null,
  });
  return { a, net };
}

function runDay(net: ReturnType<typeof netOf>['net'], guests: number, untilH = 17): GuestDay {
  const day = new GuestDay(net, gp, { seed: 777, date: { year: 2027, month: 1, day: 16 }, guests, elevationM: grid.elevationM });
  day.setConditions(calmWeather);
  day.setSnow(goodSnow(grid));
  for (let t = 0; t < untilH * 3600; t += 1) day.step(1);
  return day;
}

describe('Dostępność z parkingu', () => {
  it('wyciąg bez połączenia z parkingiem ma zero pasażerów i ostrzeżenie przy budowie', () => {
    const layout: ResortLayout = {
      version: 1,
      lifts: [
        designLift(grid, lp, 'W1', 'kanapa4s', 'Dolna', { xM: 380, yM: 1300 }, { xM: 150, yM: 110 }),
        // Daleko od parkingu, na wschodnim stoku – nie prowadzi do niej żadna trasa.
        designLift(grid, lp, 'W3', 'kanapa4s', 'Odcięta', { xM: 650, yM: 760 }, { xM: 650, yM: 160 }),
      ],
      pistes: [
        { id: 'T1', name: 'Zielona', points: [{ xM: 170, yM: 95 }, { xM: 150, yM: 400 }, { xM: 150, yM: 1240 }, { xM: 380, yM: 1310 }].map((p) => ({ widthM: 40, ...p })) },
        { id: 'T3', name: 'Wschodnia', points: [{ xM: 650, yM: 150 }, { xM: 660, yM: 460 }, { xM: 650, yM: 750 }].map((p) => ({ widthM: 30, ...p })) },
      ],
      bases: [{ id: 'B1', name: 'Parking', xM: 405, yM: 1340 }],
      nextId: 10,
    };
    const { a, net } = netOf(layout);
    expect(a.network.issues.some((i) => i.objectId === 'W3' && i.message.includes('niedostępny z parkingu'))).toBe(true);
    expect(a.network.issues.some((i) => i.objectId === 'W1' && i.message.includes('niedostępny'))).toBe(false);
    const w3 = net.lifts.findIndex((l) => l.id === 'W3');
    expect(net.lifts[w3].unreachable).toBe(true);
    const day = runDay(net, 400, 13);
    expect(day.liftBoarded[w3]).toBe(0);
    expect(day.liftBoarded[net.lifts.findIndex((l) => l.id === 'W1')]).toBeGreaterThan(100);
  });
});

describe('Zjazd wyciągiem w dół', () => {
  /** Kanapa z parkingu na halę (W1), kanapa z hali na szczyt (W2), dolna trasa zamknięta. */
  const valleyLayout = (downhill: boolean): ResortLayout => ({
    version: 1,
    lifts: [
      { ...designLift(grid, lp, 'W1', 'kanapa4s', 'Z doliny', { xM: 180, yM: 1300 }, { xM: 180, yM: 720 }), ...(downhill ? { downhill: true } : {}) },
      designLift(grid, lp, 'W2', 'kanapa4s', 'Na szczyt', { xM: 140, yM: 700 }, { xM: 150, yM: 110 }),
    ],
    pistes: [
      { id: 'T1', name: 'Górna', points: [{ xM: 165, yM: 95 }, { xM: 160, yM: 400 }, { xM: 145, yM: 690 }].map((p) => ({ widthM: 40, ...p })) },
      { id: 'T2', name: 'Dolna', closed: true, points: [{ xM: 200, yM: 735 }, { xM: 200, yM: 1000 }, { xM: 190, yM: 1290 }].map((p) => ({ widthM: 40, ...p })) },
    ],
    bases: [{ id: 'B1', name: 'Parking', xM: 205, yM: 1340 }],
    nextId: 10,
  });

  it('przy zamkniętej dolnej trasie goście wracają zjazdem kanapą; bez tej opcji kanapa z doliny stoi', () => {
    const on = netOf(valleyLayout(true)).net;
    const w1 = on.lifts.findIndex((l) => l.id === 'W1');
    expect(on.lifts[w1].downhillRiding).toBe(true);
    expect(on.lifts[w1].downhillSeatShare).toBeCloseTo(lp.types.find((t) => t.id === 'kanapa4s')!.downhillMaxSeatShare, 6);
    const day = runDay(on, 200, 18);
    expect(day.liftBoarded[w1]).toBeGreaterThan(50);
    expect(day.downRiders[w1]).toBeGreaterThan(50); // zjechali kanapą
    // Limit miejsc w dół: najwyżej udział miejsc × przepustowość × czas pracy.
    const capDownPerH = on.lifts[w1].capacityPerHour * on.lifts[w1].downhillSeatShare;
    expect(day.downRiders[w1]).toBeLessThanOrEqual(capDownPerH * 10);
    const off = netOf(valleyLayout(false)).net;
    const dayOff = runDay(off, 200, 13);
    expect(dayOff.liftBoarded[off.lifts.findIndex((l) => l.id === 'W1')]).toBe(0);
  });

  it('wyciąg powierzchniowy nie wozi w dół nawet z zaznaczoną opcją', () => {
    const l = { ...valleyLayout(true) };
    l.lifts = [{ ...designLift(grid, lp, 'W1', 'orczyk', 'Orczyk', { xM: 180, yM: 1300 }, { xM: 180, yM: 720 }), downhill: true }, l.lifts[1]];
    const { net } = netOf(l);
    expect(net.lifts[0].downhillRiding).toBe(false);
  });
});

describe('Drogi i parkingi', () => {
  const road = [{ xM: 0, yM: 1395 }, { xM: 799, yM: 1395 }]; // droga publiczna w dolinie
  const baseLayout = (withRoad: boolean): ResortLayout => ({
    version: 1,
    lifts: [designLift(grid, lp, 'W1', 'kanapa4s', 'Kanapa', { xM: 100, yM: 1300 }, { xM: 100, yM: 110 }), designLift(grid, lp, 'W2', 'kanapa4s', 'Druga', { xM: 180, yM: 900 }, { xM: 180, yM: 300 })],
    pistes: [
      { id: 'T1', name: 'Zielona', points: [{ xM: 110, yM: 95 }, { xM: 60, yM: 600 }, { xM: 95, yM: 1290 }].map((p) => ({ widthM: 40, ...p })) },
      { id: 'T2', name: 'Środkowa', points: [{ xM: 190, yM: 290 }, { xM: 200, yM: 600 }, { xM: 185, yM: 890 }].map((p) => ({ widthM: 40, ...p })) },
    ],
    bases: [
      { id: 'B1', name: 'Parking dolny', xM: 120, yM: 1340, typeId: 'parking' },
      { id: 'B2', name: 'Parking na końcu drogi', xM: 230, yM: 905, typeId: 'parking' },
    ],
    roads: withRoad ? [{ id: 'D1', name: 'Droga', points: [{ xM: 260, yM: 1395 }, { xM: 260, yM: 1150 }, { xM: 240, yM: 920 }] }] : [],
    nextId: 20,
  });

  it('parking bez drogi nie ma dojazdu; droga od drogi publicznej daje dojazd', () => {
    const without = analyzeResort(baseLayout(false), { grid, lifts: lp, pistes: pp, clearing: noCost, forest: null, shrub: null, roads: rp, publicRoads: [road] });
    expect(without.accessibleBases.has('B1')).toBe(true);
    expect(without.accessibleBases.has('B2')).toBe(false);
    expect(without.network.issues.some((i) => i.objectId === 'B2' && i.message.includes('bez dojazdu'))).toBe(true);
    const withRoad = analyzeResort(baseLayout(true), { grid, lifts: lp, pistes: pp, clearing: noCost, forest: null, shrub: null, roads: rp, publicRoads: [road] });
    expect(withRoad.accessibleBases.has('B2')).toBe(true);
    const ra = withRoad.roads.get('D1')!;
    expect(ra.connected).toBe(true);
    expect(ra.costPln).toBeCloseTo(ra.lengthM * rp.costPlnPerM, 3);
  });

  it('parking na końcu drogi przyjmuje gości tylko do swojej pojemności (reszta nie przyjeżdża)', () => {
    const cap = new Map([
      ['B1', 60],
      ['B2', 40],
    ]);
    const { net } = netOf(baseLayout(true), { publicRoads: [road], capacity: cap });
    const h2 = net.nodes[net.nodes.findIndex((n) => n.id === 'B2')].hub;
    const h1 = net.nodes[net.nodes.findIndex((n) => n.id === 'B1')].hub;
    expect(net.entryHubs).toContain(h2);
    const day = new GuestDay(net, gp, { seed: 4, date: { year: 2027, month: 1, day: 16 }, guests: 400, elevationM: grid.elevationM });
    expect(day.entryPersons[h2]).toBeLessThanOrEqual(40);
    expect(day.entryPersons[h2]).toBeGreaterThan(0);
    expect(day.entryPersons[h1]).toBeLessThanOrEqual(60);
    expect(day.parkingTurnedAway).toBeGreaterThanOrEqual(400 - 100);
  });
});

describe('Nartostrada', () => {
  it('nartostrada na stromym stoku dostaje ostrzeżenie, na łagodnym – nie', () => {
    const flat: ResortLayout = { version: 1, lifts: [], bases: [], nextId: 5, pistes: [{ id: 'T9', name: 'N', catwalk: true, points: [{ xM: 100, yM: 300 }, { xM: 100, yM: 900 }].map((p) => ({ widthM: pp.catwalkWidthM, ...p })) }] };
    const steep: ResortLayout = { ...flat, pistes: [{ ...flat.pistes[0], points: [{ xM: 700, yM: 300 }, { xM: 700, yM: 900 }].map((p) => ({ widthM: pp.catwalkWidthM, ...p })) }] };
    const a1 = analyzeResort(flat, { grid, lifts: lp, pistes: pp, clearing: noCost, forest: null, shrub: null });
    const a2 = analyzeResort(steep, { grid, lifts: lp, pistes: pp, clearing: noCost, forest: null, shrub: null });
    expect(a1.pistes.get('T9')!.issues.some((i) => i.message.includes('nartostrada za stroma'))).toBe(false);
    expect(a2.pistes.get('T9')!.issues.some((i) => i.message.includes('nartostrada za stroma'))).toBe(true);
  });
});
