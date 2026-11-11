/**
 * Etap 7f: wygoda budowania i poprawki – ratraki bez garażu i używane, rowy, „Naśnież trasę”,
 * ulepszanie, przyciąganie i linie pomocnicze.
 */
import { describe, expect, it } from 'vitest';
import economyJson from '../data/economy.json';
import snowmakingJson from '../data/snowmaking.json';
import { newGameState } from '../src/sim/economy';
import { parseEconomyParams } from '../src/sim/economyParams';
import type { GroomPiste, GroomerUnit } from '../src/sim/grooming';
import { breakdownChance, breakdownTonight, planNight } from '../src/sim/grooming';
import { acquireGroomer, acquireUsedGroomer, shelteredGroomers, usedGroomerOffers } from '../src/sim/operations';
import { Rng } from '../src/sim/rng';
import waterJson from '../data/water.json';
import { chooseGunType, planPisteSnowmaking } from '../src/sim/autoSnowmaking';
import { connectPipelines, pipelineCost, pipelineHydrants } from '../src/sim/snowmaking';
import { ep as epFull, simpleLayout } from './economyFixture';
import { fixtureGrid, lp, pp } from './guestFixture';
import constructionJson from '../data/construction.json';
import { parseConstructionParams } from '../src/sim/resort';
import { analyzeResort } from '../src/sim/resort';
import { designLift } from '../src/sim/lifts';
import { constructionChargePreview, objectCosts, reconcileConstruction } from '../src/sim/economy';
import { liftUpgradeCheck, moveBuilding, upgradeGun, upgradeLift, widenPiste } from '../src/sim/upgrades';

const clearingFixture = parseConstructionParams(constructionJson).clearing;
import { analyzeDitch, buildStreamNet, legacyDitchPoints, parseWaterParams } from '../src/sim/water';
import { groomerTypeById, gunTypeById, parseSnowmakingParams } from '../src/sim/snowmakingParams';

const sp = parseSnowmakingParams(snowmakingJson);
const ep = parseEconomyParams(economyJson);

function piste(): GroomPiste {
  const cells = Array.from({ length: 200 }, (_, i) => i);
  return {
    id: 'T1',
    group: 1,
    areaM2: 30000,
    lengthM: 1000,
    meanSlopePercent: 20,
    cells,
    steep: new Uint8Array(cells.length),
    steepTops: [],
    freshSnowCm: 0,
    pileM3: 0,
    priority: 1,
    enabled: true,
    groomerId: null,
    airTempC: () => -6,
    wetSnow: false,
  };
}

describe('Ratraki bez garażu i używane (etap 7f)', () => {
  it('ratrak bez garażu można kupić i pracuje (dłużej się rozgrzewa)', () => {
    const state = newGameState({ mode: 'career', seed: 7, date: { year: 2026, month: 12, day: 1 }, ep });
    expect(acquireGroomer(state, 'standard', true, 0, sp)).toBeNull();
    const ops = state.ops!;
    expect(ops.groomers).toHaveLength(1);
    expect(shelteredGroomers(ops, 0).size).toBe(0);
    const type = groomerTypeById(sp, 'standard');
    const warm = sp.groomers.outdoor.warmupMin / 60;
    const outdoor: GroomerUnit[] = [{ id: ops.groomers[0].id, type, available: true, warmupH: warm }];
    const indoor: GroomerUnit[] = [{ id: ops.groomers[0].id, type, available: true, warmupH: 0 }];
    const a = planNight([piste()], outdoor, [], sp);
    const b = planNight([piste()], indoor, [], sp);
    expect(a.jobs).toHaveLength(1);
    expect(a.jobs[0].complete).toBe(true);
    expect(a.jobs[0].startH - b.jobs[0].startH).toBeCloseTo(warm, 9);
  });

  it('awaryjność pod chmurką wyższa niż w garażu (te same warunki i ziarno)', () => {
    const nights = 3000;
    let inside = 0;
    let outside = 0;
    for (let n = 0; n < nights; n++) {
      const rngA = new Rng(42).fork(String(n));
      const rngB = new Rng(42).fork(String(n));
      const ctx = { nightMinC: -15, condition: 1 };
      const i = breakdownTonight(3, rngA, sp, { ...ctx, sheltered: true });
      const o = breakdownTonight(3, rngB, sp, { ...ctx, sheltered: false });
      if (i) inside++;
      if (o) outside++;
      // Te same losowania: awaria w garażu oznacza awarię także pod chmurką.
      if (i) expect(o).toBe(true);
    }
    expect(outside).toBeGreaterThan(inside * 1.5);
    // Bez mrozu – bez różnicy; słaby egzemplarz psuje się częściej.
    expect(breakdownChance(3, sp, { sheltered: false, nightMinC: 0, condition: 1 })).toBeCloseTo(breakdownChance(3, sp, { sheltered: true, nightMinC: 0, condition: 1 }), 12);
    expect(breakdownChance(3, sp, { sheltered: true, nightMinC: 0, condition: 0.3 })).toBeGreaterThan(breakdownChance(3, sp, { sheltered: true, nightMinC: 0, condition: 1 }));
  });

  it('rynek używanych: oferty z ziarna, cena ok. 1/3 nowego, zakup raz', () => {
    const a = usedGroomerOffers(7, 2026, sp);
    expect(a).toEqual(usedGroomerOffers(7, 2026, sp));
    expect(a.length).toBe(sp.groomers.used.offersPerSeason);
    for (const o of a) {
      const neu = groomerTypeById(sp, o.typeId).pricePln;
      expect(o.pricePln / neu).toBeGreaterThan(sp.groomers.used.priceShareOfNew * 0.6);
      expect(o.pricePln / neu).toBeLessThan(sp.groomers.used.priceShareOfNew * 1.4);
      expect(o.ageYears).toBeGreaterThanOrEqual(sp.groomers.used.ageMinYears);
      expect(o.ageYears).toBeLessThanOrEqual(sp.groomers.used.ageMaxYears);
    }
    const state = newGameState({ mode: 'career', seed: 7, date: { year: 2026, month: 12, day: 1 }, ep });
    const before = state.balancePln;
    expect(acquireUsedGroomer(state, a[0], sp)).toBeNull();
    expect(state.balancePln).toBe(before - a[0].pricePln);
    expect(state.ops!.groomers[0].ageAtPurchase).toBe(a[0].ageYears);
    expect(acquireUsedGroomer(state, a[0], sp)).not.toBeNull();
  });
});

