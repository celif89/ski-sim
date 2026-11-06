/**
 * Etap 6b: woda do naśnieżania.
 * - dwa ujęcia na jednym potoku pobierają razem nie więcej niż wspólny limit,
 * - ujęcie poza ciekiem nie daje wody (odrzucone),
 * - wodociąg nie przekracza limitu przyłącza, koszt = ilość × cena,
 * - zbiornik na mapie bez potoków napełnia się wiosną z roztopów w zlewni (rowy), nigdy ponad pojemność.
 */
import { describe, expect, it } from 'vitest';
import radiationJson from '../data/radiation.json';
import waterJson from '../data/water.json';
import climateJson from '../data/climate/pilsko.json';
import { parseClimateProfile } from '../src/sim/climate';
import type { GameState } from '../src/sim/economy';
import { computeHorizon, parseHorizonParams } from '../src/sim/horizon';
import type { WaterContext } from '../src/sim/operations';
import { waterSources } from '../src/sim/operations';
import type { ResortLayout } from '../src/sim/resort';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { allocateIntakes, annualPrecipitationMm, buildStreamNet, parseWaterParams, streamAt, wellYieldM3h } from '../src/sim/water';
import { makeGame, sp } from './economyFixture';
import { computeSlopeAndAspect } from './snowmakingHelpers';

const wp = parseWaterParams(waterJson);
const profile = parseClimateProfile(climateJson);

/** Dolina w kształcie litery V spadająca na południe (y rośnie w dół stoku); dno doliny x = 300 m, ok. 1150–1500 m n.p.m. (jak Hala Miziowa). */
function valleyGrid(): TerrainGrid {
  const w = 60;
  const h = 100;
  const cs = 10;
  const z = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) * cs;
      const y = (j + 0.5) * cs;
      z[j * w + i] = 1150 + 0.25 * (1000 - y) + 0.3 * Math.abs(x - 300);
    }
  }
  const g = new TerrainGrid(w, h, cs, z);
  computeSlopeAndAspect(g);
  return g;
}

const grid = valleyGrid();
const net = buildStreamNet({ grid, osm: [], annualPrecipMm: (zz) => annualPrecipitationMm(profile, zz), params: wp });
const water: WaterContext = { net, wp, villageBuildings: [], elevationM: grid.elevationM };
const opsGrid = { widthCells: grid.widthCells, heightCells: grid.heightCells, cellSizeM: grid.cellSizeM, sampleElevationM: (x: number, y: number) => grid.sampleElevationM(x, y) };

