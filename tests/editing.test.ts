/**
 * Etap 5b: edycja geometrii (punkty osi trasy, załamania wyciągów, stacje pośrednie, ręczne podpory),
 * podłoże terenu, baza ubita i ostrzeżenia „za mało śniegu”, goście na zbyt cienkiej bazie,
 * zamknięte trasy i wyciągi bez otwartego zjazdu.
 */
import { describe, expect, it, vi } from 'vitest';
import constructionJson from '../data/construction.json';
import snowJson from '../data/snow.json';
import { GROUND_FOREST, GROUND_GRADED, GROUND_MEADOW, GROUND_ROCKY, GROUND_STUMPS, groundAfterWorks, initialGround, parseGroundParams } from '../src/sim/ground';
import { buildGuestNet } from '../src/sim/guestNetwork';
import type { LiftDesign } from '../src/sim/lifts';
import { analyzeLift, bendAngleDeg, designLift, liftPath, retowerLift } from '../src/sim/lifts';
import type { PisteDesign } from '../src/sim/pistes';
import { analyzePiste } from '../src/sim/pistes';
import type { ResortLayout } from '../src/sim/resort';
import { analyzeResort, emptyLayout, parseLayout, serializeLayout } from '../src/sim/resort';
import { minBaseCm, packedBaseCm, parseRidingParams, thinField, thinSegments } from '../src/sim/snowRiding';
import { buildFixture, fixtureGrid, gp, goodSnow, lp, newDay, pp } from './guestFixture';

vi.setConfig({ testTimeout: 120_000 });

const noCost = { forestCostPlnPerM2: 0, shrubCostPlnPerM2: 0, daysPerHectare: 0 };
const riding = parseRidingParams(snowJson);
const groundParams = parseGroundParams(constructionJson);

// Teren testowy (guestFixture): na zachodzie (x ≈ 150 m) stok 8 %, na wschodzie (x ≈ 650 m) 50 %.
const grid = fixtureGrid();
const pisteCtx = { grid, params: pp, forest: null, shrub: null, clearingCost: noCost };
const liftCtx = (others: LiftDesign[] = []) => ({ grid, params: lp, forest: null, shrub: null, clearingCost: noCost, otherLifts: others });

function piste(points: [number, number][], widthM = 30): PisteDesign {
  return { id: 'T1', name: '1', points: points.map(([xM, yM]) => ({ xM, yM, widthM })) };
}

const cellAt = (x: number, y: number) => {
  const c = grid.cellAt(x, y);
  return c ? grid.index(c.i, c.j) : -1;
};

