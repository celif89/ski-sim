/**
 * Etap 7g: działki do dokupienia i kamienie milowe.
 */
import { describe, expect, it } from 'vitest';
import landJson from '../data/land.json';
import milestonesJson from '../data/milestones.json';
import { buildRefusal, chooseStartParcel, migrateLegacyCareer, milestoneRefusal, parcelLimit, parcelRefusal, startParcelChoices } from '../src/sim/buildRules';
import { newGameState, reputationOf } from '../src/sim/economy';
import { withLand } from '../src/sim/economyParams';
import { checkMilestones, lockReason, parseMilestoneParams, reachableMilestone, unlocksOf } from '../src/sim/milestones';
import { acquireParcel, annualLeasePln, buildParcels, parcelAt, parseLandParams } from '../src/sim/parcels';
import { analyzeResort, parseConstructionParams } from '../src/sim/resort';
import type { ResortLayout } from '../src/sim/resort';
import constructionJson from '../data/construction.json';
import { designLift } from '../src/sim/lifts';
import { ep as ep0, makeGame, simpleLayout } from './economyFixture';
import { fixtureGrid, lp, pp } from './guestFixture';

const grid = fixtureGrid(); // 800 × 1400 m
const land = { ...parseLandParams(landJson), parcelSizeM: 200, minAreaHa: 1 };
const mp = parseMilestoneParams(milestonesJson);
const ep = withLand(ep0, land, mp);
const forest = new Float32Array(grid.cellCount);
// Las w kolumnie x ≥ 600 m (ostatnia kolumna działek).
for (let j = 0; j < grid.heightCells; j++) for (let i = 0; i < grid.widthCells; i++) if ((i + 0.5) * grid.cellSizeM >= 600) forest[j * grid.widthCells + i] = 1;
// Droga publiczna wzdłuż dolnego brzegu mapy (y = 1395 m).
const road = [{ xM: 0, yM: 1395 }, { xM: 800, yM: 1395 }];
const pg = buildParcels(grid, forest, null, [road], [], land);
const ctx = { grid, lifts: lp, pistes: pp, clearing: parseConstructionParams(constructionJson).clearing, forest: null, shrub: null };
const career = () => newGameState({ mode: 'career', seed: 1, date: { year: 2026, month: 6, day: 1 }, ep });

