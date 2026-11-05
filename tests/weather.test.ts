import { describe, expect, it } from 'vitest';
import climateJson from '../data/climate/pilsko.json';
import settingsJson from '../data/settings.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import { parseValidationSettings, validateWinters } from '../src/sim/climateValidation';
import { parseSimSettings } from '../src/sim/settings';
import { sunDay } from '../src/sim/sun';
import { localToUtcMs } from '../src/sim/time';
import type { DailyWeather } from '../src/sim/weather';
import { dailyAtElevation, generateSeason, hourlyAt, makeForecast, parseWeatherParams, precipitationPhase } from '../src/sim/weather';

const profile = parseClimateProfile(climateJson);
const params = parseWeatherParams(wxJson);
const seed = parseSimSettings(settingsJson).seed;
const location = { latDeg: 49.54, lonDeg: 19.32, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } };

function testDay(overrides: Partial<DailyWeather>): DailyWeather {
  return {
    date: { year: 2026, month: 1, day: 15 },
    wet: true,
    precipitationMm: 10,
    tMeanC: 0,
    anomalyC: 0,
    diurnalRangeC: 6,
    cloudFraction: 0.9,
    humidityPercent: 85,
    windMs: 2,
    windFromDeg: 270,
    precipitationStartHour: 0,
    precipitationDurationHours: 24,
    ...overrides,
  };
}

describe('Generator pogody – determinizm', () => {
  it('ten sam seed daje identyczną zimę, inny seed inną', () => {
    const a = generateSeason(profile, params, seed, 2026);
    const b = generateSeason(profile, params, seed, 2026);
    const c = generateSeason(profile, params, seed + 1, 2026);
    expect(a).toEqual(b);
    expect(a.map((d) => d.tMeanC)).not.toEqual(c.map((d) => d.tMeanC));
    expect(a.length).toBe(params.seasonLengthDays);
    expect(a[0].date).toEqual({ year: 2026, month: 10, day: 1 });
  });

  it('kolejne zimy różnią się od siebie', () => {
    const a = generateSeason(profile, params, seed, 2026);
    const b = generateSeason(profile, params, seed, 2027);
    expect(a.map((d) => d.wet)).not.toEqual(b.map((d) => d.wet));
  });
});

describe('Generator pogody – 30 zim zgodnych z danymi IMGW', () => {
  const settings = parseValidationSettings(wxJson);
  const result = validateWinters(profile, params, settings, seed, 2001);

  it.each(result.months.map((m) => [m.month, m]))(
    'miesiąc %i: średnia temperatura, suma opadu i liczba dni z opadem w tolerancji (3 × błąd średniej z 30 lat)',
    (_month, m) => {
      for (const metric of [m.temperatureC, m.precipitationMm, m.wetDays]) {
        expect(Math.abs(metric.generated - metric.observed)).toBeLessThanOrEqual(metric.tolerance);
      }
    },
  );

  it('pamięć pogody: zimą trwają dłuższe okresy mrozu i odwilży (zmiana znaku odchylenia rzadziej niż co drugi dzień)', () => {
    // Przy losowaniu bez pamięci znak odchylenia zmieniałby się średnio co drugi dzień (50 %).
    let changes = 0;
    let pairs = 0;
    for (const season of result.seasons) {
      const jan = season.filter((d) => d.date.month === 1);
      for (let k = 1; k < jan.length; k++) {
        pairs++;
        if (Math.sign(jan[k].anomalyC) !== Math.sign(jan[k - 1].anomalyC)) changes++;
      }
    }
    expect(changes / pairs).toBeLessThan(0.35);
  });
});

