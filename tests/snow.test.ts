import { describe, expect, it } from 'vitest';
import climateJson from '../data/climate/pilsko.json';
import radiationJson from '../data/radiation.json';
import snowJson from '../data/snow.json';
import stationsJson from '../data/calibration/imgw-stations.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import { computeHorizon, parseHorizonParams } from '../src/sim/horizon';
import { parseRadiationParams, prepareSolarTerrain } from '../src/sim/radiation';
import { SnowState, classifySnow, emptyBalance, parseSnowParams, redistributeSnowByWind, snowStep } from '../src/sim/snow';
import type { SnowDomain, SnowStepForcing } from '../src/sim/snow';
import { compareStations } from '../src/sim/snowCalibration';
import type { StationData } from '../src/sim/snowCalibration';
import { SnowSeason, buildSolarCache, createSnowDomain } from '../src/sim/snowSeason';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { computeSlopeAndAspect } from '../src/sim/terrainAnalysis';
import { generateSeason, parseWeatherParams } from '../src/sim/weather';
import { flatGrid, planeGrid } from './terrainTestUtils';

const sp = parseSnowParams(snowJson);
const rp = parseRadiationParams(radiationJson);
const wp = parseWeatherParams(wxJson);
const profile = parseClimateProfile(climateJson);
const LOCATION = { latDeg: 49.54, lonDeg: 19.32, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } };

function domainOf(grid: TerrainGrid, forest = 0): SnowDomain {
  return createSnowDomain(grid, new Float32Array(grid.cellCount).fill(forest), new Float32Array(grid.cellCount), sp);
}

/** Stałe warunki: temperatura, opad na krok, bez słońca (noc) lub z zadanym promieniowaniem. */
function forcing(tempC: number, precipMm: number, options: Partial<SnowStepForcing> = {}): SnowStepForcing {
  return {
    durationS: 6 * 3600,
    tempAtRefC: tempC,
    tempGradientCPerM: 0,
    refElevationM: 1000,
    humidityPercent: 80,
    windRefMs: 2,
    windRefElevationM: 1000,
    windGrowthPer1000m: 0,
    cloudFraction: 0.8,
    precipRefMm: precipMm,
    precipRefElevationM: 1000,
    precipGradientPerM: 0,
    snowMaxTemperatureC: wp.snowMaxTemperatureC,
    rainMinTemperatureC: wp.rainMinTemperatureC,
    shortwaveWm2: null,
    ...options,
  };
}

function totalWater(s: SnowState): number {
  let w = 0;
  for (let k = 0; k < s.n; k++) w += s.totalWater(k);
  return w;
}

