/**
 * Etap 7b: sezon letni.
 * - latem orczyk i talerzyk nie wożą; kanapa wozi pieszych w obie strony,
 * - wieszaki na rowery zmniejszają przepustowość dla pieszych,
 * - burza zatrzymuje kolej i tor; deszczowy weekend ma mniej gości niż słoneczny,
 * - wyciąg w przeglądzie nie wozi (zimą i latem),
 * - parkingi: zajęte miejsca = samochody obecnych gości, nigdy ponad pojemność,
 * - pełny rok (zima + lato): bilans się zgadza, raport roku osobno dla zimy i lata.
 */
import { describe, expect, it } from 'vitest';
import { balanceChange, resortFacts, sumCosts, sumRevenue, zeroFlows } from '../src/sim/economy';
import type { Flows } from '../src/sim/economy';
import { inspectionStatus, processInspections, registerLift, scheduleInspection } from '../src/sim/inspections';
import { easterSunday, summerDayInfo, summerFacts, summerPlan, summerWeather } from '../src/sim/summer';
import { SLOT_S } from '../src/sim/summerGuests';
import { addDays } from '../src/sim/time';
import { lp } from './guestFixture';
import { book, calm, ep, plan, runSummerDay, sp, summerLayout, summerWorld } from './summerFixture';
import { makeGame } from './economyFixture';
import { GuestDay } from '../src/sim/guests';
import { buildGuestNet } from '../src/sim/guestNetwork';
import { analyzeResort, parseConstructionParams } from '../src/sim/resort';
import constructionJson from '../data/construction.json';
import { calmWeather, fixtureGrid, goodSnow, gp, pp } from './guestFixture';
import { operationalLayout } from '../src/sim/economy';

describe('Kalendarz lata i pogoda', () => {
  it('Wielkanoc i Boże Ciało, wakacje, długi weekend', () => {
    expect(easterSunday(2027)).toEqual({ year: 2027, month: 3, day: 28 });
    expect(easterSunday(2026)).toEqual({ year: 2026, month: 4, day: 5 });
    const cc = summerDayInfo({ year: 2026, month: 6, day: 4 }, sp); // Boże Ciało 2026: 4 czerwca
    expect(cc.holiday).toBe(true);
    expect(summerDayInfo({ year: 2026, month: 6, day: 5 }, sp).bridge).toBe(true);
    expect(summerDayInfo({ year: 2026, month: 7, day: 15 }, sp).schoolHolidays).toBe(true);
    expect(summerDayInfo({ year: 2026, month: 9, day: 15 }, sp).schoolHolidays).toBe(false);
  });

  it('burze w lipcu częstsze niż we wrześniu (generator z danymi IMGW)', () => {
    let jul = 0;
    let sep = 0;
    for (let y = 2027; y < 2037; y++) {
      for (let d = 1; d <= 30; d++) {
        if (summerWeather(book, { year: y, month: 7, day: d }, sp, 5).storm) jul++;
        if (summerWeather(book, { year: y, month: 9, day: d }, sp, 5).storm) sep++;
      }
    }
    // IMGW Bielsko-Biała: lipiec 6,2, wrzesień 1,3 dnia z burzą w miesiącu.
    expect(jul / 10).toBeGreaterThan(3);
    expect(jul / 10).toBeLessThan(10);
    expect(sep).toBeLessThan(jul / 2);
  });
});

