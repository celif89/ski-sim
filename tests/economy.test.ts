/**
 * Etap 6: sezon i ekonomia – pełny rok bez grafiki, bilans, popyt (cena, ferie, weekendy),
 * zamknięty ośrodek, zapis i wczytanie (determinizm), budowa w czasie, kredyt, bankructwo,
 * model zgrubny dnia zgodny z symulacją gości.
 */
import { describe, expect, it, vi } from 'vitest';
import { feriaShare, feriePeriods, isoWeek, weekdayIndex, yearPhase } from '../src/sim/calendar';
import type { DayContext } from '../src/sim/economy';
import { agentOutcome, balanceChange, closeDay, constructionChargePreview, objectCosts, planDay, quickDayOutcome, reputationOf, sellPasses, setSeasonOpen, sumCosts, sumRevenue, takeLoan } from '../src/sim/economy';
import type { EconomyParams } from '../src/sim/economyParams';
import { parseSave } from '../src/sim/gameSave';
import { HeadlessGame } from '../src/sim/headlessGame';
import { GuestDay } from '../src/sim/guests';
import { formatIsoDate } from '../src/sim/time';
import { ep, makeGame, simpleLayout, simplePolicy } from './economyFixture';
import { gp } from './guestFixture';

vi.setConfig({ testTimeout: 300_000 });

/** Gra z gotowym (zbudowanym) prostym ośrodkiem i otwartym sezonem w dniu `date`. */
function readyGame(date = { year: 2027, month: 1, day: 12 }) {
  const g = makeGame({ startDate: date });
  g.setLayout(simpleLayout());
  g.state.construction = {};
  g.setLayout(g.layout);
  g.state.seasonOpen = true;
  return g;
}

function goodCtx(g: HeadlessGame, date: { year: number; month: number; day: number }): DayContext {
  const ctx = g.context(date);
  return { ...ctx, date, snow: { score: 0.8, thinShare: 0, meanBaseCm: 50 }, forecast: null, competitors: ctx.competitors.map((c) => ({ ...c, open: true, kmOpen: 5, snowScore: 0.8 })) };
}

const noNoise: EconomyParams = { ...ep, demand: { ...ep.demand, noiseSd: 0 } };

describe('Kalendarz', () => {
  it('ferie 2026 zgodne z komunikatem MEN; śląskie 16 II – 1 III, małopolskie 2–15 II', () => {
    const turns = feriePeriods(2026, ep);
    expect(turns.map((t) => formatIsoDate(t.from))).toEqual(['2026-01-17', '2026-01-31', '2026-02-14']);
    expect(feriaShare({ year: 2026, month: 2, day: 18 }, ep).regions).toContain('śląskie');
    expect(feriaShare({ year: 2026, month: 2, day: 10 }, ep).regions).toContain('małopolskie');
    expect(feriaShare({ year: 2026, month: 3, day: 2 }, ep).share).toBe(0);
    // W kolejnych latach – ten sam tydzień ISO, zawsze od poniedziałku.
    for (const y of [2027, 2030, 2035]) {
      for (const t of feriePeriods(y, ep)) {
        expect(weekdayIndex(t.from)).toBe(5); // sobota przed
        expect([4, 6, 8]).toContain(isoWeek({ ...t.from, day: t.from.day + 2 }).week);
      }
    }
  });

  it('pory roku: lato V–IX, jesień X–XI, zima XII–III, wiosna IV', () => {
    expect([5, 7, 9].map((m) => yearPhase({ year: 2026, month: m, day: 1 }, ep))).toEqual(['summer', 'summer', 'summer']);
    expect(yearPhase({ year: 2026, month: 10, day: 1 }, ep)).toBe('autumn');
    expect(yearPhase({ year: 2027, month: 2, day: 1 }, ep)).toBe('winter');
    expect(yearPhase({ year: 2027, month: 4, day: 1 }, ep)).toBe('spring');
  });
});