describe('Model śniegu – zachowanie fizyczne', () => {
  it('przy −10 °C i opadzie śniegu przybywa, przy stałych +5 °C ubywa; grubość nigdy ujemna', () => {
    const g = flatGrid(1000, 4, 4);
    const dom = domainOf(g);
    const s = new SnowState(g.cellCount);
    const bal = emptyBalance();
    let prevDepth = 0;
    for (let i = 0; i < 20; i++) {
      snowStep(s, dom, forcing(-10, 3), sp, bal);
      expect(s.depthM(0)).toBeGreaterThan(prevDepth);
      prevDepth = s.depthM(0);
    }
    expect(s.depthM(0)).toBeGreaterThan(0.2);
    const sweBefore = s.totalWater(0);
    let prevSwe = sweBefore;
    for (let day = 0; day < 50; day++) {
      for (let step = 0; step < 4; step++) {
        const sun = step === 1 || step === 2 ? new Float32Array(s.n).fill(120) : null;
        snowStep(s, dom, forcing(5, 0, { cloudFraction: 0.7, shortwaveWm2: sun }), sp, bal);
        for (let k = 0; k < s.n; k++) {
          expect(s.depthM(k)).toBeGreaterThanOrEqual(0);
          expect(s.totalWater(k)).toBeGreaterThanOrEqual(0);
        }
      }
      // Doba po dobie śniegu ubywa (w pojedynczym kroku może osiąść trochę pary – szadź).
      if (day > 0) expect(s.totalWater(0)).toBeLessThanOrEqual(prevSwe + 1e-6);
      prevSwe = s.totalWater(0);
    }
    expect(s.totalWater(0)).toBeLessThan(sweBefore * 0.5);
  });

  it('bilans masy: opad = przyrost śniegu + odpływ + sublimacja + wywianie (tolerancja numeryczna)', () => {
    // Pagórek, las na części mapy, wiatr przenosi śnieg; mieszane warunki przez 60 dni.
    const w = 30;
    const e = new Float32Array(w * w);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) e[j * w + i] = 1000 + 40 * Math.exp(-((i - 15) ** 2 + (j - 15) ** 2) / 40);
    const g = new TerrainGrid(w, w, 10, e);
    computeSlopeAndAspect(g);
    const forest = new Float32Array(w * w);
    for (let k = 0; k < w * w; k++) forest[k] = k % w < 8 ? 1 : 0;
    const dom = createSnowDomain(g, forest, new Float32Array(w * w), sp);
    const s = new SnowState(g.cellCount);
    const bal = emptyBalance();
    const sw = new Float32Array(g.cellCount).fill(150);
    for (let day = 0; day < 60; day++) {
      const t = 6 * Math.sin(day / 5) - 2;
      for (let step = 0; step < 4; step++) {
        snowStep(s, dom, forcing(t + (step === 2 ? 4 : 0), day % 3 === 0 ? 2 : 0, { shortwaveWm2: step === 1 || step === 2 ? sw : null }), sp, bal);
      }
      redistributeSnowByWind(s, dom, 225, 8, 1000, 0, sp, bal);
    }
    const stored = totalWater(s);
    const out = stored + bal.runoffMm + bal.sublimationMm + bal.windOutMm;
    expect(bal.precipitationMm).toBeGreaterThan(0);
    expect(Math.abs(out - bal.precipitationMm) / bal.precipitationMm).toBeLessThan(1e-4);
    expect(bal.windOutMm).toBeGreaterThan(0); // wiatr wywiał trochę śniegu poza mapę
  });

  it('deszcz na śnieg, a potem mróz daje warstwę zlodzoną; gęstość rośnie z czasem', () => {
    const g = flatGrid(1000, 2, 2);
    const dom = domainOf(g);
    const s = new SnowState(g.cellCount);
    const bal = emptyBalance();
    for (let i = 0; i < 8; i++) snowStep(s, dom, forcing(-6, 4), sp, bal);
    expect(classifySnow(s, 0, sp)).toBe('powder');
    const rho0 = s.bulkDensity(0);
    for (let i = 0; i < 40; i++) snowStep(s, dom, forcing(-6, 0), sp, bal);
    expect(s.bulkDensity(0)).toBeGreaterThan(rho0);
    // Deszcz przy +4 °C, potem silny mróz.
    for (let i = 0; i < 3; i++) snowStep(s, dom, forcing(4, 6), sp, bal);
    for (let i = 0; i < 6; i++) snowStep(s, dom, forcing(-12, 0, { cloudFraction: 0 }), sp, bal);
    expect(s.topIce[0]).toBe(1);
    expect(classifySnow(s, 0, sp)).toBe('icy');
  });

  it('las zatrzymuje część opadu w koronach: pod lasem mniej śniegu niż na polanie', () => {
    const g = flatGrid(1000, 2, 2);
    const open = new SnowState(4);
    const forest = new SnowState(4);
    const bal = emptyBalance();
    for (let i = 0; i < 20; i++) {
      snowStep(open, domainOf(g, 0), forcing(-5, 3), sp, bal);
      snowStep(forest, domainOf(g, 1), forcing(-5, 3), sp, bal);
    }
    expect(forest.totalWater(0)).toBeLessThan(open.totalWater(0) * 0.85);
  });

  it('wiatr przenosi śnieg z grzbietu na stok zawietrzny, nie gubiąc masy', () => {
    // Grzbiet W–E pośrodku i obniżenie po stronie zawietrznej (wiatr z S).
    const w = 20;
    const h = 30;
    const e = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) e[j * w + i] = 1000 + 30 * Math.exp(-((j - 18) ** 2) / 8) - 10 * Math.exp(-((j - 12) ** 2) / 6);
    const g = new TerrainGrid(w, h, 10, e);
    computeSlopeAndAspect(g);
    const dom = createSnowDomain(g, new Float32Array(w * h), new Float32Array(w * h), sp);
    const s = new SnowState(g.cellCount);
    const bal = emptyBalance();
    for (let i = 0; i < 6; i++) snowStep(s, dom, forcing(-8, 3, { refElevationM: 1000 }), sp, bal);
    const before = totalWater(s);
    const lostBefore = bal.sublimationMm + bal.windOutMm;
    const ridge = g.index(10, 18);
    const leeSide = [13, 14, 15, 16, 17].map((j) => g.index(10, j)); // stok zawietrzny (północny) i zagłębienie
    const ridge0 = s.totalWater(ridge);
    const lee0 = leeSide.reduce((a, k) => a + s.totalWater(k), 0);
    redistributeSnowByWind(s, dom, 180, 10, 1000, 0, sp, bal);
    expect(s.totalWater(ridge)).toBeLessThan(ridge0 * 0.8);
    expect(leeSide.reduce((a, k) => a + s.totalWater(k), 0)).toBeGreaterThan(lee0 * 1.2);
    expect(Math.abs(totalWater(s) + bal.sublimationMm + bal.windOutMm - lostBefore - before) / before).toBeLessThan(1e-5);
  });
});

