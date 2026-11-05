/**
 * Etap 4b – oprawa graficzna „ilustrowana mapa narciarska” (część obliczeniowa bez grafiki):
 * poziomy szczegółowości, determinizm drzew, faktury śniegu, światło pory dnia, zegar gry.
 */
import { describe, expect, it } from 'vitest';
import mapStyleJson from '../data/map-style.json';
import settingsJson from '../data/settings.json';
import { cellHash, hashUnit, lightingForSun, lodWeights, pcgHash, surfaceKind, treesInRect, SURFACE_KINDS } from '../src/render/illustration';
import type { SurfaceInput } from '../src/render/illustration';
import { parseMapStyle } from '../src/render/mapStyle';
import { SNOW_QUALITY_CODES } from '../src/sim/snow';
import { advanceClock, isNightHour, parseSimSettings } from '../src/sim';

const style = parseMapStyle(mapStyleJson).illustrated;
const lod = style.lod;

describe('Poziomy szczegółowości (LOD) dla zoomu', () => {
  it('cały ośrodek – poziom 1, średnie zbliżenie – poziom 2, detal – poziom 3', () => {
    expect(lodWeights(8, lod).level).toBe(1);
    expect(lodWeights(20, lod).level).toBe(1);
    expect(lodWeights(2, lod).level).toBe(2);
    expect(lodWeights(0.25, lod).level).toBe(3);
    // Progi z danych: > ~4 m/px – poziom 1, < ~1 m/px – poziom 3 (makieta A).
    expect(lod.level1AboveMpp).toBeGreaterThanOrEqual(3);
    expect(lod.level1AboveMpp).toBeLessThanOrEqual(5);
    expect(lod.level3BelowMpp).toBeLessThanOrEqual(1);
  });

  it('wagi sumują się do 1 i zmieniają płynnie (bez przeskoków przy zoomie)', () => {
    let prev = lodWeights(0.2, lod);
    let maxJump = 0;
    for (let l = Math.log2(0.2); l <= Math.log2(16); l += 0.01) {
      const w = lodWeights(2 ** l, lod);
      expect(w.w1 + w.w2 + w.w3).toBeCloseTo(1, 9);
      for (const v of [w.w1, w.w2, w.w3]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      maxJump = Math.max(maxJump, Math.abs(w.w1 - prev.w1), Math.abs(w.w2 - prev.w2), Math.abs(w.w3 - prev.w3));
      prev = w;
    }
    // Krok zoomu 1/100 oktawy zmienia wagę najwyżej o kilka procent.
    expect(maxJump).toBeLessThan(0.05);
  });

  it('poziom 1 rośnie z oddaleniem, poziom 3 maleje', () => {
    let w1 = -1;
    let w3 = 2;
    for (const mpp of [0.25, 0.5, 1, 2, 4, 8, 16]) {
      const w = lodWeights(mpp, lod);
      expect(w.w1).toBeGreaterThanOrEqual(w1);
      expect(w.w3).toBeLessThanOrEqual(w3);
      w1 = w.w1;
      w3 = w.w3;
    }
  });
});

describe('Drzewa – deterministyczne (ten sam seed = te same drzewa)', () => {
  const density = (x: number, y: number) => 0.5 + 0.5 * Math.sin(x / 70) * Math.cos(y / 50);
  const params = { spacingM: style.trees.spacingM, heightM: style.trees.heightM, layer: 1 };

  it('ten sam seed – identyczne drzewa; inny seed – inne', () => {
    const a = treesInRect(0, 0, 400, 300, density, 20261105, params);
    const b = treesInRect(0, 0, 400, 300, density, 20261105, params);
    const c = treesInRect(0, 0, 400, 300, density, 777, params);
    expect(a.length).toBeGreaterThan(100);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('wycinek mapy daje te same drzewa co cała mapa (kafle łączą się bez szwów)', () => {
    const whole = treesInRect(0, 0, 400, 400, density, 42, params);
    const left = treesInRect(0, 0, 200, 400, density, 42, params);
    const right = treesInRect(200, 0, 400, 400, density, 42, params);
    const key = (t: { xM: number; yM: number }) => `${t.xM.toFixed(6)},${t.yM.toFixed(6)}`;
    expect([...left, ...right].map(key).sort()).toEqual(whole.map(key).sort());
  });

  it('gęstość lasu: brak lasu – brak drzew, pełny las – prawie każda komórka siatki', () => {
    expect(treesInRect(0, 0, 500, 500, () => 0, 1, params)).toHaveLength(0);
    const full = treesInRect(0, 0, 400, 400, () => 1, 1, params);
    const cells = (400 / params.spacingM) ** 2;
    expect(full.length).toBeGreaterThan(cells * 0.95);
    expect(full.length).toBeLessThanOrEqual(cells + 2 * (400 / params.spacingM) + 1);
    const half = treesInRect(0, 0, 400, 400, () => 0.5, 1, params);
    expect(half.length / full.length).toBeGreaterThan(0.45);
    expect(half.length / full.length).toBeLessThan(0.55);
  });

  it('wysokości i odcienie w zadanym zakresie (0,75–1,25 × wysokość)', () => {
    for (const t of treesInRect(0, 0, 300, 300, () => 1, 5, params)) {
      expect(t.heightM).toBeGreaterThanOrEqual(params.heightM * 0.75);
      expect(t.heightM).toBeLessThanOrEqual(params.heightM * 1.25);
      expect(t.tone).toBeGreaterThanOrEqual(0);
      expect(t.tone).toBeLessThan(1);
    }
  });

  it('skrót PCG zgodny z niezależnym liczeniem na liczbach całkowitych (jak w shaderze, uint32)', () => {
    const ref = (v: number) => {
      const M = 2n ** 32n;
      const state = (BigInt(v >>> 0) * 747796405n + 2891336453n) % M;
      const shift = (state >> 28n) + 4n;
      const word = (((state >> shift) ^ state) * 277803737n) % M;
      return Number((word >> 22n) ^ word);
    };
    for (const v of [0, 1, 2, 12345, 20261105, 0xffffffff, 0x80000000, 987654321]) expect(pcgHash(v)).toBe(ref(v));
    const h = cellHash(10, 20, 20261105, 1);
    expect(hashUnit(h, 0)).toBeGreaterThanOrEqual(0);
    expect(hashUnit(h, 0)).toBeLessThan(1);
    expect(hashUnit(h, 0)).not.toBe(hashUnit(h, 1));
  });
});

describe('Stan śniegu → faktura', () => {
  const t = style.surface;
  const s = (quality: string, extra: Partial<SurfaceInput> = {}): SurfaceInput => ({ quality, depthCm: 40, groomed: 0, skied: 0, ...extra });

  it('każdy stan z modelu śniegu ma fakturę', () => {
    for (const q of SNOW_QUALITY_CODES) expect(SURFACE_KINDS).toContain(surfaceKind(s(q), t));
  });

  it('stany z modelu bez śladów – własna faktura', () => {
    expect(surfaceKind(s('powder'), t)).toBe('powder');
    expect(surfaceKind(s('windPacked'), t)).toBe('windPacked');
    expect(surfaceKind(s('settled'), t)).toBe('settled');
    expect(surfaceKind(s('firn'), t)).toBe('firn');
    expect(surfaceKind(s('slush'), t)).toBe('slush');
    expect(surfaceKind(s('icy'), t)).toBe('icy');
    expect(surfaceKind(s('thin', { depthCm: 3 }), t)).toBe('thin');
  });

  it('brak śniegu – trawa (przetarcia), także przy zerowej grubości', () => {
    expect(surfaceKind(s('none', { depthCm: 0 }), t)).toBe('grass');
    expect(surfaceKind(s('settled', { depthCm: 0 }), t)).toBe('grass');
  });

  it('ratrak – sztruks; dużo przejazdów bez ratraka – muldy; ślady na puchu', () => {
    expect(surfaceKind(s('powder', { groomed: 1 }), t)).toBe('corduroy');
    expect(surfaceKind(s('settled', { groomed: 0.9, skied: 1 }), t)).toBe('corduroy');
    expect(surfaceKind(s('settled', { skied: 0.9 }), t)).toBe('moguls');
    expect(surfaceKind(s('powder', { skied: 0.3 }), t)).toBe('tracked');
    // Słaby ślad poniżej progu – bez zmiany.
    expect(surfaceKind(s('powder', { skied: t.skiedMin / 2 }), t)).toBe('powder');
    expect(surfaceKind(s('settled', { groomed: t.groomedMin / 2 }), t)).toBe('settled');
  });

  it('lód, breja i cienka pokrywa zostają (ratrak ich nie usuwa)', () => {
    expect(surfaceKind(s('icy', { groomed: 1 }), t)).toBe('icy');
    expect(surfaceKind(s('slush', { groomed: 1 }), t)).toBe('slush');
    expect(surfaceKind(s('thin', { groomed: 1 }), t)).toBe('thin');
  });
});

describe('Światło pory dnia', () => {
  it('południe – neutralnie jasno; noc – ciemny granat', () => {
    const noon = lightingForSun(35, 180);
    for (const c of noon.tint) expect(c).toBeGreaterThan(0.97);
    expect(noon.night).toBe(0);
    const night = lightingForSun(-20, 0);
    expect(night.night).toBe(1);
    expect(Math.max(...night.tint)).toBeLessThan(0.45);
    expect(night.tint[2]).toBeGreaterThan(night.tint[0]);
  });

  it('poranek chłodny (niebieskawy), zmierzch ciepły (pomarańczowy)', () => {
    const morning = lightingForSun(2, 125);
    const evening = lightingForSun(2, 235);
    expect(morning.tint[2]).toBeGreaterThan(morning.tint[0]);
    expect(evening.tint[0]).toBeGreaterThan(evening.tint[2]);
  });

  it('przejście dzień → noc płynne', () => {
    let prev = lightingForSun(10, 240).tint;
    for (let e = 10; e >= -10; e -= 0.1) {
      const t = lightingForSun(e, 240).tint;
      for (let i = 0; i < 3; i++) expect(Math.abs(t[i] - prev[i])).toBeLessThan(0.02);
      prev = t;
    }
  });
});

describe('Zegar gry (pauza, ×1, ×5, ×20)', () => {
  const sim = parseSimSettings(settingsJson);
  const p = { gameDayDurationS: sim.gameDayDurationS, nightSpeedup: sim.nightSpeedup };

  it('×1: doba w ok. 10 minut (bez danych o Słońcu – bez przyspieszenia nocy)', () => {
    expect(sim.gameDayDurationS).toBe(600);
    const r = advanceClock(12, 600, 1, p, null, null);
    expect(r.daysAdvanced).toBe(1);
    expect(r.hour).toBeCloseTo(12, 6);
  });

  it('pauza nie zmienia czasu; ×5 i ×20 – odpowiednio szybciej', () => {
    expect(advanceClock(9, 100, 0, p, 7, 16)).toEqual({ hour: 9, daysAdvanced: 0 });
    expect(advanceClock(9, 10, 5, p, 7, 16).hour).toBeCloseTo(9 + (24 / 600) * 5 * 10, 6);
    expect(advanceClock(9, 5, 20, p, 7, 16).hour).toBeCloseTo(9 + (24 / 600) * 20 * 5, 6);
  });

  it('noc przewija się szybciej, dzień zimowy trwa dłużej niż noc w czasie realnym', () => {
    expect(isNightHour(2, 7.5, 15.75)).toBe(true);
    expect(isNightHour(12, 7.5, 15.75)).toBe(false);
    expect(isNightHour(7.2, 7.5, 15.75)).toBe(false); // zmierzch/świt – normalnie
    // Ile sekund realnych trwa pełna doba przy ×1 z nocą przyspieszoną:
    // Od południa do południa następnego dnia, krokami po 0,1 s.
    let h = 12;
    let realS = 0;
    let days = 0;
    while (days === 0 || h < 12) {
      const r = advanceClock(h, 0.1, 1, p, 7.5, 15.75);
      h = r.hour;
      days += r.daysAdvanced;
      realS += 0.1;
    }
    const dayH = 15.75 + 0.5 - (7.5 - 0.5);
    const expected = (dayH / 24) * 600 + ((24 - dayH) / 24) * (600 / p.nightSpeedup);
    expect(realS).toBeGreaterThan(expected - 2);
    expect(realS).toBeLessThan(expected + 2);
    expect(realS).toBeLessThan(600);
  });
});