describe('Działki (etap 7g)', () => {
  it('siatka działek: nazwy, powierzchnia, droga, las tylko w dzierżawie, cena z gruntu', () => {
    expect(pg.cols).toBe(4);
    expect(pg.rows).toBe(7);
    expect(pg.parcels).toHaveLength(28);
    expect(parcelAt(pg, 50, 50)!.id).toBe('A1');
    expect(parcelAt(pg, 750, 1350)!.id).toBe('D7');
    const a7 = parcelAt(pg, 50, 1350)!;
    expect(a7.areaHa).toBeCloseTo(4, 6);
    expect(a7.touchesRoad).toBe(true);
    expect(parcelAt(pg, 50, 50)!.touchesRoad).toBe(false);
    expect(startParcelChoices(pg).map((p) => p.id).sort()).toEqual(['A7', 'B7', 'C7', 'D7']);
    expect(a7.pricePln).toBe(Math.round((4 * land.meadowPlnPerHa) / 1000) * 1000);
    const d7 = parcelAt(pg, 750, 1350)!;
    expect(d7.leaseOnly).toBe(true);
    expect(d7.pricePln).toBeNull();
    expect(d7.leasePlnPerYear).toBeCloseTo(Math.round((4 * land.forestValuePlnPerHa * land.forestLeaseSharePerYear) / 100) * 100, 6);
  });

  it('start kariery tylko na działce przy drodze publicznej; zakup obciąża saldo', () => {
    const s = career();
    s.needsStartParcel = true;
    const before = s.balancePln;
    expect(chooseStartParcel(s, parcelAt(pg, 50, 50)!)).toMatch(/drogi publicznej/);
    expect(s.needsStartParcel).toBe(true);
    const a7 = parcelAt(pg, 50, 1350)!;
    expect(chooseStartParcel(s, a7)).toBeNull();
    expect(s.needsStartParcel).toBe(false);
    expect(s.balancePln).toBe(before - a7.pricePln!);
    expect(s.pending.land).toBe(a7.pricePln);
    // Kupno kolejnej działki – saldo; las – tylko dzierżawa; limit z kamieni milowych.
    expect(acquireParcel(s, parcelAt(pg, 750, 1350)!, 'buy', parcelLimit(s, ep))).toMatch(/dzierżawa/);
    const b7 = parcelAt(pg, 250, 1350)!;
    expect(acquireParcel(s, b7, 'buy', parcelLimit(s, ep))).toBeNull();
    expect(s.balancePln).toBe(before - a7.pricePln! - b7.pricePln!);
    expect(acquireParcel(s, parcelAt(pg, 450, 1350)!, 'buy', parcelLimit(s, ep))).toMatch(/Limit działek/);
  });

  it('nie da się zbudować poza swoimi działkami; podgląd wskazuje brakujące', () => {
    const s = career();
    chooseStartParcel(s, parcelAt(pg, 50, 1350)!); // A7
    const empty: ResortLayout = { version: 1, lifts: [], pistes: [], bases: [], nextId: 1 };
    // Orczyk z A7 w górę przez A6, A5.
    const lift = designLift(grid, lp, 'W1', 'orczyk', 'W1', { xM: 100, yM: 1350 }, { xM: 100, yM: 850 });
    const next: ResortLayout = { ...empty, lifts: [lift] };
    const a = analyzeResort(next, ctx);
    const r = parcelRefusal(empty, next, a, s, pg, grid.cellSizeM, grid.widthCells);
    expect(r.missing).toEqual(['A5', 'A6']);
    expect(r.message).toMatch(/A5, A6/);
    expect(buildRefusal(empty, next, a, s, ep, pg, grid.cellSizeM, grid.widthCells)).toMatch(/poza Twoje działki/);
    // Wyciąg w całości na A7 – wolno.
    const short: ResortLayout = { ...empty, lifts: [designLift(grid, lp, 'W1', 'orczyk', 'W1', { xM: 100, yM: 1390 }, { xM: 100, yM: 1210 })] };
    expect(buildRefusal(empty, short, analyzeResort(short, ctx), s, ep, pg, grid.cellSizeM, grid.widthCells)).toBeNull();
    // Budynek (ujęcie wody) też musi stać na swojej działce.
    const intake: ResortLayout = { ...empty, buildings: [{ id: 'I1', typeId: 'intake', name: 'Ujęcie', xM: 300, yM: 1300 }] };
    expect(parcelRefusal(empty, intake, null, s, pg, grid.cellSizeM, grid.widthCells).missing).toEqual(['B7']);
    // Piaskownica – wszystko wolno.
    const sb = newGameState({ mode: 'sandbox', seed: 1, date: { year: 2026, month: 6, day: 1 }, ep });
    expect(buildRefusal(empty, next, a, sb, ep, pg, grid.cellSizeM, grid.widthCells)).toBeNull();
  });

  it('dzierżawa: czynsz przy podpisaniu i co roku na początku roku gry (1 maja)', () => {
    const g = makeGame({ economy: ep, startDate: { year: 2027, month: 4, day: 29 } });
    const s = g.state;
    const d7 = parcelAt(pg, 750, 1350)!;
    const before = s.balancePln;
    expect(acquireParcel(s, d7, 'lease', 10)).toBeNull();
    expect(s.balancePln).toBe(before - d7.leasePlnPerYear);
    expect(annualLeasePln(s)).toBe(0); // umowa z dziś – zapłacona
    g.stepDay(); // 29 IV
    g.stepDay(); // 30 IV
    expect(annualLeasePln(s)).toBe(d7.leasePlnPerYear);
    const r = g.stepDay(); // 1 V – nowy rok gry
    expect(r.flows.landLease).toBe(d7.leasePlnPerYear);
    const r2 = g.stepDay(); // 2 V – bez czynszu
    expect(r2.flows.landLease).toBe(0);
  });
});

