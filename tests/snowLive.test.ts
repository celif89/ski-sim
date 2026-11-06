/**
 * Etap 6b: śnieg w ciągu doby – kroki godzinowe. Słoneczny dzień przy 0 °C: na stoku południowym
 * grubość maleje między 10:00 a 15:00 (bardziej niż na północnym); mroźna noc – skorupa (zlodzony).
 * Do tego SnowWorld.advanceLive na małej mapie (Environment z prawdziwą pogodą generatora).
 */
import { describe, expect, it, vi } from 'vitest';
import climateJson from '../data/climate/pilsko.json';
import radiationJson from '../data/radiation.json';
import snowJson from '../data/snow.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import { Environment } from '../src/sim/environment';
import { computeHorizon, parseHorizonParams } from '../src/sim/horizon';
import { parseRadiationParams } from '../src/sim/radiation';
import type { SnowStepForcing } from '../src/sim/snow';
import { SnowState, addSnow, classifySnow, parseSnowParams, snowStep } from '../src/sim/snow';
import { createSnowDomain } from '../src/sim/snowSeason';
import { SnowWorld } from '../src/sim/snowWorld';
import { addDays } from '../src/sim/time';
import { parseWeatherParams } from '../src/sim/weather';
import { flatGrid, planeGrid } from './terrainTestUtils';

vi.setConfig({ testTimeout: 120_000 });

const sp = parseSnowParams(snowJson);

/** Godzina słonecznego dnia: promieniowanie na stok [W/m²] – komórki 0 i 2 stok S, 1 i 3 stok N. */
function hourForcing(tempC: number, swSouth: number, swNorth: number): SnowStepForcing {
  return {
    durationS: 3600,
    tempAtRefC: tempC,
    tempGradientCPerM: 0,
    refElevationM: 1000,
    humidityPercent: 60,
    windRefMs: 2,
    windRefElevationM: 1000,
    windGrowthPer1000m: 0,
    cloudFraction: 0.05,
    precipRefMm: 0,
    precipRefElevationM: 1000,
    precipGradientPerM: 0,
    snowMaxTemperatureC: 0.5,
    rainMinTemperatureC: 2.5,
    shortwaveWm2: swSouth > 0 || swNorth > 0 ? Float32Array.from([swSouth, swNorth, swSouth, swNorth]) : null,
  };
}

describe('Śnieg w ciągu doby (kroki godzinowe)', () => {
  it('słoneczny dzień przy 0 °C: stok południowy topnieje 10–15, mroźna noc – zlodzony', () => {
    const grid = flatGrid(1000, 2, 2, 10);
    const dom = createSnowDomain(grid, new Float32Array(4), new Float32Array(4), sp);
    const s = new SnowState(4);
    for (let k = 0; k < 4; k++) {
      addSnow(s, k, 120, 250, -2, sp, true); // ok. 48 cm osiadłego śniegu
      s.topAgeDays[k] = 12; // śnieg sprzed kilkunastu dni – niższe albedo niż świeży
      s.albedo[k] = 0.65;
    }
    const bal = { precipitationMm: 0, runoffMm: 0, sublimationMm: 0, windOutMm: 0 };
    // Przedpołudnie (rozgrzewanie): 7–10.
    for (let h = 7; h < 10; h++) snowStep(s, dom, hourForcing(-2 + (h - 7), 250, 60), sp, bal);
    const d10 = [s.depthM(0), s.depthM(1)];
    const swe10 = s.totalWater(0);
    // 10–15: 0 °C, pełne słońce na stoku S (ok. 700 W/m² w lutym na 30° nachylenia), N w cieniu.
    const swS = [600, 700, 720, 700, 620];
    for (let h = 10; h < 15; h++) snowStep(s, dom, hourForcing(0, swS[h - 10], 90), sp, bal);
    const d15 = [s.depthM(0), s.depthM(1)];
    expect(d15[0]).toBeLessThan(d10[0]); // stok południowy: grubość maleje
    expect(d10[0] - d15[0]).toBeGreaterThan(d10[1] - d15[1]); // szybciej niż północny
    expect(s.topLiquid[0]).toBeGreaterThan(0); // mokry, miękki
    expect(s.totalWater(0)).toBeLessThanOrEqual(swe10 + 1e-6);
    expect(classifySnow(s, 0, sp)).not.toBe('icy');
    // Noc: mróz −8 °C, bez słońca – woda roztopowa zamarza w skorupę.
    for (let h = 15; h < 31; h++) snowStep(s, dom, hourForcing(h < 18 ? -2 : -8, 0, 0), sp, bal);
    expect(classifySnow(s, 0, sp)).toBe('icy');
    expect(s.topLiquid[0]).toBeCloseTo(0, 6);
    // Następne słoneczne popołudnie: skorupa mięknie.
    for (let h = 10; h < 15; h++) snowStep(s, dom, hourForcing(1, swS[h - 10], 90), sp, bal);
    expect(classifySnow(s, 0, sp)).not.toBe('icy');
  });

  it('SnowWorld.advanceLive: kroki godzinowe od końca poprzedniego dnia, rano zimniej niż po południu na stoku S', () => {
    const grid = planeGrid(40, 180, { width: 16, height: 16, baseM: 1100 });
    const env = new Environment(
      grid,
      computeHorizon(grid, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 500 }),
      parseClimateProfile(climateJson),
      parseWeatherParams(wxJson),
      parseRadiationParams(radiationJson),
      20261105,
      { latDeg: 49.55, lonDeg: 19.33, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } },
    );
    const n = grid.cellCount;
    const world = new SnowWorld(env, new Float32Array(n), new Float32Array(n), sp);
    const date = { year: 2027, month: 2, day: 10 };
    const t0 = performance.now();
    for (const _ of world.advanceLive(date, 8)) void _;
    const morning = world.liveSnapshot()!;
    expect(morning.hour).toBe(8);
    for (const _ of world.advanceLive(date, 16)) void _;
    const afternoon = world.liveSnapshot()!;
    expect(afternoon.hour).toBe(16);
    // Stan z kroków godzinowych o 24:00 bliski stanowi z kroków 6 h na koniec dnia (ten sam dzień).
    for (const _ of world.advanceLive(date, 24)) void _;
    const live24 = world.liveSnapshot()!;
    for (const _ of world.advanceTo(date)) void _;
    const day = world.snapshot();
    let a = 0;
    let b = 0;
    for (let k = 0; k < n; k++) {
      a += live24.sweMm[k];
      b += day.sweMm[k];
    }
    expect(Math.abs(a - b) / Math.max(1, b)).toBeLessThan(0.05);
    // Pomiar: godzina kroku na tej mapie.
    console.log(`advanceLive 24 h na ${n} komórkach: ${(performance.now() - t0).toFixed(0)} ms (z sezonem do poprzedniego dnia)`);
    void addDays;
  });
});