describe('Rowy zbierające wodę (etap 7f)', () => {
  const wp = parseWaterParams(waterJson);
  // Płaszczyzna opadająca na południe (y rośnie w dół stoku), 25 %.
  const W = 60;
  const H = 80;
  const cs = 10;
  const z = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) z[j * W + i] = 1500 - 0.25 * (j + 0.5) * cs;
  const net = buildStreamNet({ grid: { widthCells: W, heightCells: H, cellSizeM: cs, elevationM: z }, osm: [], annualPrecipMm: () => 1200, params: wp });
  const ditch = [
    { xM: 100, yM: 300 },
    { xM: 500, yM: 330 },
  ];
  const res = [{ id: 'Z1', xM: 505, yM: 335 }];

  it('zlewnia = obszar powyżej rowu (nic poniżej, nic z boku)', () => {
    const a = analyzeDitch(ditch, net, z, res, wp, () => 1200, sp.ditch);
    expect(a.ok).toBe(true);
    expect(a.reservoirId).toBe('Z1');
    expect(a.slopePercent).toBeGreaterThan(wp.ditches.minSlopePercent);
    const yAt = (x: number) => 300 + ((x - 100) / 400) * 30;
    for (const k of a.catchment.cells) {
      const x = ((k % W) + 0.5) * cs;
      const y = (Math.floor(k / W) + 0.5) * cs;
      // Komórka nad rowem (z tolerancją jednej komórki na samym rowie) i w pasie jego przebiegu.
      expect(y).toBeLessThanOrEqual(yAt(Math.max(100, Math.min(500, x))) + cs);
      // Spływ z modelu terenu (8 kierunków) może zbaczać na skos, ale nie wraca pod górę na zachód.
      expect(x).toBeGreaterThan(100 - cs);
    }
    // Komórki pod rowem i tuż pod nim nie należą do zlewni poniżej rowu.
    expect(a.catchment.cells.some((k) => (Math.floor(k / W) + 0.5) * cs > 345)).toBe(false);
    // Powierzchnia ≈ pas 400 m × ok. 315 m nad rowem (spływ po skosie – część pasa odpływa obok).
    expect(a.catchment.areaM2).toBeGreaterThan(400 * 315 * 0.7);
    expect(a.catchment.areaM2).toBeLessThan(400 * 315 * 1.1);
    expect(a.annualInflowM3).toBeCloseTo((a.effectiveAreaM2 * 1200 * wp.catchment.runoffCoefficient) / 1000, 6);
    expect(a.costPln).toBeCloseTo(a.lengthM * sp.ditch.costPlnPerM, 6);
  });

  it('rów pod górę do zbiornika jest odrzucany', () => {
    // Zbiornik przy wyższym końcu: woda musiałaby płynąć pod górę.
    const up = analyzeDitch(ditch, net, z, [{ id: 'Z2', xM: 95, yM: 295 }], wp);
    expect(up.ok).toBe(false);
    expect(up.slopePercent).toBeLessThan(0);
    expect(up.issues.join(' ')).toMatch(/pod górę/);
    // Bez zbiornika przy końcu – też odrzucony.
    expect(analyzeDitch(ditch, net, z, [], wp).ok).toBe(false);
  });

  it('stare rowy przy zbiorniku: rów dnem doliny powyżej zbiornika', () => {
    const V = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) V[j * W + i] = 1500 - 0.25 * (j + 0.5) * cs + 0.3 * Math.abs((i + 0.5) * cs - 300);
    const vnet = buildStreamNet({ grid: { widthCells: W, heightCells: H, cellSizeM: cs, elevationM: V }, osm: [], annualPrecipMm: () => 1200, params: wp });
    const pts = legacyDitchPoints(vnet, V, 300, 700, wp);
    expect(pts.length).toBeGreaterThan(5);
    for (const q of pts.slice(0, -1)) expect(Math.abs(q.xM - 300)).toBeLessThan(cs);
    const a = analyzeDitch(pts, vnet, V, [{ id: 'Z1', xM: 300, yM: 700 }], wp);
    expect(a.ok).toBe(true);
    expect(a.lengthM).toBeGreaterThan(wp.ditches.legacyLengthM * 0.8);
  });
});