describe('Edycja osi trasy', () => {
  const base = piste([[150, 100], [150, 500], [150, 900], [150, 1250]]);

  it('przesunięcie punktu osi zmienia profil i klasyfikację trudności', () => {
    const a0 = analyzePiste(base, pisteCtx);
    expect(pp.classes[a0.classIndex].id).toBe('green');
    // Środkowy punkt przeciągnięty na stromy wschodni stok: trasa robi pętlę przez stromiznę.
    const moved: PisteDesign = { ...base, points: base.points.map((q, i) => (i === 2 ? { ...q, xM: 650 } : q)) };
    const a1 = analyzePiste(moved, pisteCtx);
    expect(a1.classIndex).toBeGreaterThan(a0.classIndex);
    expect(a1.lengthM).toBeGreaterThan(a0.lengthM + 500);
    // Profil: inne wysokości w tych samych odległościach od startu.
    const at = (a: typeof a0, d: number) => a.axis.reduce((b, s) => (Math.abs(s.distanceM - d) < Math.abs(b.distanceM - d) ? s : b)).elevationM;
    expect(Math.abs(at(a1, 900) - at(a0, 900))).toBeGreaterThan(5);
  });

  it('usunięcie punktu osi działa (trasa nadal poprawna, krótsza o objazd)', () => {
    const detour = piste([[150, 100], [150, 500], [400, 700], [150, 900], [150, 1250]]);
    const a0 = analyzePiste(detour, pisteCtx);
    const removed: PisteDesign = { ...detour, points: detour.points.filter((_, i) => i !== 2) };
    expect(removed.points).toHaveLength(4);
    const a1 = analyzePiste(removed, pisteCtx);
    expect(a1.lengthM).toBeLessThan(a0.lengthM - 50);
    expect(a1.lengthM).toBeCloseTo(analyzePiste(base, pisteCtx).lengthM, 0);
    expect(a1.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('zmiana szerokości w jednym punkcie zmienia obrys (więcej komórek) i koszt', () => {
    const a0 = analyzePiste(base, pisteCtx);
    const wide: PisteDesign = { ...base, points: base.points.map((q, i) => (i === 1 ? { ...q, widthM: 70 } : q)) };
    const a1 = analyzePiste(wide, pisteCtx);
    expect(a1.cells.length).toBeGreaterThan(a0.cells.length);
    expect(a1.meanWidthM).toBeGreaterThan(a0.meanWidthM);
    expect(a1.areaM2).toBeGreaterThan(a0.areaM2);
    expect(a1.cost.totalPln).toBeGreaterThan(a0.cost.totalPln);
  });
});

describe('Wyciągi z załamaniami', () => {
  const bottom = { xM: 380, yM: 1300 };
  const top = { xM: 150, yM: 110 };

  it('kąt załamania liczony między kierunkami odcinków', () => {
    expect(bendAngleDeg({ xM: 0, yM: 0 }, { xM: 0, yM: 100 }, { xM: 0, yM: 200 })).toBeCloseTo(0, 6);
    expect(bendAngleDeg({ xM: 0, yM: 0 }, { xM: 0, yM: 100 }, { xM: 100, yM: 200 })).toBeCloseTo(45, 6);
  });

  it('stacja kątowa w dopuszczalnym kącie – wyciąg poprawny, droższy, z polem stacji', () => {
    const straight = designLift(grid, lp, 'W1', 'kanapa4s', 'W1', bottom, top);
    const bent = designLift(grid, lp, 'W1', 'kanapa4s', 'W1', bottom, top, [{ xM: 330, yM: 700 }]);
    const a0 = analyzeLift(straight, liftCtx());
    const a1 = analyzeLift(bent, liftCtx());
    expect(a1.ok).toBe(true);
    expect(a1.bendInfo).toHaveLength(1);
    expect(a1.bendInfo[0].angleDeg).toBeGreaterThan(5);
    expect(a1.bendInfo[0].angleDeg).toBeLessThan(lp.types.find((t) => t.id === 'kanapa4s')!.maxBendDeg);
    expect(a1.cost.bendsPln).toBeGreaterThan(0);
    expect(a1.cost.totalPln).toBeGreaterThan(a0.cost.totalPln);
    expect(a1.bendAreaM2).toBeGreaterThan(0);
    // Podpory nie stoją w stacji kątowej, linia ma prześwit.
    expect(a1.minClearanceM).toBeGreaterThanOrEqual(lp.types.find((t) => t.id === 'kanapa4s')!.minClearanceM - 0.01);
  });

  it('stacja kątowa przekraczająca dopuszczalny kąt jest odrzucana (kanapa i orczyk)', () => {
    // Ostre załamanie (ok. 57°) na kanapie – limit 45°.
    const sharp = designLift(grid, lp, 'W1', 'kanapa4s', 'W1', bottom, top, [{ xM: 600, yM: 700 }]);
    expect(bendAngleDeg(bottom, { xM: 600, yM: 700 }, top)).toBeGreaterThan(50);
    const a = analyzeLift(sharp, liftCtx());
    expect(a.ok).toBe(false);
    expect(a.issues.some((i) => i.severity === 'error' && /załamanie \d+° .*najwyżej 45°/.test(i.message))).toBe(true);
    // Orczyk: koła odchylające tylko do 8° – załamanie 20° odrzucone, 5° przyjęte.
    const b = { xM: 150, yM: 1250 };
    const t = { xM: 150, yM: 450 };
    const mid = (deg: number) => {
      // Punkt w połowie, przesunięty w bok tak, by kąt między odcinkami wynosił deg.
      const half = 400;
      const off = Math.tan((deg / 2) * (Math.PI / 180)) * half;
      return { xM: 150 + off, yM: 850 };
    };
    const ok = analyzeLift(designLift(grid, lp, 'O1', 'orczyk', 'O1', b, t, [mid(5)]), liftCtx());
    const bad = analyzeLift(designLift(grid, lp, 'O1', 'orczyk', 'O1', b, t, [mid(20)]), liftCtx());
    expect(ok.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => /najwyżej 8°/.test(i.message))).toBe(true);
    // Stacja pośrednia z wsiadaniem na orczyku – niedozwolona.
    const midT = analyzeLift(designLift(grid, lp, 'O1', 'orczyk', 'O1', b, t, [{ ...mid(5), mid: true }]), liftCtx());
    expect(midT.issues.some((i) => /stacja pośrednia/.test(i.message))).toBe(true);
  });

  it('stacja pośrednia jest węzłem grafu sieci i przystankiem dla gości', () => {
    const lift = designLift(grid, lp, 'W1', 'kanapa4s', 'W1', bottom, top, [{ xM: 330, yM: 700, mid: true }]);
    const layout: ResortLayout = {
      ...emptyLayout(),
      lifts: [lift],
      pistes: [piste([[170, 95], [150, 400], [150, 1240], [380, 1310]], 40)],
    };
    const a = analyzeResort(layout, { grid, lifts: lp, pistes: pp, clearing: noCost, forest: null, shrub: null });
    const midNode = a.network.nodes.find((n) => n.kind === 'liftMid');
    expect(midNode?.id).toBe('W1:pośr1');
    // Wyciąg w grafie: dół → pośrednia → góra.
    expect(a.network.edges).toContainEqual(expect.objectContaining({ kind: 'lift', from: 'W1:dół', to: 'W1:pośr1' }));
    expect(a.network.edges).toContainEqual(expect.objectContaining({ kind: 'lift', from: 'W1:pośr1', to: 'W1:góra' }));
    // Goście: wyciąg z trzema przystankami; ze stacji pośredniej można wsiąść.
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
    });
    expect(net.lifts[0].stops).toHaveLength(3);
    expect(net.boardings.filter((b) => b.lift === 0).map((b) => b.stop)).toEqual([0, 1]);
  });

  it('przesunięcie stacji: ręczne podpory zostają, gdy spełniają warunki; podpory zawsze z prześwitem', () => {
    const lift = designLift(grid, lp, 'W1', 'kanapa4s', 'W1', bottom, top);
    // Gracz przesunął jedną podporę (ręcznie).
    const t0 = lift.towers[1];
    const manualTower = { distanceM: t0.distanceM + 15, heightM: t0.heightM - 2 };
    const manual: LiftDesign = { ...lift, towers: lift.towers.map((t, i) => (i === 1 ? manualTower : t)), manualTowers: true };
    // Górna stacja przesunięta o 40 m dalej w tym samym kierunku – podpora leży dalej na linii.
    const dx = top.xM - bottom.xM;
    const dy = top.yM - bottom.yM;
    const len = Math.hypot(dx, dy);
    const moved: LiftDesign = { ...manual, top: { xM: top.xM + (dx / len) * 40, yM: top.yM + (dy / len) * 40 } };
    const towers = retowerLift(grid, lp, moved, manual);
    expect(towers.some((t) => Math.abs(t.distanceM - manualTower.distanceM) < 1 && Math.abs(t.heightM - manualTower.heightM) < 0.01)).toBe(true);
    const a = analyzeLift({ ...moved, towers }, liftCtx());
    expect(a.ok).toBe(true);
    // Bez ręcznych zmian – podpory od nowa (jak automat).
    const auto = retowerLift(grid, lp, { ...lift, top: moved.top }, lift);
    expect(auto).toEqual(designLift(grid, lp, 'W1', 'kanapa4s', 'W1', bottom, moved.top).towers);
    expect(liftPath(moved)).toHaveLength(2);
  });

  it('układ z załamaniami, wyrównaniem i stanem ośrodka – zapis i odczyt', () => {
    const lift = designLift(grid, lp, 'W1', 'kanapa4s', 'W1', bottom, top, [{ xM: 330, yM: 700, mid: true }]);
    const layout: ResortLayout = { ...emptyLayout(), lifts: [lift], pistes: [{ ...piste([[150, 100], [150, 1250]]), graded: true }], resortOpen: false };
    const back = parseLayout(JSON.parse(serializeLayout(layout)));
    expect(back.lifts[0].bends).toEqual([{ xM: 330, yM: 700, mid: true }]);
    expect(back.pistes[0].graded).toBe(true);
    expect(back.resortOpen).toBe(false);
  });
});