describe('Kolej latem', () => {
  it('latem orczyk nie wozi; kanapa wozi pieszych w górę i w dół', () => {
    const w = summerWorld(summerLayout({ orczyk: true }));
    expect(w.sf.lifts.map((l) => l.id)).toEqual(['W1']); // tylko koleje linowe
    const day = runSummerDay(w, plan([400, 300, 0, 0]));
    const o = day.outcome(w.sf);
    expect(o.liftUp[0]).toBeGreaterThan(200);
    expect(o.liftDown[0]).toBeGreaterThan(50);
    expect(o.ticketsRound).toBeGreaterThan(0);
  });

  it('wieszaki na rowery zmniejszają przepustowość dla pieszych', () => {
    const a = summerWorld(summerLayout({ racks: false }));
    const b = summerWorld(summerLayout({ racks: true }));
    expect(b.sf.lifts[0].pedCapacityPerHour).toBeLessThan(a.sf.lifts[0].pedCapacityPerHour);
    expect(b.sf.lifts[0].pedCapacityPerHour).toBeCloseTo(a.sf.lifts[0].pedCapacityPerHour * (1 - sp.lifts.bikeRackCarrierShare), 6);
    expect(a.sf.lifts[0].bikeCapacityPerHour).toBe(0);
    // Duży ruch pieszych (wycieczki szkolne – autokary): z wieszakami kolejka w górę dłużej się utrzymuje.
    const big = plan([0, 0, 0, 3000]);
    const morning = (q: Float32Array) => q.slice(36, 44).reduce((x, y) => x + y, 0);
    const qa = runSummerDay(a, big).stats.liftQueueUp[0];
    const qb = runSummerDay(b, big).stats.liftQueueUp[0];
    expect(morning(qb)).toBeGreaterThan(morning(qa));
  });

  it('burza zatrzymuje kolej i tor saneczkowy', () => {
    const w = summerWorld(summerLayout());
    const storm = { ...calm, storm: true, stormFromH: 11, stormToH: 14, stormProbability: 1 };
    let boardedInStorm = 0;
    let tobInStorm = 0;
    let lastTob = 0;
    const day = runSummerDay(w, plan([500, 400, 0, 0], storm), (d) => {
      const h = d.t / 3600;
      if (h > 11.05 && h < 13.95) {
        tobInStorm += d.stats.tobRides - lastTob;
      }
      lastTob = d.stats.tobRides;
    });
    for (let s = Math.ceil((11 * 3600) / SLOT_S) + 1; s < Math.floor((14 * 3600) / SLOT_S); s++) boardedInStorm += day.stats.liftBoardedSlots[0][s];
    expect(boardedInStorm).toBe(0);
    expect(tobInStorm).toBe(0);
    // Bez burzy w tych godzinach kolej wozi.
    const day2 = runSummerDay(w, plan([500, 400, 0, 0]));
    let normal = 0;
    for (let s = Math.ceil((11 * 3600) / SLOT_S) + 1; s < Math.floor((14 * 3600) / SLOT_S); s++) normal += day2.stats.liftBoardedSlots[0][s];
    expect(normal).toBeGreaterThan(0);
  });
});

describe('Popyt latem', () => {
  it('deszczowy weekend ma mniej gości niż słoneczny', () => {
    const w = summerWorld(summerLayout());
    const sats: { d: { year: number; month: number; day: number }; rain: number }[] = [];
    for (let d = { year: 2027, month: 6, day: 26 }; d.month <= 8; d = addDays(d, 7)) {
      const f = book.forecastFor(d);
      if (f) sats.push({ d, rain: f.precipitationProbability });
    }
    sats.sort((a, b) => a.rain - b.rain);
    const sunny = sats[0];
    const rainy = sats[sats.length - 1];
    expect(rainy.rain).toBeGreaterThan(sunny.rain + 0.3);
    const ps = summerPlan(w.state, sunny.d, w.sf, book, sp, ep);
    const pr = summerPlan(w.state, rainy.d, w.sf, book, sp, ep);
    expect(pr.factors.forecast).toBeLessThan(ps.factors.forecast);
    // Bez szumu dnia: goście na jednostkę puli.
    expect(pr.guests / pr.factors.noise).toBeLessThan(ps.guests / ps.factors.noise);
  });
});