describe('Pogoda na różnych wysokościach', () => {
  it('gdy izoterma 0 °C leży pomiędzy: na górze pada śnieg, na dole deszcz', () => {
    // Wysokość odniesienia 700 m. Styczeń: spadek ok. 0,36 °C/100 m → przy +2,8 °C na 650 m
    // na 1500 m jest ok. −0,1 °C.
    const day = testDay({ tMeanC: 2.6 });
    const bottom = dailyAtElevation(day, 650, profile, params);
    const top = dailyAtElevation(day, 1500, profile, params);
    expect(bottom.tMeanC).toBeGreaterThan(params.rainMinTemperatureC);
    expect(top.tMeanC).toBeLessThan(params.snowMaxTemperatureC);
    expect(bottom.phase).toBe('rain');
    expect(top.phase).toBe('snow');
    // Godzina po godzinie też.
    const hb = hourlyAt(day, day, day, 12, 650, profile, params, location);
    const ht = hourlyAt(day, day, day, 3, 1500, profile, params, location);
    expect(hb.phase).toBe('rain');
    expect(ht.phase).toBe('snow');
  });

  it('rodzaj opadu: śnieg ≤ 0,5 °C, deszcz ze śniegiem pomiędzy, deszcz ≥ 2,5 °C', () => {
    expect(precipitationPhase(-5, params)).toBe('snow');
    expect(precipitationPhase(1.5, params)).toBe('sleet');
    expect(precipitationPhase(5, params)).toBe('rain');
  });

  it('wyżej zimniej, więcej opadu i silniejszy wiatr', () => {
    const day = testDay({});
    const low = dailyAtElevation(day, 650, profile, params);
    const high = dailyAtElevation(day, 1500, profile, params);
    expect(high.tMeanC).toBeLessThan(low.tMeanC - 2);
    expect(high.precipitationMm).toBeGreaterThan(low.precipitationMm * 1.2);
    expect(high.windMs).toBeGreaterThan(low.windMs * 1.5);
  });
});

describe('Przebieg dobowy', () => {
  const day = testDay({ wet: false, precipitationMm: 0, tMeanC: -3, diurnalRangeC: 8, date: { year: 2026, month: 2, day: 10 } });
  const hours = Array.from({ length: 24 }, (_, h) => hourlyAt(day, day, day, h, 700, profile, params, location).temperatureC);

  it('minimum nad ranem (ok. wschodu Słońca), maksimum po południu', () => {
    const sd = sunDay(day.date, location.latDeg, location.lonDeg, location.timeZone);
    const sunriseHour = (sd.sunriseUtcMs! - localToUtcMs({ ...day.date, hour: 0 }, location.timeZone)) / 3_600_000;
    const minHour = hours.indexOf(Math.min(...hours));
    const maxHour = hours.indexOf(Math.max(...hours));
    expect(Math.abs(minHour - sunriseHour)).toBeLessThanOrEqual(1);
    expect(maxHour).toBeGreaterThanOrEqual(13);
    expect(maxHour).toBeLessThanOrEqual(15);
    expect(Math.max(...hours) - Math.min(...hours)).toBeCloseTo(8, 0);
  });

  it('opad rozłożony na godziny sumuje się do sumy dobowej', () => {
    const wetDay = testDay({ precipitationMm: 12, precipitationStartHour: 5, precipitationDurationHours: 8 });
    let sum = 0;
    for (let h = 0; h < 24; h++) sum += hourlyAt(wetDay, wetDay, wetDay, h + 0.5, 650, profile, params, location).precipitationMm;
    expect(sum).toBeCloseTo(dailyAtElevation(wetDay, 650, profile, params).precipitationMm, 6);
  });
});

describe('Prognoza na 7 dni', () => {
  const seasons = [2026, 2027, 2028, 2029, 2030].map((y) => generateSeason(profile, params, seed, y));
  const errors = Array.from({ length: 8 }, () => [] as number[]);
  const misses = Array.from({ length: 8 }, () => [] as number[]);
  for (const season of seasons) {
    for (let issue = 0; issue + 7 < season.length; issue++) {
      for (const f of makeForecast(season, issue, params, seed)) {
        const truth = season[issue + f.leadDays];
        errors[f.leadDays].push(Math.abs(f.tMeanC - truth.tMeanC));
        misses[f.leadDays].push((f.precipitationProbability >= 0.5) !== truth.wet ? 1 : 0);
      }
    }
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

  it('prognoza jest deterministyczna', () => {
    expect(makeForecast(seasons[0], 30, params, seed)).toEqual(makeForecast(seasons[0], 30, params, seed));
    expect(makeForecast(seasons[0], 30, params, seed).length).toBe(7);
  });

  it('błąd temperatury rośnie z wyprzedzeniem', () => {
    for (let lead = 2; lead <= 7; lead++) expect(mean(errors[lead])).toBeGreaterThan(mean(errors[lead - 1]));
    expect(mean(errors[1])).toBeLessThan(1.5);
    expect(mean(errors[7])).toBeGreaterThan(2.5);
  });

  it('prognoza opadu czasem się myli – na jutro rzadko, za tydzień często', () => {
    expect(mean(misses[1])).toBeLessThan(0.15);
    expect(mean(misses[7])).toBeGreaterThan(0.2);
    expect(mean(misses[7])).toBeGreaterThan(mean(misses[1]));
  });
});