describe('Stok północny trzyma śnieg dłużej niż południowy', () => {
  it('przy tej samej pogodzie stok N 30 % jest pokryty dłużej niż S 30 %', () => {
    const run = (azimuth: number) => {
      const g = planeGrid(30, azimuth, { width: 12, height: 12, baseM: 1000 });
      const horizon = computeHorizon(g, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 500 });
      const st = prepareSolarTerrain(g, horizon);
      const weather = generateSeason(profile, wp, 12345, 2026, 245);
      const solar = buildSolarCache(st, weather[0].date, 243, LOCATION, rp, sp);
      const season = new SnowSeason({ domain: domainOf(g), solar, weather, profile, weatherParams: wp, snowParams: sp, radiationParams: rp, location: LOCATION, windRedistribution: false });
      let lastCover = 0;
      let swe = 0;
      const k = g.index(6, 6);
      for (let d = 0; d < 243; d++) {
        season.stepDay();
        if (season.state.depthM(k) >= 0.01) lastCover = d;
        swe += season.state.totalWater(k);
      }
      return { lastCover, swe };
    };
    const north = run(0);
    const south = run(180);
    expect(north.lastCover).toBeGreaterThan(south.lastCover);
    expect(north.swe).toBeGreaterThan(south.swe);
  });
});

describe('Determinizm i wydajność', () => {
  it('ten sam seed daje identyczny stan śniegu', () => {
    const run = () => {
      const g = flatGrid(1100, 6, 6);
      const st = prepareSolarTerrain(g, computeHorizon(g, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 100 }));
      const weather = generateSeason(profile, wp, 777, 2030, 100);
      const solar = buildSolarCache(st, weather[0].date, 95, LOCATION, rp, sp);
      const season = new SnowSeason({ domain: domainOf(g), solar, weather, profile, weatherParams: wp, snowParams: sp, radiationParams: rp, location: LOCATION });
      for (let d = 0; d < 95; d++) season.stepDay();
      return Array.from(season.state.topSwe).concat(Array.from(season.state.botDensity));
    };
    expect(run()).toEqual(run());
  });

  it('wydajność: sezon (1 X – 30 IV, 212 dni) na siatce 100 × 100 liczy się w kilka sekund', () => {
    const g = planeGrid(20, 0, { width: 100, height: 100, baseM: 1200 });
    const st = prepareSolarTerrain(g, computeHorizon(g, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 300 }));
    const weather = generateSeason(profile, wp, 1, 2026, 215);
    const solar = buildSolarCache(st, weather[0].date, 212, LOCATION, rp, sp);
    const season = new SnowSeason({ domain: domainOf(g), solar, weather, profile, weatherParams: wp, snowParams: sp, radiationParams: rp, location: LOCATION });
    const t0 = performance.now();
    for (let d = 0; d < 212; d++) season.stepDay();
    const seconds = (performance.now() - t0) / 1000;
    // 10 000 komórek; pełna mapa Pilska ma 164 tys. komórek (~16× więcej) – czas podaje raport.
    expect(seconds).toBeLessThan(15);
  });
});

describe('Kalibracja na pomiarach IMGW (Korbielów, Zawoja, Laliki 2009–2019)', () => {
  const summary = compareStations((stationsJson as unknown as { stations: StationData[] }).stations, profile, wp, sp, rp);
  it('średni błąd grubości śniegu poniżej 6 cm, liczba dni z pokrywą w granicach ±10 dni', () => {
    expect(summary.winters.length).toBeGreaterThanOrEqual(25);
    expect(summary.maeCm).toBeLessThan(6);
    expect(Math.abs(summary.biasCm)).toBeLessThan(3);
    expect(Math.abs(summary.coverDaysBias)).toBeLessThan(10);
  });
});
