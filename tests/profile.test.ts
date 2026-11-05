import { describe, expect, it } from 'vitest';
import { computeProfile } from '../src/sim/profile';
import { planeGrid } from './terrainTestUtils';

describe('Profil terenu', () => {
  it('po płaszczyźnie 30 % w kierunku spadku: stałe nachylenie −30 %, poprawna różnica wysokości', () => {
    const g = planeGrid(30, 180, { width: 40, height: 60 }); // opada na południe
    const a = { xM: 200, yM: 50 };
    const b = { xM: 200, yM: 550 }; // 500 m na południe
    const p = computeProfile(g, a, b);
    expect(p.horizontalDistanceM).toBeCloseTo(500, 9);
    expect(p.elevationDifferenceM).toBeCloseTo(-150, 3);
    for (const s of p.segments) expect(s.slopePercent).toBeCloseTo(-30, 3);
    expect(p.maxSlopePercent).toBeCloseTo(30, 3);
    expect(p.surfaceDistanceM).toBeCloseTo(500 * Math.hypot(1, 0.3), 2);
    expect(p.totalDescentM).toBeCloseTo(150, 3);
    expect(p.totalAscentM).toBeCloseTo(0, 6);
  });

  it('pod górę (B → A) nachylenie dodatnie, w poprzek stoku – zerowe', () => {
    const g = planeGrid(30, 180, { width: 40, height: 60 });
    const up = computeProfile(g, { xM: 200, yM: 550 }, { xM: 200, yM: 50 });
    expect(up.elevationDifferenceM).toBeCloseTo(150, 3);
    for (const s of up.segments) expect(s.slopePercent).toBeCloseTo(30, 3);
    const across = computeProfile(g, { xM: 20, yM: 300 }, { xM: 380, yM: 300 });
    expect(across.elevationDifferenceM).toBeCloseTo(0, 3);
    expect(across.maxSlopePercent).toBeCloseTo(0, 3);
  });

  it('po skosie: nachylenie = nachylenie stoku × cos(kąta między profilem a spadkiem)', () => {
    const g = planeGrid(30, 180, { width: 60, height: 60 });
    const p = computeProfile(g, { xM: 100, yM: 100 }, { xM: 400, yM: 400 }); // kierunek SE (45° od spadku)
    for (const s of p.segments) expect(s.slopePercent).toBeCloseTo(-30 * Math.cos(Math.PI / 4), 3);
    expect(p.elevationDifferenceM).toBeCloseTo(-0.3 * 300, 3);
  });

  it('krok próbkowania nie większy niż komórka siatki', () => {
    const g = planeGrid(10, 0);
    const p = computeProfile(g, { xM: 10, yM: 10 }, { xM: 205, yM: 10 });
    expect(p.segments.length).toBe(20);
    for (const s of p.segments) expect(s.toDistanceM - s.fromDistanceM).toBeLessThanOrEqual(10);
  });

  it('odcinki poza mapą mają nachylenie NaN i nie psują statystyk', () => {
    const g = planeGrid(30, 180, { width: 20, height: 20 });
    for (let i = 0; i < 20; i++) for (let j = 15; j < 20; j++) g.elevationM[g.index(i, j)] = Number.NaN;
    const p = computeProfile(g, { xM: 100, yM: 20 }, { xM: 100, yM: 195 });
    expect(p.segments.some((s) => Number.isNaN(s.slopePercent))).toBe(true);
    expect(p.maxSlopePercent).toBeCloseTo(30, 3);
    expect(Number.isFinite(p.maxElevationM)).toBe(true);
  });
});
