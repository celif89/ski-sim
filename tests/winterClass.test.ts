/**
 * Etap 6b: diagnoza śniegu naturalnego – ocena zimy na tle wielolecia, ziarno kariery (pierwsza
 * zima nie z najsłabszych 20 %), progi bazy z grubości pokrywy, osłona przecinek przez las.
 */
import { describe, expect, it, vi } from 'vitest';
import climateJson from '../data/climate/pilsko.json';
import radiationJson from '../data/radiation.json';
import settingsJson from '../data/settings.json';
import snowJson from '../data/snow.json';
import winterClassesJson from '../data/winter-classes.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import { GROUND_GRADED, GROUND_MEADOW, GROUND_STUMPS } from '../src/sim/ground';
import { parseRadiationParams } from '../src/sim/radiation';
import { parseSimSettings } from '../src/sim/settings';
import { computeShelter, parseSnowParams } from '../src/sim/snow';
import { parseRidingParams } from '../src/sim/snowRiding';
import { parseWeatherParams } from '../src/sim/weather';
import { careerSeed, parseWinterClasses, winterClass, winterPercentile, winterSkiDays } from '../src/sim/winterClass';

vi.setConfig({ testTimeout: 120_000 });

const table = parseWinterClasses(winterClassesJson);
const riding = parseRidingParams(snowJson);
const deps = {
  profile: parseClimateProfile(climateJson),
  weatherParams: parseWeatherParams(wxJson),
  snowParams: parseSnowParams(snowJson),
  radiationParams: parseRadiationParams(radiationJson),
  riding,
  location: { latDeg: 49.55, lonDeg: 19.33, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } },
};
const seed = parseSimSettings(settingsJson).seed;

describe('Ocena zimy na tle wielolecia', () => {
  it('klasy 0–4 rosną z liczbą dni; percentyl z rangą środkową', () => {
    const lo = table.sortedDays[0];
    const hi = table.sortedDays[table.sortedDays.length - 1];
    expect(winterClass(lo, table)).toBeLessThanOrEqual(1);
    expect(winterClass(hi, table)).toBe(4);
    let prev = -1;
    for (let d = 0; d <= hi; d += 5) {
      const c = winterClass(d, table);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    expect(winterPercentile(hi + 1, table)).toBe(1);
    expect(winterPercentile(-1, table)).toBe(0);
  });

  it('kariera: pierwsza zima nie z najsłabszych 20 % – wybrane ziarno spełnia warunek', () => {
    const r = careerSeed(seed, 2026, table, deps);
    expect(winterPercentile(r.days, table)).toBeGreaterThanOrEqual(0.2);
    expect(winterSkiDays(r.seed, 2026, table, deps)).toBe(r.days); // deterministycznie
  });

  it('kariera: gdy pierwsza zima jest za słaba, szukane jest kolejne ziarno', () => {
    // Sztucznie wymagający rozkład: każda zima poniżej 200 dni to „najsłabsze 20 %” – wszystkie próby odrzucone.
    const strict = { ...table, sortedDays: Array.from({ length: 50 }, () => 500) };
    const r = careerSeed(seed, 2026, strict, deps, 3);
    expect(r.tries).toBe(3);
    expect(r.seed).toBe(seed + 2);
  });
});

describe('Progi bazy i osłona lasu', () => {
  it('progi bazy = grubość pokrywy ze źródeł × gęstość osiadłej pokrywy / gęstość ubita', () => {
    const nat = (snowJson as { riding: { naturalCoverDensityKgM3: { value: number } } }).riding.naturalCoverDensityKgM3.value;
    const conv = (coverCm: number) => (coverCm * nat) / riding.packedDensityKgM3;
    expect(Math.abs(riding.minBaseCmByGround[GROUND_MEADOW] - conv(30))).toBeLessThan(1); // 30 cm pokrywy (UBA TOU-I-2)
    expect(Math.abs(riding.minBaseCmByGround[GROUND_STUMPS] - conv(50))).toBeLessThan(1); // 50 cm pokrywy
    expect(riding.minBaseCmByGround[GROUND_GRADED]).toBeLessThan(riding.minBaseCmByGround[GROUND_MEADOW]);
    // 10 cm puchu (100 kg/m³) to ok. 2,4 cm bazy – za mało na każde podłoże.
    expect((10 * 100) / riding.packedDensityKgM3).toBeCloseTo(2.4, 1);
  });

  it('przecinka w lesie jest osłonięta od wiatru (Sx z wysokością drzew), na płaskiej łące – nie', () => {
    const W = 20;
    const H = 20;
    const z = new Float32Array(W * H).fill(1000);
    const forestH = new Float32Array(W * H);
    // las wszędzie poza pasem 4 komórek (przecinka trasy) wzdłuż osi y
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (i < 8 || i > 11) forestH[j * W + i] = 20;
    const bare = computeShelter(z, W, H, 10, 100);
    const withForest = computeShelter(z, W, H, 10, 100, forestH);
    const n = W * H;
    const k = 10 * W + 9; // środek przecinki
    const west = 6; // wiatr z zachodu (sektor W)
    expect(bare[west * n + k]).toBeCloseTo(0, 6);
    expect(withForest[west * n + k]).toBeGreaterThan(0.5); // ściana lasu 20 m w odległości ≤ 20 m
  });
});