describe('Kamienie milowe (etap 7g)', () => {
  it('kamień odblokowuje się dokładnie po przekroczeniu progów (wszystkich naraz)', () => {
    const m1 = mp.milestones[1];
    expect(reachableMilestone(m1.visits - 1, m1.reputation, m1.seasons, mp)).toBe(0);
    expect(reachableMilestone(m1.visits, m1.reputation - 0.01, m1.seasons, mp)).toBe(0);
    expect(reachableMilestone(m1.visits, m1.reputation, m1.seasons - 1, mp)).toBe(0);
    expect(reachableMilestone(m1.visits, m1.reputation, m1.seasons, mp)).toBe(1);
    // Nie da się przeskoczyć kamienia, którego progów brak (reputacja za niska na drugi).
    const m2 = mp.milestones[2];
    expect(reachableMilestone(m2.visits * 10, m1.reputation, 99, mp)).toBe(1);
    const s = career();
    s.progress = { visits: m1.visits - 1, milestone: 0 };
    for (let i = 0; i < m1.seasons; i++) s.history.push({ guests: 0 } as never);
    expect(checkMilestones(s, m1.reputation, mp)).toEqual([]);
    s.progress.visits = m1.visits;
    expect(checkMilestones(s, m1.reputation, mp).map((m) => m.id)).toEqual([m1.id]);
    expect(s.progress.milestone).toBe(1);
    expect(checkMilestones(s, m1.reputation, mp)).toEqual([]);
  });

  it('zablokowanego typu nie da się postawić; po kamieniu – można; piaskownica bez blokad', () => {
    const s = career();
    expect(lockReason('lift', 'orczyk', s, mp)).toBeNull();
    expect(lockReason('lift', 'kanapa4s', s, mp)).toMatch(/^wymaga: Ośrodek regionalny – 20 tys\. wizyt, reputacja 3,8/);
    const prev = simpleLayout();
    const next = JSON.parse(JSON.stringify(prev)) as ResortLayout;
    next.lifts[0].typeId = 'kanapa2s';
    expect(milestoneRefusal(prev, next, s, ep)).toMatch(/wymaga: Lokalny stok/);
    // Istniejący obiekt zablokowanego typu zostaje (bez zmian – bez odmowy).
    expect(milestoneRefusal(next, next, s, ep)).toBeNull();
    s.progress = { visits: 0, milestone: 1 };
    expect(milestoneRefusal(prev, next, s, ep)).toBeNull();
    // Armatka śmigłowa dopiero od „Lokalnego stoku”, lanca od startu; oświetlenie tras.
    s.progress.milestone = 0;
    expect(lockReason('gun', 'fan', s, mp)).not.toBeNull();
    expect(lockReason('gun', 'lance', s, mp)).toBeNull();
    expect(lockReason('building', 'gastronomy', s, mp)).not.toBeNull();
    expect(lockReason('building', 'bar', s, mp)).toBeNull();
    expect(lockReason('trail', 'bike', s, mp)).not.toBeNull();
    const lit = JSON.parse(JSON.stringify(prev)) as ResortLayout;
    lit.pistes[0].lit = true;
    expect(milestoneRefusal(prev, lit, s, ep)).toMatch(/Oświetlenie/);
    const sb = newGameState({ mode: 'sandbox', seed: 1, date: { year: 2026, month: 6, day: 1 }, ep });
    expect(lockReason('lift', 'gondola', sb, mp)).toBeNull();
    expect(unlocksOf(sb, mp).parcels).toBe(Infinity);
    // Liczba działek i limit kredytu rosną z kamieniami.
    const u0 = unlocksOf(s, mp);
    s.progress.milestone = 2;
    const u2 = unlocksOf(s, mp);
    expect(u2.parcels).toBeGreaterThan(u0.parcels);
    expect(u2.loanLimitPln).toBeGreaterThan(u0.loanLimitPln);
  });
});

describe('Starszy zapis kariery (etap 7g)', () => {
  it('działki pod zbudowanymi obiektami przyznane, kamień z dotychczasowych wyników', () => {
    const s = career();
    delete s.land;
    delete s.progress;
    s.history.push({ guests: 30000 } as never, { guests: 15000 } as never);
    s.reputation = { sum: 4.5 * 1e5, weight: 1e5 };
    const layout = simpleLayout();
    const a = analyzeResort(layout, ctx);
    const n = migrateLegacyCareer(s, layout, a, ep, pg, grid.cellSizeM, grid.widthCells);
    expect(n).toBeGreaterThan(0);
    expect(s.progress!.visits).toBe(45000);
    expect(s.progress!.milestone).toBe(reachableMilestone(45000, reputationOf(s, ep), 2, mp));
    expect(s.progress!.milestone).toBeGreaterThanOrEqual(2);
    // Wczytany układ jest w całości na swoich działkach; nowy obiekt obok – już nie.
    expect(buildRefusal(layout, layout, a, s, ep, pg, grid.cellSizeM, grid.widthCells)).toBeNull();
    const empty: ResortLayout = { version: 1, lifts: [], pistes: [], bases: [], nextId: 1 };
    expect(parcelRefusal(empty, layout, a, s, pg, grid.cellSizeM, grid.widthCells).missing).toEqual([]);
    const far = { ...layout, buildings: [{ id: 'X1', typeId: 'bar', name: 'Bar', xM: 750, yM: 50 }] };
    expect(parcelRefusal(layout, far, a, s, pg, grid.cellSizeM, grid.widthCells).missing).toEqual(['D1']);
  });
});