describe('Podłoże terenu', () => {
  it('las → po wycince pniaki; wyrównana trasa → łąka wyrównana; stromizna i kosodrzewina → kamienie', () => {
    const n = grid.cellCount;
    const forest = new Float32Array(n);
    const shrub = new Float32Array(n);
    const kForest = cellAt(150, 600);
    const kShrub = cellAt(150, 300);
    forest[kForest] = 0.9;
    shrub[kShrub] = 0.8;
    const g0 = initialGround(grid, forest, shrub, groundParams);
    expect(g0[kForest]).toBe(GROUND_FOREST);
    expect(g0[kShrub]).toBe(GROUND_ROCKY);
    expect(g0[cellAt(150, 900)]).toBe(GROUND_MEADOW);
    expect(g0[cellAt(650, 600)]).toBe(GROUND_MEADOW); // 50 % – jeszcze łąka (skała od 70 %)
    const cleared = new Uint8Array(n);
    cleared[kForest] = 1;
    const graded = new Uint8Array(n);
    graded[cellAt(150, 900)] = 1;
    const g1 = groundAfterWorks(g0, cleared, graded);
    expect(g1[kForest]).toBe(GROUND_STUMPS);
    expect(g1[cellAt(150, 900)]).toBe(GROUND_GRADED);
  });

  it('wyrównanie terenu przy budowie trasy kosztuje, kamienie drożej niż łąka', () => {
    const p = piste([[150, 100], [150, 1250]]);
    const meadow = new Uint8Array(grid.cellCount).fill(GROUND_MEADOW);
    const rocky = new Uint8Array(grid.cellCount).fill(GROUND_ROCKY);
    const leveling = { costPlnPerM2: groundParams.levelingCostPlnPerM2, daysPerHectare: groundParams.levelingDaysPerHectare };
    const plain = analyzePiste(p, { ...pisteCtx, baseGround: meadow, leveling });
    const gM = analyzePiste({ ...p, graded: true }, { ...pisteCtx, baseGround: meadow, leveling });
    const gR = analyzePiste({ ...p, graded: true }, { ...pisteCtx, baseGround: rocky, leveling });
    expect(plain.cost.levelingPln).toBe(0);
    expect(gM.cost.levelingPln).toBeGreaterThan(0);
    expect(gR.cost.levelingPln).toBeGreaterThan(gM.cost.levelingPln);
    expect(gR.buildDays).toBeGreaterThan(plain.buildDays);
  });
});