describe('Przeglądy wyciągów', () => {
  it('wyciąg w przeglądzie nie wozi – latem i zimą', () => {
    const w = summerWorld(summerLayout());
    const today = { ...w.state.date };
    registerLift(w.state, 'W1', addDays(today, -100), sp);
    expect(scheduleInspection(w.state, 'W1', today, today)).toBeNull();
    const r = processInspections(w.state, today, [{ id: 'W1', name: 'Kanapa', aerial: true, built: true }], ep, sp);
    expect(r.costPln).toBe(ep.costs.inspectionAerialPln);
    expect(inspectionStatus(w.state, 'W1', today)).toBe('inspection');
    // Lato: kolej nie kursuje.
    const facts = resortFacts(w.layout, w.analysis, null, w.state, lp, ep);
    const sf = summerFacts(w.layout, w.analysis.trails!, facts, w.state, lp, sp, ep, (id) => inspectionStatus(w.state, id, today) === 'ok');
    expect(sf.lifts[0].operating).toBe(false);
    const o = runSummerDay({ ...w, sf }, plan([300, 200, 0, 0])).outcome(sf);
    expect(o.liftUp[0]).toBe(0);
    // Zima: sieć gości z układu „operacyjnego” – wyciąg zamknięty, zero pasażerów.
    const grid = fixtureGrid();
    const op = operationalLayout(w.layout, w.state, null);
    expect(op.lifts[0].closed).toBe(true);
    const a = analyzeResort(op, { grid, lifts: lp, pistes: pp, clearing: parseConstructionParams(constructionJson).clearing, forest: null, shrub: null });
    const net = buildGuestNet({ layout: op, lifts: a.lifts, pistes: a.pistes, network: a.network, liftParams: lp, pisteParams: pp, stationWalkRadiusM: gp.operation.stationWalkRadiusM, foodPoints: [], grid: { cellSizeM: grid.cellSizeM, widthCells: grid.widthCells, heightCells: grid.heightCells } });
    const day = new GuestDay(net, gp, { seed: 3, date: { year: 2027, month: 1, day: 16 }, guests: 200, elevationM: grid.elevationM });
    day.setConditions(calmWeather);
    day.setSnow(goodSnow(grid));
    for (let t = 0; t < 12 * 3600; t += 1) day.step(1);
    expect(day.liftBoarded[0]).toBe(0);
    // Po przeglądzie (7 dni) – ważny rok, znów wozi.
    const after = addDays(today, sp.inspections.aerialDays);
    processInspections(w.state, after, [{ id: 'W1', name: 'Kanapa', aerial: true, built: true }], ep, sp);
    expect(inspectionStatus(w.state, 'W1', after)).toBe('ok');
  });
});

describe('Parkingi latem', () => {
  it('zajęte miejsca = samochody obecnych gości i nigdy ponad pojemność', () => {
    const layout = summerLayout();
    const w = summerWorld(layout);
    const cap = ep.buildings.find((b) => b.id === 'parking')!.cars;
    let maxCars = 0;
    const day = runSummerDay(w, plan([2600, 1800, 0, 0]), (d) => {
      const used = d.parkingCarsNow().reduce((a, b) => a + b, 0);
      expect(used).toBe(d.carsOfGuestsNow());
      expect(used).toBeLessThanOrEqual(cap);
      maxCars = Math.max(maxCars, used);
    });
    expect(maxCars).toBeGreaterThan(cap * 0.9); // parking się zapełnił
    expect(day.turnedAway).toBeGreaterThan(0); // część odjechała, bo nie było miejsc
    expect(day.stats.parkingTurnedAway[0]).toBe(day.turnedAway);
  });
});

describe('Pełny rok: zima + lato', () => {
  it('bilans się zgadza, raport roku pokazuje osobno zimę i lato', () => {
    const g = makeGame({
      mode: 'sandbox',
      economy: ep,
      policy: (gg) => {
        const d = gg.state.date;
        gg.state.seasonOpen = d.month === 12 || d.month <= 3;
        if (gg.state.summer) gg.state.summer.open = d.month >= 6 && d.month <= 9;
      },
    });
    g.setLayout(summerLayout());
    g.runUntil({ year: 2027, month: 5, day: 2 });
    const rep = g.state.history[0];
    expect(rep).toBeDefined();
    const sf = rep.seasonFlows!;
    const sum = zeroFlows();
    for (const part of [sf.winter, sf.summer, sf.off, sf.common]) for (const k of Object.keys(sum) as (keyof Flows)[]) sum[k] += part[k] ?? 0;
    for (const k of Object.keys(sum) as (keyof Flows)[]) expect(sum[k]).toBeCloseTo(rep.flows[k], 3);
    expect(rep.balanceEnd - rep.balanceStart).toBeCloseTo(balanceChange(rep.flows), 2);
    expect(rep.summerOpenDays).toBeGreaterThan(100);
    expect(rep.summerGuests).toBeGreaterThan(0);
    expect(sumRevenue(sf.summer)).toBeGreaterThan(0);
    expect(sf.summer.liftTickets).toBeGreaterThan(0);
    expect(sumCosts(sf.common)).toBeGreaterThan(0);
    expect(rep.days.filter((d) => d.season === 'summer').length).toBe(rep.summerOpenDays);
  }, 60_000); // pełny rok gry – na wolniejszej maszynie CI ponad 5 s
});