describe('Potoki i ujęcia', () => {
  it('model terenu wyznacza potok dnem doliny; przepływ rośnie w dół potoku', () => {
    const up = streamAt(net, 300, 600, wp.streams.intakeMaxDistanceM, wp);
    const dn = streamAt(net, 300, 950, wp.streams.intakeMaxDistanceM, wp);
    expect(up).not.toBeNull();
    expect(dn).not.toBeNull();
    expect(dn!.meanFlowM3s).toBeGreaterThan(up!.meanFlowM3s);
    // Odpływ jednostkowy w granicach typowych dla Beskidów (15–35 l/(s·km²)).
    const q = (dn!.meanFlowM3s * 1000) / (net.accM2[dn!.cell] / 1e6);
    expect(q).toBeGreaterThan(15);
    expect(q).toBeLessThan(35);
    expect(streamAt(net, 80, 600, wp.streams.intakeMaxDistanceM, wp)).toBeNull();
  });

  it('dwa ujęcia na jednym potoku pobierają razem nie więcej niż wspólny limit', () => {
    const a = streamAt(net, 300, 600, wp.streams.intakeMaxDistanceM, wp)!;
    const b = streamAt(net, 300, 950, wp.streams.intakeMaxDistanceM, wp)!;
    for (const factor of [0.6, 1, 1.4]) {
      const r = allocateIntakes(net, [{ id: 'A', cell: a.cell, capacityM3h: 500 }, { id: 'B', cell: b.cell, capacityM3h: 500 }], factor, wp);
      const [ra, rb] = r;
      // Każde ujęcie najwyżej to, co wolno pobrać w jego miejscu…
      expect(ra.allocatedM3h).toBeLessThanOrEqual(ra.availableM3h + 1e-9);
      // …a razem najwyżej to, co wolno pobrać w niższym (wspólny limit dla potoku).
      expect(ra.allocatedM3h + rb.allocatedM3h).toBeLessThanOrEqual(rb.availableM3h + 1e-9);
      expect(ra.allocatedM3h + rb.allocatedM3h).toBeGreaterThan(0.9 * rb.availableM3h);
      // Pobór zostawia przepływ nienaruszalny.
      expect(rb.flowM3h - (ra.allocatedM3h + rb.allocatedM3h)).toBeGreaterThanOrEqual(wp.streams.ecologicalFlowShare * net.meanFlowM3s[b.cell] * 3600 - 1e-6);
    }
    // Małe ujęcie dostaje pełną wydajność, gdy potoku starcza.
    const small = allocateIntakes(net, [{ id: 'A', cell: a.cell, capacityM3h: 1 }], 1, wp);
    expect(small[0].allocatedM3h).toBeCloseTo(1, 9);
  });

  it('ujęcie poza ciekiem jest odrzucone (nie daje wody)', () => {
    const layout: ResortLayout = {
      version: 1,
      lifts: [],
      pistes: [],
      bases: [],
      nextId: 50,
      buildings: [
        { id: 'Z1', typeId: 'reservoir20', name: 'Zbiornik', xM: 300, yM: 900 },
        { id: 'U1', typeId: 'intake', name: 'Ujęcie na potoku', xM: 302, yM: 870 },
        { id: 'U2', typeId: 'intake', name: 'Ujęcie na stoku', xM: 250, yM: 880 },
      ],
    };
    const state = { seed: 1, construction: {} } as unknown as GameState;
    const src = waterSources(layout, state, sp, opsGrid, water);
    const u1 = src.find((s) => s.id === 'U1')!;
    const u2 = src.find((s) => s.id === 'U2')!;
    expect(u1.problem).toBeNull();
    expect(u1.link?.reservoirId).toBe('Z1');
    expect(u2.problem).toContain('poza ciekiem');
  });

  it('studnia: wydajność losowana z ziarnem – ta sama dla tego samego ziarna, czasem prawie sucha', () => {
    expect(wellYieldM3h(5, 'S1', 100, wp)).toBe(wellYieldM3h(5, 'S1', 100, wp));
    const ys = Array.from({ length: 400 }, (_, k) => wellYieldM3h(k, 'S1', 100, wp));
    const dry = ys.filter((y) => y <= wp.wells.dryYieldM3h + 1e-9).length / ys.length;
    expect(dry).toBeGreaterThan(0.08);
    expect(dry).toBeLessThan(0.25);
    const sorted = [...ys].sort((a, b) => a - b);
    expect(sorted[200]).toBeGreaterThan(0.5 * wp.wells.medianYieldM3h);
    expect(sorted[200]).toBeLessThan(2 * wp.wells.medianYieldM3h);
  });
});