describe('Baza ubita i minimalna grubość', () => {
  it('10 cm puchu po ubiciu daje bazę poniżej minimum na każdym podłożu', () => {
    // Puch: gęstość ok. 100 kg/m³ → 10 cm = 10 mm wody (SWE).
    const sweMm = 0.1 * 100;
    const base = packedBaseCm(sweMm, riding);
    expect(base).toBeCloseTo((10 / riding.packedDensityKgM3) * 100, 6);
    expect(base).toBeLessThan(3);
    for (const g of [GROUND_GRADED, GROUND_MEADOW, GROUND_ROCKY, GROUND_STUMPS]) expect(base).toBeLessThan(minBaseCm(g, riding));
    // Progi rosną: wyrównana < łąka < pniaki < kamienie.
    expect(minBaseCm(GROUND_GRADED, riding)).toBeLessThan(minBaseCm(GROUND_MEADOW, riding));
    expect(minBaseCm(GROUND_MEADOW, riding)).toBeLessThan(minBaseCm(GROUND_STUMPS, riding));
    expect(minBaseCm(GROUND_STUMPS, riding)).toBeLessThan(minBaseCm(GROUND_ROCKY, riding));
  });

  it('ostrzeżenie „za mało śniegu” – odcinki trasy z bazą i wymaganą grubością', () => {
    const a = analyzePiste(piste([[150, 100], [150, 1250]]), pisteCtx);
    const axis = a.axis.filter((s) => !Number.isNaN(s.elevationM));
    const ground = new Uint8Array(grid.cellCount).fill(GROUND_MEADOW);
    // Wszędzie 10 cm puchu – cała trasa za cienka.
    const thinSwe = new Float32Array(grid.cellCount).fill(10);
    const segs = thinSegments(axis, cellAt, thinSwe, ground, riding);
    expect(segs).toHaveLength(1);
    expect(segs[0].fromM).toBe(0);
    expect(segs[0].toM).toBeGreaterThan(a.lengthM - 20);
    expect(segs[0].baseCm).toBeLessThan(3);
    expect(segs[0].neededCm).toBe(minBaseCm(GROUND_MEADOW, riding));
    // Gruba baza (150 mm wody ≈ 36 cm ubitego) wszędzie poza pasem y 600–700 m – jeden odcinek ok. 100 m.
    const swe = new Float32Array(grid.cellCount).fill(150);
    for (let k = 0; k < grid.cellCount; k++) {
      const y = (Math.floor(k / grid.widthCells) + 0.5) * grid.cellSizeM;
      if (y > 600 && y < 700) swe[k] = 20;
    }
    const segs2 = thinSegments(axis, cellAt, swe, ground, riding);
    expect(segs2).toHaveLength(1);
    expect(segs2[0].toM - segs2[0].fromM).toBeGreaterThan(80);
    expect(segs2[0].toM - segs2[0].fromM).toBeLessThan(130);
    // Wyrównana łąka potrzebuje mniej: 20 mm wody ≈ 4,8 cm – nadal za mało, ale 80 mm ≈ 19 cm wystarcza.
    const graded = new Uint8Array(grid.cellCount).fill(GROUND_GRADED);
    swe.fill(80);
    expect(thinSegments(axis, cellAt, swe, graded, riding)).toEqual([]);
    expect(thinSegments(axis, cellAt, swe, ground, riding)).toHaveLength(1);
  });
});