describe('„Naśnież trasę” (etap 7f)', () => {
  const grid = fixtureGrid();
  const forest = new Float32Array(grid.widthCells * grid.heightCells);
  // Las wokół drugiej trasy (x ≥ 170 m) – trasa wycięta w lesie.
  for (let j = 0; j < grid.heightCells; j++) for (let i = 0; i < grid.widthCells; i++) if ((i + 0.5) * grid.cellSizeM >= 170) forest[j * grid.widthCells + i] = 1;
  const layout = simpleLayout();
  let next = 100;
  const pump = { xM: 100, yM: 1340 };
  const plan = planPisteSnowmaking({ grid, forest, pistes: layout.pistes, pipelines: [], pump, pumpCapacityM3h: 300, newId: (p) => `${p}${next++}` }, sp);

  it('hydranty co odstęp z danych, armatka przy każdym', () => {
    expect(plan.pipelines).toHaveLength(2);
    let total = 0;
    for (const pipe of plan.pipelines) {
      const h = pipelineHydrants(pipe, sp);
      expect(h.length).toBeGreaterThan(5);
      expect(h[0].alongM).toBeCloseTo((pipe.hydrantsFromM ?? 0) + sp.pipe.hydrantSpacingM / 2, 6);
      for (let i = 1; i < h.length; i++) expect(h[i].alongM - h[i - 1].alongM).toBeCloseTo(sp.pipe.hydrantSpacingM, 6);
      total += h.length;
    }
    expect(plan.guns).toHaveLength(total);
  });

  it('wszystkie armatki podłączone do pompowni', () => {
    const conn = connectPipelines(plan.pipelines, pump, sp);
    for (const g of plan.guns) expect(conn.has(g.pipelineId)).toBe(true);
    expect(plan.perPiste.every((p) => p.connected)).toBe(true);
    // Druga rura może dołączyć do pierwszej zamiast iść do pompowni.
    expect(plan.issues.filter((s) => /pompowni/.test(s) && !/nadąży/.test(s))).toHaveLength(0);
  });

  it('koszt = suma elementów (rury, hydranty, armatki)', () => {
    let sum = 0;
    for (const p of plan.pipelines) sum += pipelineCost(p, sp).costPln;
    for (const g of plan.guns) sum += gunTypeById(sp, g.typeId).costPln;
    expect(plan.costPln).toBeCloseTo(sum, 6);
    expect(plan.cost.pipesPln + plan.cost.hydrantsPln + plan.cost.gunsPln).toBeCloseTo(sum, 6);
    expect(plan.snowM3h).toBeGreaterThan(0);
    expect(plan.firstCoverDays).toBeGreaterThan(0);
    expect(Number.isFinite(plan.firstCoverDays)).toBe(true);
  });

  it('śmigłowe na szerokich odcinkach, lance przy lesie i na wąskich', () => {
    const t1 = plan.perPiste.find((p) => p.pisteId === 'T1')!;
    const t2 = plan.perPiste.find((p) => p.pisteId === 'T2')!;
    expect(t1.fans).toBeGreaterThan(t1.lances);
    expect(t2.lances).toBeGreaterThan(0);
    expect(chooseGunType(50, 20, 0, sp)).toBe('fan');
    expect(chooseGunType(20, 20, 0, sp)).toBe('lance');
    expect(chooseGunType(50, 60, 0, sp)).toBe('lance');
    expect(chooseGunType(50, 20, 0.8, sp)).toBe('lance');
  });
});