describe('Rok gry bez grafiki', () => {
  it('pełny rok od lata do wiosny przechodzi bez błędów; bilans: saldo końcowe = początkowe + przychody − koszty (− budowa + kredyt)', () => {
    const g = makeGame({ policy: simplePolicy, agentsOn: (d) => d.month === 1 && d.day === 16 });
    const start = g.state.balancePln;
    g.setLayout(simpleLayout());
    // Kredyt w trakcie roku (raty co miesiąc).
    let loanTaken = false;
    let days = 0;
    g.runUntil({ year: 2027, month: 5, day: 1 }, (r) => {
      days++;
      expect(Number.isFinite(r.record.balancePln)).toBe(true);
      if (!loanTaken && r.record.date === '2026-07-15') {
        expect(takeLoan(g.state, 2_000_000, 5, g.facts, ep)).toBeNull();
        loanTaken = true;
      }
    });
    expect(days).toBe(365);
    expect(g.state.history).toHaveLength(1);
    const rep = g.state.history[0];
    expect(rep.balanceStart).toBe(start);
    expect(rep.balanceEnd).toBeCloseTo(start + balanceChange(rep.flows), 2);
    expect(rep.balanceEnd).toBeCloseTo(start + sumRevenue(rep.flows) - sumCosts(rep.flows) - rep.flows.construction + rep.flows.refunds + rep.flows.loanIn - rep.flows.loanPrincipal, 2);
    expect(rep.flows.loanIn).toBe(2_000_000);
    expect(rep.flows.interest).toBeGreaterThan(0);
    expect(rep.flows.loanPrincipal).toBeGreaterThan(0);
    // Sezon się odbył: dni otwarte, goście, przychód z karnetów, przeglądy.
    expect(rep.openDays).toBeGreaterThan(20);
    expect(rep.guests).toBeGreaterThan(1000);
    expect(rep.flows.passes).toBeGreaterThan(0);
    expect(rep.flows.inspections).toBeGreaterThan(0);
    expect(rep.days.some((d) => d.src === 'a')).toBe(true);
    // Budowa trwa: orczyk gotowy dopiero po ok. 100 dniach od zamówienia (1 V).
    const firstOpen = rep.days.find((d) => d.open)!;
    expect(firstOpen.date >= '2026-08-01').toBe(true);
    expect(g.state.seasonOpen).toBe(false); // 1 maja – sezon zamknięty
  });

  it('zamknięty ośrodek ma zero przychodów z karnetów (koszty stałe zostają)', () => {
    const g = makeGame({ policy: (x) => (x.state.seasonOpen = false) });
    g.setLayout(simpleLayout());
    g.runUntil({ year: 2027, month: 5, day: 1 });
    const rep = g.state.history[0];
    expect(rep.flows.passes).toBe(0);
    expect(rep.guests).toBe(0);
    expect(rep.openDays).toBe(0);
    expect(rep.flows.permanent).toBeGreaterThan(0);
  });

  it('zapis i wczytanie dają identyczny dalszy przebieg (także dni z symulacją gości)', () => {
    const opts = { policy: simplePolicy, agentsOn: (d: { month: number; day: number }) => d.month === 1 && (d.day === 9 || d.day === 23) };
    const a = makeGame(opts);
    a.setLayout(simpleLayout());
    a.runUntil({ year: 2027, month: 1, day: 15 });
    const saved = JSON.parse(JSON.stringify(a.save())) as unknown;
    a.runUntil({ year: 2027, month: 2, day: 10 });
    const loaded = parseSave(saved);
    const b = new HeadlessGame(makeGame(opts).o, loaded);
    b.runUntil({ year: 2027, month: 2, day: 10 });
    expect(b.state.balancePln).toBeCloseTo(a.state.balancePln, 6);
    expect(JSON.stringify(b.state.year.days)).toBe(JSON.stringify(a.state.year.days));
    expect(reputationOf(b.state, ep)).toBeCloseTo(reputationOf(a.state, ep), 10);
  });
});

describe('Popyt', () => {
  it('wyższa cena karnetu zmniejsza liczbę gości', () => {
    const g = readyGame();
    const date = { year: 2027, month: 1, day: 16 };
    const ctx = goodCtx(g, date);
    const n = (price: number) => {
      g.state.prices.dayPln = price;
      return planDay(g.state, ctx, noNoise).demand;
    };
    expect(n(120)).toBeGreaterThan(n(170));
    expect(n(170)).toBeGreaterThan(n(250));
    expect(n(250)).toBeGreaterThan(n(400));
  });

  it('weekendy i ferie zwiększają liczbę gości; skład: w tygodniu szkoły, w weekend rodziny', () => {
    const g = readyGame();
    const at = (d: { year: number; month: number; day: number }) => planDay(g.state, goodCtx(g, d), noNoise);
    const tue = at({ year: 2027, month: 1, day: 12 });
    const sat = at({ year: 2027, month: 1, day: 16 });
    const feriaTue = at({ year: 2027, month: 2, day: 23 }); // ferie śląskie 2027 (8. tydzień)
    expect(sat.demand).toBeGreaterThan(2 * tue.demand);
    expect(feriaTue.demand).toBeGreaterThan(2 * tue.demand);
    expect(feriaTue.info.feria.regions).toContain('śląskie');
    expect(tue.typeShares[3]).toBeGreaterThan(sat.typeShares[3]); // grupy szkolne
    expect(sat.typeShares[2]).toBeGreaterThan(tue.typeShares[2]); // rodziny
  });

  it('parking ogranicza przyjazdy; zamknięty sezon – zero gości', () => {
    const g = readyGame();
    const date = { year: 2027, month: 1, day: 16 };
    const ctx = goodCtx(g, date);
    const many = { ...ctx, facts: { ...ctx.facts, parkingCars: 10 } };
    const p = planDay(g.state, many, noNoise);
    expect(p.guests).toBeLessThan(p.demand);
    expect(p.guests).toBeLessThanOrEqual(Math.ceil(p.parkingLimit));
    g.state.seasonOpen = false;
    expect(planDay(g.state, ctx, noNoise).guests).toBe(0);
  });

  it('lepsza reputacja i lepszy śnieg – więcej gości; konkurencja bez śniegu – więcej dla nas', () => {
    const g = readyGame();
    const date = { year: 2027, month: 1, day: 16 };
    const ctx = goodCtx(g, date);
    const base = planDay(g.state, ctx, noNoise).demand;
    expect(planDay(g.state, { ...ctx, snow: { ...ctx.snow, score: 0.5 } }, noNoise).demand).toBeLessThan(base);
    g.state.reputation = { sum: 4.8 * 20000, weight: 20000 };
    expect(planDay(g.state, ctx, noNoise).demand).toBeGreaterThan(base);
    g.state.reputation = { sum: 0, weight: 0 };
    const noComp = { ...ctx, competitors: ctx.competitors.map((c) => ({ ...c, open: false })) };
    expect(planDay(g.state, noComp, noNoise).demand).toBeGreaterThan(base);
  });
});