describe('Goście a śnieg i otwarcie tras', () => {
  it('na zbyt cienkiej bazie więcej wypadków, uszkodzenia sprzętu i niższe oceny (te same osoby, ten sam seed)', () => {
    const f = buildFixture();
    const good = newDay(f, 1500, 777);
    const thin = newDay(f, 1500, 777);
    thin.setSnow({ ...goodSnow(f.grid), thin: new Float32Array(f.grid.cellCount).fill(0.7) });
    good.advanceTo(17 * 3600);
    thin.advanceTo(17 * 3600);
    const rg = good.report();
    const rt = thin.report();
    expect(rt.counts.arrived).toBe(rg.counts.arrived);
    expect(rt.accidents.length).toBeGreaterThan(rg.accidents.length * 1.5);
    expect(rt.equipmentDamage).toBeGreaterThan(0);
    expect(rg.equipmentDamage).toBe(0);
    expect(rt.meanRating).toBeLessThan(rg.meanRating - 0.2);
  });

  it('zamknięta trasa ma zero przejazdów; wyciąg bez otwartej trasy w dół nie pracuje', () => {
    const f = buildFixture({ closeBlack: true });
    const d = newDay(f, 1500);
    d.advanceTo(17 * 3600);
    const analysis = analyzeResort(f.layout, { grid: f.grid, lifts: lp, pistes: pp, clearing: noCost, forest: null, shrub: null });
    const black = analysis.pistes.get('T2')!;
    const green = analysis.pistes.get('T1')!;
    const greenCells = new Set(green.cells);
    let blackPasses = 0;
    for (const k of black.cells) if (!greenCells.has(k)) blackPasses += d.passes[k];
    expect(blackPasses).toBe(0);
    let greenPasses = 0;
    for (const k of green.cells) greenPasses += d.passes[k];
    expect(greenPasses).toBeGreaterThan(1000);
    // W2 prowadzi tylko na czarną (zamkniętą) – stoi, nikt nim nie wjechał.
    const w2 = f.net.lifts.findIndex((l) => l.id === 'W2');
    expect(d.liftHasDescent[w2]).toBe(0);
    expect(d.liftBoarded[w2]).toBe(0);
    expect(d.liftBoarded[1 - w2]).toBeGreaterThan(500);
  });

  it('pole „za cienko” w komórkach: 0 przy dobrej bazie, rośnie, gdy śniegu ubywa; las pominięty', () => {
    const n = 4;
    const ground = Uint8Array.from([GROUND_MEADOW, GROUND_MEADOW, GROUND_MEADOW, GROUND_FOREST]);
    const swe = Float32Array.from([200, 50, 0, 0]);
    const f = thinField(swe, ground, riding);
    expect(f).toHaveLength(n);
    expect(f[0]).toBe(0);
    expect(f[1]).toBeGreaterThan(0);
    expect(f[2]).toBe(1);
    expect(f[3]).toBe(0);
  });
});
