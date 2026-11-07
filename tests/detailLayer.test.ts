/**
 * Etap 7d: warstwa detalu 1 m w korytarzach tras.
 * - przejazd ratraka zmienia kierunek sztruksu na swojej drodze (i tylko tam),
 * - 500 przejazdów narciarzy na stromym odcinku tworzy muldy (na łagodnym – nie),
 * - warstwa 1 m zgadza się z siatką 10 m (średnie muld, pryzm, lodu, przetarć w komórkach 10 m).
 */
import { describe, expect, it } from 'vitest';

import detailJson from '../data/detail.json';
import { DetailLayer, axialDiff, decodeAxial, groomWholeJob, parseDetailParams, wornFraction } from '../src/sim/detailLayer';
import type { DetailGrid } from '../src/sim/detailLayer';

const p = parseDetailParams(detailJson);
const rule = { mogulMinSlopePercent: 22, passesToMoguls: 600 };

/** Stok 400 × 400 m (komórki 10 m): górna połowa nachylenie 40 %, dolna 10 %, spadek w kierunku +y. */
function slopeGrid(): DetailGrid {
  const W = 40;
  const H = 40;
  const z = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const y = j * 10;
      z[j * W + i] = 2000 - (y < 200 ? 0.4 * y : 80 + 0.1 * (y - 200));
    }
  }
  return { widthCells: W, heightCells: H, cellSizeM: 10, elevationM: z };
}

function layerWithPiste(): { layer: DetailLayer; cells: number[] } {
  const g = slopeGrid();
  const layer = new DetailLayer(g, p, 42);
  const cells: number[] = [];
  for (let j = 2; j < 38; j++) for (let i = 16; i < 24; i++) cells.push(j * 40 + i);
  layer.setCorridors(cells);
  return { layer, cells };
}

describe('Warstwa detalu 1 m', () => {
  it('korytarz: komórki trasy + pierścień, 100 komórek 1 m na komórkę 10 m', () => {
    const { layer } = layerWithPiste();
    expect(layer.per).toBe(100);
    expect(layer.blockOf[20 * 40 + 15]).toBeGreaterThanOrEqual(0); // pierścień
    expect(layer.blockOf[20 * 40 + 10]).toBe(-1);
  });

  it('przejazd ratraka zmienia kierunek sztruksu na swojej drodze, poza nią nie', () => {
    const { layer } = layerWithPiste();
    // Najpierw cała trasa ratrakowana w poprzek (kierunek x).
    for (let y = 30; y < 370; y += 5) layer.groomSegment(160, y, 240, y, 5.5, 1);
    const before = decodeAxial(layer.groomDir[layer.indexAt(200, 150)]);
    expect(axialDiff(before, 0)).toBeLessThan(0.05);
    // Ratrak jedzie w dół stoku (kierunek y) środkiem trasy.
    const axis = [0, 100, 200, 300].map((d) => ({ xM: 200, yM: 40 + d, distanceM: d, widthM: 5 }));
    groomWholeJob(layer, axis, 5.5, 20, 22);
    const on = decodeAxial(layer.groomDir[layer.indexAt(200.5, 150.5)]);
    expect(axialDiff(on, Math.PI / 2)).toBeLessThan(0.05);
    expect(layer.groomT[layer.indexAt(200.5, 150.5)]).toBeGreaterThan(20);
    // Poza drogą ratraka (10 m obok) kierunek bez zmian.
    const off = decodeAxial(layer.groomDir[layer.indexAt(215.5, 150.5)]);
    expect(axialDiff(off, 0)).toBeLessThan(0.05);
  });

  it('500 przejazdów narciarzy na stromym odcinku tworzy muldy, na łagodnym nie', () => {
    const { layer } = layerWithPiste();
    const passes = new Float32Array(1600);
    for (const k of layer.cells) passes[k] = 500;
    layer.applyPasses(passes, rule, null);
    const steep = 10 * 40 + 20; // y = 100 m, nachylenie 40 %
    const gentle = 30 * 40 + 20; // y = 300 m, nachylenie 10 %
    expect(layer.slopePercent[steep]).toBeCloseTo(40, 0);
    expect(layer.blockMean(layer.mogul, steep)).toBeGreaterThan(0.1);
    // Garby i dołki: najwyższy punkt wyraźnie ponad średnią.
    const b = layer.blockOf[steep];
    expect(Math.max(...layer.mogul.subarray(b * 100, b * 100 + 100))).toBeGreaterThan(1.5 * layer.blockMean(layer.mogul, steep));
    expect(layer.blockMean(layer.mogul, gentle)).toBe(0);
    // Ślady zatarły sztruks (intensywność śladów wysoka).
    expect(layer.blockMean(layer.tracks, steep)).toBeGreaterThan(200);
    // Na zakrętach muldy rosną szybciej.
    const { layer: l2 } = layerWithPiste();
    const turn = new Float32Array(1600).fill(1);
    const few = new Float32Array(1600);
    for (const k of l2.cells) few[k] = 100;
    l2.applyPasses(few, rule, turn);
    const { layer: l3 } = layerWithPiste();
    l3.applyPasses(few, rule, null);
    expect(l2.blockMean(l2.mogul, steep)).toBeGreaterThan(l3.blockMean(l3.mogul, steep));
  });

  it('warstwa 1 m zgadza się z siatką 10 m (średnie w każdej komórce)', () => {
    const { layer } = layerWithPiste();
    const n = 1600;
    const moguls = new Float32Array(n);
    const pile = new Float32Array(n);
    const quality = new Uint8Array(n).fill(3);
    const thin = new Float32Array(n);
    let s = 7;
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const k of layer.cells) {
      moguls[k] = r();
      pile[k] = r() < 0.3 ? 40 * r() : 0;
      thin[k] = r() < 0.2 ? r() : 0;
      if (r() < 0.1) quality[k] = 6;
    }
    // Pryzma z kształtem pod armatką + kilka przejazdów ratraka przed uzgodnieniem.
    layer.addPile(200, 120, 300);
    layer.groomSegment(170, 250, 230, 250, 5.5, 3);
    layer.syncTo10m(moguls, pile, quality, thin);
    for (const k of layer.cells) {
      expect(layer.blockMean(layer.mogul, k)).toBeCloseTo(moguls[k] * p.mogulMaxHeightM * 0.5, 6);
      expect(layer.blockMean(layer.pile, k)).toBeCloseTo(pile[k], 4);
      expect(layer.blockMean(layer.ice, k) / 255).toBe(quality[k] === 6 ? 1 : 0);
      expect(Math.abs(layer.blockMean(layer.worn, k) / 255 - (layer.blockMean(layer.onPiste, k) / 255) * wornFraction(thin[k], p))).toBeLessThan(0.02);
    }
  });

  it('świeży śnieg zasypuje ślady; ślad nart zostaje na swojej linii', () => {
    const { layer } = layerWithPiste();
    layer.skiSegment(180, 60, 180, 160);
    const on = layer.tracks[layer.indexAt(180.2, 100.5)];
    expect(on).toBeGreaterThan(0);
    expect(layer.tracks[layer.indexAt(190.5, 100.5)]).toBe(0);
    layer.weather(20);
    expect(layer.tracks[layer.indexAt(180.2, 100.5)]).toBeLessThan(on * 0.1);
    expect(layer.fresh[layer.indexAt(190.5, 100.5)]).toBeGreaterThan(200);
  });
});