describe('Wodociąg i zlewnia zbiornika (gra bez grafiki)', () => {
  const horizon = computeHorizon(grid, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 1000 });
  const base = { grid, horizon, forest: new Float32Array(grid.cellCount), shrub: new Float32Array(grid.cellCount), mode: 'sandbox' as const };

  it('wodociąg nie przekracza limitu przyłącza, koszt = ilość × cena; poza wsią nie działa', () => {
    const village = Array.from({ length: 20 }, (_, k) => ({ xM: 450 + (k % 5) * 15, yM: 900 + Math.floor(k / 5) * 15 }));
    const g = makeGame({ ...base, startDate: { year: 2027, month: 6, day: 28 }, water: { ...water, villageBuildings: village } });
    g.setLayout({
      version: 1,
      lifts: [],
      pistes: [],
      bases: [],
      nextId: 50,
      buildings: [
        { id: 'Z1', typeId: 'reservoir20', name: 'Zbiornik', xM: 420, yM: 900 },
        { id: 'V1', typeId: 'mains', name: 'Wodociąg', xM: 460, yM: 910 },
        { id: 'V2', typeId: 'mains', name: 'Wodociąg w lesie', xM: 380, yM: 200 },
      ],
    });
    g.state.ops = { reservoirM3: 0, snowPlan: {}, gunModes: {}, groomers: [], nextGroomerId: 1, groomPlan: {}, dayGroom: [], last: null, mainsOn: true };
    const limit = sp.buildings.find((b) => b.id === 'mains')!.capacity;
    let total = 0;
    for (let d = 0; d < 6; d++) {
      const date = { ...g.state.date };
      g.stepDay();
      const src = g.lastOps!.summary.sources!;
      const v1 = src.find((s) => s.id === 'V1')!;
      const v2 = src.find((s) => s.id === 'V2')!;
      expect(v1.m3).toBeLessThanOrEqual(limit * 24 + 1e-6);
      expect(v1.m3).toBeGreaterThan(0);
      const fixed = date.day === 1 ? wp.mains.fixedPlnPerMonth : 0;
      expect(v1.costPln).toBeCloseTo(v1.m3 * wp.mains.pricePlnPerM3 + fixed, 6);
      expect(v2.m3).toBe(0);
      expect(v2.note).toContain('poza zasięgiem wodociągu');
      total += v1.m3;
    }
    expect(g.state.ops!.reservoirM3).toBeCloseTo(total, 3);
    // Wyłączony zakup – zero.
    g.state.ops!.mainsOn = false;
    g.stepDay();
    expect(g.lastOps!.summary.sources!.find((s) => s.id === 'V1')!.m3).toBe(0);
  });

  it('zbiornik na mapie bez potoków napełnia się wiosną z roztopów w zlewni, nigdy ponad pojemność', () => {
    // Mapa bez potoków: próg zlewni ponad całą mapę.
    const wpDry = { ...wp, streams: { ...wp.streams, accumulationThresholdM2: 1e9 } };
    const netDry = buildStreamNet({ grid, osm: [], annualPrecipMm: (zz) => annualPrecipitationMm(profile, zz), params: wpDry });
    expect(netDry.lines.length).toBe(0);
    const g = makeGame({ ...base, startDate: { year: 2027, month: 1, day: 15 }, water: { net: netDry, wp: wpDry, villageBuildings: [], elevationM: grid.elevationM } });
    g.setLayout({
      version: 1,
      lifts: [],
      pistes: [],
      bases: [],
      nextId: 50,
      buildings: [
        { id: 'Z1', typeId: 'reservoir100', name: 'Zbiornik', xM: 300, yM: 940 },
        { id: 'K1', typeId: 'catchment', name: 'Rowy', xM: 320, yM: 930 },
      ],
    });
    const cap = sp.buildings.find((b) => b.id === 'reservoir100')!.capacity;
    const byMonth = new Map<number, number>();
    let melt = 0;
    let total = 0;
    while (g.state.date.month < 6) {
      const m = g.state.date.month;
      const prev = g.state.ops?.catchSweMm?.K1;
      g.stepDay();
      const k1 = g.lastOps!.summary.sources!.find((s) => s.id === 'K1')!;
      const now = g.state.ops!.catchSweMm!.K1;
      byMonth.set(m, (byMonth.get(m) ?? 0) + k1.m3);
      total += k1.m3;
      if (prev !== undefined && now < prev - 0.5) melt += k1.m3;
      expect(g.state.ops!.reservoirM3).toBeLessThanOrEqual(cap + 1e-6);
    }
    const spring = (byMonth.get(3) ?? 0) + (byMonth.get(4) ?? 0) + (byMonth.get(5) ?? 0);
    const winter = (byMonth.get(1) ?? 0) + (byMonth.get(2) ?? 0);
    expect(g.state.ops!.reservoirM3).toBeGreaterThan(5000);
    expect(spring).toBeGreaterThan(winter);
    // Większość wody przyszła w dni, gdy śniegu na zlewni ubywało (roztopy).
    expect(melt).toBeGreaterThan(0.5 * total);
  });
});