describe('Budowa, kredyt, bankructwo', () => {
  it('budowa kosztuje i trwa; zimą wolniej i drożej; anulowana budowa – zwrot; piaskownica – za darmo i od razu', () => {
    const g = makeGame();
    const before = g.state.balancePln;
    const preview = constructionChargePreview(g.state, objectCosts(simpleLayout(), (() => {
      g.setLayout({ ...simpleLayout() });
      return g.analysis;
    })(), ep), ep);
    expect(preview).toBe(0); // już zamówione – podgląd tej samej zmiany nic nie kosztuje
    const paid = before - g.state.balancePln;
    expect(paid).toBeGreaterThan(1_000_000);
    expect(Object.keys(g.state.construction)).toHaveLength(4);
    // Anulowanie trasy tego samego dnia – pełny zwrot.
    const t2cost = g.state.paid.T2.costPln;
    const balance = g.state.balancePln;
    g.setLayout({ ...simpleLayout(), pistes: simpleLayout().pistes.filter((p) => p.id !== 'T2') });
    expect(g.state.balancePln - balance).toBeCloseTo(t2cost, 2);
    // Zimą: drożej i wolniej.
    const w = makeGame({ startDate: { year: 2027, month: 1, day: 5 } });
    w.setLayout(simpleLayout());
    const winterPaid = ep.career.startCapitalPln - w.state.balancePln;
    expect(winterPaid).toBeGreaterThan(paid * 1.2);
    const left0 = w.state.construction.W1.leftDays;
    w.stepDay();
    expect(left0 - w.state.construction.W1.leftDays).toBeCloseTo(ep.costs.winterBuildProgressFactor, 6);
    // Piaskownica.
    const s = makeGame({ mode: 'sandbox' });
    s.setLayout(simpleLayout());
    expect(s.state.balancePln).toBe(0);
    expect(Object.keys(s.state.construction)).toHaveLength(0);
    expect(s.facts.lifts[0].operating).toBe(true);
  });

  it('kredyt: rata annuitetowa spłaca go w terminie; limit kredytu', () => {
    const g = makeGame();
    expect(takeLoan(g.state, 100_000_000, 10, g.facts, ep)).toMatch(/najwyżej/);
    expect(takeLoan(g.state, 1_200_000, 1, g.facts, ep)).toBeNull();
    let principal = 0;
    let interest = 0;
    g.runUntil({ year: 2027, month: 5, day: 2 }, (r) => {
      principal += r.flows.loanPrincipal;
      interest += r.flows.interest;
    });
    expect(g.state.loans).toHaveLength(0);
    expect(principal).toBeCloseTo(1_200_000, 0);
    expect(interest).toBeGreaterThan(1_200_000 * ep.loan.interestRatePerYear * 0.4);
    expect(interest).toBeLessThan(1_200_000 * ep.loan.interestRatePerYear * 0.7);
  });

  it('kariera: bankructwo przy trwale ujemnym saldzie kończy grę; sezonu nie da się otworzyć latem', () => {
    const g = makeGame();
    g.state.balancePln = -ep.career.overdraftLimitPln - 1;
    g.stepDay();
    expect(g.state.bankrupt).toBe(true);
    expect(setSeasonOpen(g.state, true, ep)).toMatch(/zbankrutował/);
    const h = makeGame();
    expect(setSeasonOpen(h.state, true, ep)).toMatch(/od listopada/);
  });
});

