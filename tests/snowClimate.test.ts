/**
 * Generator pogody + model śniegu a prawdziwe zimy 2001–2025 (Korbielów, Zawoja, Laliki):
 * czy wygenerowane zimy dają tyle śniegu, ile było naprawdę – średnio i w rozrzucie (także słabe zimy).
 */
import { describe, expect, it } from 'vitest';
import climateJson from '../data/climate/pilsko.json';
import radiationJson from '../data/radiation.json';
import snowJson from '../data/snow.json';
import stationsJson from '../data/calibration/imgw-stations.json';
import wxJson from '../data/weather-generator.json';
import reportJson from '../data/winter-report.json';
import settingsJson from '../data/settings.json';
import { parseClimateProfile } from '../src/sim/climate';
import { seasonWeather } from '../src/sim/environment';
import { parseRadiationParams } from '../src/sim/radiation';
import { parseSnowParams } from '../src/sim/snow';
import type { StationData } from '../src/sim/snowCalibration';
import { hasCompleteSnowRecord, observedDays, winterSnowStats, winterWeatherStats } from '../src/sim/snowCalibration';
import { observedToDailyWeather, profileAtPoint, runPointSnow } from '../src/sim/snowPoint';
import { parseSimSettings } from '../src/sim/settings';
import { Rng } from '../src/sim/rng';
import { gammaCdf, generateSeason, parseWeatherParams, sampleGamma } from '../src/sim/weather';

const profile = parseClimateProfile(climateJson);
const wp = parseWeatherParams(wxJson);
const sp = parseSnowParams(snowJson);
const rp = parseRadiationParams(radiationJson);
const seed = parseSimSettings(settingsJson).seed;
const stations = (stationsJson as unknown as { stations: StationData[] }).stations;
const TZ = { standardOffsetHours: 1, euDaylightSaving: true };
const GEN_WINTERS = 40;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));

describe('Dystrybuanta rozkładu gamma', () => {
  it('zgodna ze wzorami dla kształtu 1 i 2', () => {
    for (const x of [0.1, 0.5, 1, 3, 10]) {
      expect(gammaCdf(x, 1, 2)).toBeCloseTo(1 - Math.exp(-x / 2), 8);
      expect(gammaCdf(x, 2, 1)).toBeCloseTo(1 - Math.exp(-x) * (1 + x), 8);
    }
    expect(gammaCdf(0, 0.7, 5)).toBe(0);
  });
  it('percentyl wylosowanych sum ma rozkład równomierny (średnia 0,5)', () => {
    const rng = new Rng(7);
    const q = Array.from({ length: 5000 }, () => gammaCdf(sampleGamma(rng, 0.7, 4), 0.7, 4));
    expect(mean(q)).toBeCloseTo(0.5, 1);
    expect(q.filter((x) => x < 0.1).length / q.length).toBeCloseTo(0.1, 1);
  });
});

describe('Generator: temperatura dnia zależy od wielkości opadu', () => {
  const days = Array.from({ length: 60 }, (_, i) => generateSeason(profile, wp, seed, 2100 + i, 245)).flat();
  const jan = days.filter((d) => d.date.month === 1 && d.wet).sort((a, b) => a.precipitationMm - b.precipitationMm);
  it('w styczniu dni z najsilniejszym opadem są cieplejsze niż ze słabym (jak w danych IMGW)', () => {
    const third = Math.floor(jan.length / 3);
    const light = mean(jan.slice(0, third).map((d) => d.anomalyC));
    const heavy = mean(jan.slice(-third).map((d) => d.anomalyC));
    // Profil: różnica między percentylem 0 a 1; między średnimi skrajnych tercyli – ok. 2/3 tego.
    const expected = (profile.temperature.wetDayAnomalyPerPercentileC[0] * 2) / 3;
    expect(profile.temperature.wetDayAnomalyPerPercentileC[0]).toBeGreaterThan(1);
    expect(heavy - light).toBeGreaterThan(expected * 0.6);
    expect(heavy - light).toBeLessThan(expected * 1.4);
  });
});

describe('Wygenerowane zimy a prawdziwe zimy 2001–2025 (model w punkcie stacji)', () => {
  const generated = Array.from({ length: GEN_WINTERS }, (_, i) => seasonWeather(profile, wp, seed, 2026 + i).slice(0, 245));
  const results = stations.map((st) => {
    const complete = st.winters.filter((w) => hasCompleteSnowRecord(w, reportJson.calibration.maxSubstitutedTemperatureDays.value));
    const obs = complete.map((w) => {
      const weather = observedToDailyWeather(observedDays(w), profile, wp);
      return winterSnowStats(weather.map((d) => d.date), w.snowDepthCm);
    });
    const gen = generated.map((weather) => {
      const r = runPointSnow({ elevationM: st.elevationM, latDeg: st.latDeg, lonDeg: st.lonDeg, timeZone: TZ, weather, profile, weatherParams: wp, snowParams: sp, radiationParams: rp, weatherAtPointElevation: false });
      return winterSnowStats(r.dates, r.depthM.map((x) => x * 100));
    });
    return { name: st.name, obs, gen };
  });
  const obsCover = results.flatMap((r) => r.obs.map((w) => w.coverDays));
  const genCover = results.flatMap((r) => r.gen.map((w) => w.coverDays));

  it('średnia liczba dni z pokrywą (3 stacje razem) zgodna z pomiarem w granicach ±10 dni', () => {
    expect(obsCover.length).toBeGreaterThanOrEqual(50);
    expect(Math.abs(mean(genCover) - mean(obsCover))).toBeLessThan(10);
  });
  it('rozrzut zim podobny: odchylenie standardowe w granicach 0,7–1,4 × pomiar, są też słabe zimy', () => {
    const ratio = sd(genCover) / sd(obsCover);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
    const q10 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.1)];
    expect(q10(genCover)).toBeLessThan(q10(obsCover) + 15);
  });
  it('prawdziwa pogoda z opadem rozłożonym na całą dobę (bez założenia o porze opadu)', () => {
    const w = observedToDailyWeather(observedDays(stations[1].winters[0]), profile, wp);
    for (const d of w.filter((x) => x.wet)) {
      expect(d.precipitationStartHour).toBe(0);
      expect(d.precipitationDurationHours).toBe(24);
    }
  });
  it('w generatorze śnieg pada w podobnej temperaturze co naprawdę (różnica temperatury opadu < 0,5 °C)', () => {
    const st = stations[0];
    const loc = { latDeg: st.latDeg, lonDeg: st.lonDeg, timeZone: TZ };
    const obs = st.winters.map((w) => winterWeatherStats(observedToDailyWeather(observedDays(w), profile, wp), st.elevationM, profileAtPoint(profile, st.elevationM), wp, loc));
    const gen = generated.slice(0, 20).map((w) => winterWeatherStats(w, st.elevationM, profile, wp, loc));
    expect(Math.abs(mean(gen.map((x) => x.precipWeightedTC)) - mean(obs.map((x) => x.precipWeightedTC)))).toBeLessThan(0.5);
  });
});