describe('Ulepszanie, przesuwanie, rozbiórka (etap 7f)', () => {
  const grid = fixtureGrid();

  it('ulepszenie wyciągu zachowuje linię, przelicza podpory i liczy koszt różnicowy', () => {
    const layout = simpleLayout();
    const lift = layout.lifts[0];
    expect(liftUpgradeCheck(lift, 'kanapa4d', lp).ok).toBe(true);
    const up = upgradeLift(grid, lp, lift, 'kanapa4d');
    expect(up.bottom).toEqual(lift.bottom);
    expect(up.top).toEqual(lift.top);
    expect(up.bends ?? []).toEqual(lift.bends ?? []);
    expect(up.typeId).toBe('kanapa4d');
    // Podpory od nowa dla nowego typu (kolej linowa ma inne przęsła i wysokości niż orczyk).
    const fresh = designLift(grid, lp, 'X', 'kanapa4d', 'X', lift.bottom, lift.top);
    expect(up.towers).toEqual(fresh.towers);
    expect(up.towers).not.toEqual(lift.towers);
    // Koszt różnicowy: gotowy orczyk → kanapa = różnica + opłata za przebudowę (lato, bez dopłaty zimowej).
    const state = newGameState({ mode: 'career', seed: 3, date: { year: 2026, month: 6, day: 1 }, ep: epFull });
    const ctx = { grid, lifts: lp, pistes: pp, clearing: clearingFixture, forest: null, shrub: null };
    const before = objectCosts(layout, analyzeResort(layout, ctx), epFull);
    reconcileConstruction(state, before, epFull);
    state.construction = {};
    const after = { ...layout, lifts: [up] };
    const objs = objectCosts(after, analyzeResort(after, ctx), epFull);
    const oldCost = before.find((o) => o.id === 'W1')!.costPln;
    const newCost = objs.find((o) => o.id === 'W1')!.costPln;
    expect(newCost).toBeGreaterThan(oldCost);
    const charge = constructionChargePreview(state, objs, epFull);
    expect(charge).toBeCloseTo(newCost - oldCost + newCost * epFull.costs.rebuildFeeShare, 2);
    const r = reconcileConstruction(state, objs, epFull);
    const days = state.construction.W1;
    expect(days.totalDays).toBe(Math.max(1, Math.round(objs.find((o) => o.id === 'W1')!.buildDays * epFull.costs.rebuildDaysShare)));
    expect(r.messages.join(' ')).toMatch(/Przebudowa/);
  });

  it('rozbiórka gotowego obiektu zwraca część kosztu (z pliku danych)', () => {
    const layout = simpleLayout();
    const state = newGameState({ mode: 'career', seed: 3, date: { year: 2026, month: 6, day: 1 }, ep: epFull });
    const ctx = { grid, lifts: lp, pistes: pp, clearing: clearingFixture, forest: null, shrub: null };
    const objs = objectCosts(layout, analyzeResort(layout, ctx), epFull);
    reconcileConstruction(state, objs, epFull);
    state.construction = {};
    const t2 = objs.find((o) => o.id === 'T2')!;
    const without = objs.filter((o) => o.id !== 'T2');
    expect(constructionChargePreview(state, without, epFull)).toBeCloseTo(-t2.costPln * epFull.costs.demolishRefundShare, 2);
  });

  it('poszerzenie trasy, zamiana armatki, przesunięcie budynku z obrotem co 90°', () => {
    const layout = simpleLayout();
    const w = widenPiste(layout.pistes[0], pp);
    expect(w.points.map((q) => q.widthM)).toEqual(layout.pistes[0].points.map((q) => Math.min(pp.maxWidthM, q.widthM + pp.widenStepM)));
    expect(w.points.map((q) => [q.xM, q.yM])).toEqual(layout.pistes[0].points.map((q) => [q.xM, q.yM]));
    const sl = { ...layout, snowGuns: [{ id: 'A1', typeId: 'fan', pipelineId: 'R1', hydrant: 2 }], buildings: [{ id: 'P1', typeId: 'pump300', name: 'P', xM: 10, yM: 10 }] };
    const g = upgradeGun(sl, 'A1', 'lance').snowGuns![0];
    expect(g).toEqual({ id: 'A1', typeId: 'lance', pipelineId: 'R1', hydrant: 2 });
    const m = moveBuilding(sl, 'P1', 50, 60, 100).buildings![0];
    expect([m.xM, m.yM, m.rotDeg]).toEqual([50, 60, 90]);
    expect(moveBuilding(sl, 'P1', 50, 60, 360).buildings![0].rotDeg).toBeUndefined();
  });
});