describe('Karnety i model zgrubny dnia', () => {
  it('krótki pobyt – karnet 2 h lub 4 h, długi – dzienny; dzieci płacą ulgowo', () => {
    const o = { ...agentOutcome({ stayH: Float32Array.from([6, 3.5, 1.5, 6]), rides: Int32Array.from([20, 10, 4, 20]), child: Uint8Array.from([0, 0, 0, 1]), skill: new Uint8Array(4), liftIds: [], liftBoarded: [], liftHours: [], ratingSum: 16, ratingCount: 4, meanQueueMin: 2 }, { lifts: [] } as never) };
    const prices = { dayPln: 170, fourHourPln: 135, twoHourPln: 100, pointPln: 100 };
    const habitFree = { ...ep, passes: { ...ep.passes, dayPassHabitShare: 0 } };
    const s = sellPasses(o, prices, 4, habitFree);
    expect(s.counts).toEqual({ day: 2, fourHour: 1, twoHour: 1, points: 0 });
    expect(s.revenuePln).toBeCloseTo(170 + 135 + 100 + 170 * ep.passes.reducedFactor, 6);
  });

  it('model zgrubny zgodny z pełną symulacją gości (100–800 gości na orczyku)', () => {
    const g = readyGame();
    const date = { year: 2027, month: 1, day: 16 };
    const ctx = goodCtx(g, date);
    for (const n of [100, 300, 800]) {
      const plan = { ...planDay(g.state, ctx, ep), guests: n };
      const day = new GuestDay(g.net!, gp, { seed: 1, date, guests: n, elevationM: g.o.grid.elevationM, hours: g.state.hours, typeShares: plan.typeShares });
      day.setConditions(ctx.weather.cond);
      day.setSnow({ quality: new Uint8Array(g.o.grid.cellCount).fill(3), depthCm: new Float32Array(g.o.grid.cellCount).fill(60), moguls: null });
      day.advanceTo(24 * 3600);
      const a = agentOutcome(day.economySummary(), g.facts);
      const q = quickDayOutcome(g.state, plan, ctx, ep, gp);
      const rides = (o: typeof a) => {
        let r = 0;
        for (let i = 0; i < o.rides.length; i++) r += o.rides[i] * o.weight;
        return r;
      };
      expect(Math.abs(q.ratingSum / q.ratingCount - a.ratingSum / a.ratingCount)).toBeLessThan(0.45);
      expect(rides(q) / rides(a)).toBeGreaterThan(0.75);
      expect(rides(q) / rides(a)).toBeLessThan(1.35);
      const ra = sellPasses(a, g.state.prices, g.facts.pointsPerRide, ep).revenuePln / a.guests;
      const rq = sellPasses(q, g.state.prices, g.facts.pointsPerRide, ep).revenuePln / q.guests;
      expect(Math.abs(rq / ra - 1)).toBeLessThan(0.25);
    }
  });

  it('dzień zamknięty: tylko koszty stałe; dzień otwarty: energia z mocy i godzin, obsługa, ratownicy', () => {
    const g = readyGame();
    const date = { ...g.state.date };
    const ctx = goodCtx(g, date);
    const plan = planDay(g.state, ctx, ep);
    const out = quickDayOutcome(g.state, plan, ctx, ep, gp);
    const r = closeDay(g.state, ctx, plan, out, ep);
    const H = g.state.hours.closeH - g.state.hours.openH;
    const lift = g.facts.lifts[0];
    expect(r.flows.energy).toBeGreaterThanOrEqual(H * lift.idleKw * ep.costs.energyPlnPerKWh - 1e-6);
    expect(r.flows.energy).toBeLessThanOrEqual(H * lift.powerKw * ep.costs.energyPlnPerKWh + 1e-6);
    expect(r.flows.liftStaff).toBeCloseTo(ep.costs.staffSurfaceLift * (H + ep.costs.staffExtraHours) * ep.costs.hourlyWagePln * ep.costs.employerCostFactor, 6);
    expect(r.flows.patrol).toBeGreaterThan(0);
    g.state.seasonOpen = false;
    const ctx2 = goodCtx(g, g.state.date);
    const plan2 = planDay(g.state, ctx2, ep);
    const r2 = closeDay(g.state, ctx2, plan2, quickDayOutcome(g.state, plan2, ctx2, ep, gp), ep);
    expect(r2.flows.passes + r2.flows.energy + r2.flows.liftStaff + r2.flows.snowEnergy).toBe(0);
    expect(r2.flows.insurance).toBeGreaterThan(0);
  });
});
