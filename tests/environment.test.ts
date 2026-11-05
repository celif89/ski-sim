import { describe, expect, it } from 'vitest';
import climateJson from '../data/climate/pilsko.json';
import radiationJson from '../data/radiation.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import { Environment } from '../src/sim/environment';
import { computeHorizon, parseHorizonParams } from '../src/sim/horizon';
import { parseRadiationParams } from '../src/sim/radiation';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { computeSlopeAndAspect } from '../src/sim/terrainAnalysis';
import { parseWeatherParams } from '../src/sim/weather';

// Mały stok od 650 do 1500 m (opada na północ), żeby sprawdzić połączenie modułów.
function slopeGrid(): TerrainGrid {
  const w = 20;
  const h = 40;
  const e = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) e[j * w + i] = 650 + (850 * j) / (h - 1);
  const g = new TerrainGrid(w, h, 50, e);
  computeSlopeAndAspect(g);
  return g;
}

describe('Środowisko: słońce, pogoda i pola na mapie', () => {
  const grid = slopeGrid();
  const env = new Environment(
    grid,
    computeHorizon(grid, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 3000 }),
    parseClimateProfile(climateJson),
    parseWeatherParams(wxJson),
    parseRadiationParams(radiationJson),
    20261105,
    { latDeg: 49.54, lonDeg: 19.32, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } },
  );

  it('dół i góra ośrodka to najniższy i najwyższy punkt mapy; na górze zimniej', () => {
    const s = env.stateAt({ year: 2027, month: 1, day: 15 }, 12);
    expect(s.bottom.elevationM).toBe(650);
    expect(s.top.elevationM).toBe(1500);
    expect(s.top.now.temperatureC).toBeLessThan(s.bottom.now.temperatureC);
    // Pole temperatury: na dole = dół, na górze = góra.
    expect(s.temperatureC[0]).toBeCloseTo(s.bottom.now.temperatureC, 4);
    expect(s.temperatureC[grid.cellCount - 1]).toBeCloseTo(s.top.now.temperatureC, 4);
  });

  it('w nocy brak promieniowania, w dzień jest', () => {
    const night = env.stateAt({ year: 2027, month: 1, day: 15 }, 2);
    const noon = env.stateAt({ year: 2027, month: 1, day: 15 }, 12);
    expect(Math.max(...night.insolationWm2)).toBe(0);
    expect(Math.max(...noon.insolationWm2)).toBeGreaterThan(0);
    expect(noon.sun.elevationDeg).toBeGreaterThan(15);
  });

  it('prognoza na 7 dni z temperaturą na dole i na górze', () => {
    const s = env.stateAt({ year: 2027, month: 1, day: 15 }, 12);
    expect(s.forecast.length).toBe(7);
    for (const f of s.forecast) expect(f.topTMeanC).toBeLessThan(f.bottomTMeanC);
  });

  it('ten sam dzień i godzina dają ten sam stan (determinizm)', () => {
    const a = env.stateAt({ year: 2026, month: 12, day: 24 }, 10);
    const b = env.stateAt({ year: 2026, month: 12, day: 24 }, 10);
    expect(a.bottom).toEqual(b.bottom);
    expect(Array.from(a.insolationWm2)).toEqual(Array.from(b.insolationWm2));
  });

  it('chmury zmniejszają średnią sumę dobową na mapie', () => {
    // Uwaga: na stromym stoku północnym dzień pochmurny może dać WIĘCEJ energii niż bezchmurny –
    // bezpośrednie słońce i tak tam nie dociera, a chmury rozpraszają światło na całe niebo.
    // Dlatego sprawdzamy na terenie płaskim.
    const flat = new TerrainGrid(10, 10, 50, new Float32Array(100).fill(1000));
    computeSlopeAndAspect(flat);
    const flatEnv = new Environment(
      flat,
      computeHorizon(flat, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 1000 }),
      parseClimateProfile(climateJson),
      parseWeatherParams(wxJson),
      parseRadiationParams(radiationJson),
      20261105,
      { latDeg: 49.54, lonDeg: 19.32, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } },
    );
    let cloudyTotal = 0;
    let clearTotal = 0;
    for (let d = 1; d <= 28; d++) {
      const date = { year: 2027, month: 2, day: d };
      cloudyTotal += flatEnv.dailyRadiation(date, true)[0];
      clearTotal += flatEnv.dailyRadiation(date, false)[0];
    }
    expect(cloudyTotal).toBeLessThan(clearTotal * 0.9);
    expect(cloudyTotal).toBeGreaterThan(clearTotal * 0.3);
  });
});
