import { describe, expect, it } from 'vitest';
import { sunDay, sunPosition } from '../src/sim/sun';
import { formatIsoDate, isEuSummerTime, localToUtcMs, utcMsToLocal } from '../src/sim/time';

// Hala Miziowa (schronisko): 49,5405° N, 19,3177° E. Strefa: Polska (CET/CEST).
const LAT = 49.5405;
const LON = 19.3177;
const TZ = { standardOffsetHours: 1, euDaylightSaving: true };

/** Czas lokalny „HH:MM:SS” → chwila UTC. */
function local(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  return localToUtcMs({ year: y, month: m, day: d, hour: hh + mm / 60 + ss / 3600 }, TZ);
}
function minutesDiff(a: number, b: number): number {
  return Math.abs(a - b) / 60000;
}

// Wartości wzorcowe: NREL SPA (biblioteka pvlib 0.13), czas lokalny Europe/Warsaw.
const REFERENCE_DAYS = [
  { date: '2026-12-21', noonElevationDeg: 17.07, transit: '11:40:45', sunrise: '07:36:25', sunset: '15:45:05' },
  { date: '2026-03-21', noonElevationDeg: 40.81, transit: '11:49:53', sunrise: '05:43:44', sunset: '17:56:58' },
  { date: '2026-06-21', noonElevationDeg: 63.9, transit: '12:44:32', sunrise: '04:35:41', sunset: '20:53:22' },
  { date: '2027-01-15', noonElevationDeg: 19.38, transit: '11:52:02', sunrise: '07:33:45', sunset: '16:10:42' },
];
const REFERENCE_POSITIONS = [
  { date: '2026-12-21', time: '09:00', elevationDeg: 8.858, azimuthDeg: 143.207 },
  { date: '2026-12-21', time: '15:30', elevationDeg: 1.447, azimuthDeg: 230.545 },
  { date: '2026-03-21', time: '09:00', elevationDeg: 28.867, azimuthDeg: 129.562 },
  { date: '2026-03-21', time: '15:30', elevationDeg: 22.188, azimuthDeg: 242.23 },
  { date: '2026-06-21', time: '09:00', elevationDeg: 39.401, azimuthDeg: 99.757 },
  { date: '2026-06-21', time: '15:30', elevationDeg: 48.561, azimuthDeg: 246.322 },
];

describe('Położenie Słońca nad Halą Miziową (algorytm NOAA)', () => {
  it.each(REFERENCE_DAYS)('$date: wysokość w południe, wschód, zachód i górowanie zgodne z NREL SPA', (r) => {
    const [y, m, d] = r.date.split('-').map(Number);
    const day = sunDay({ year: y, month: m, day: d }, LAT, LON, TZ);
    expect(Math.abs(day.noonElevationDeg - r.noonElevationDeg)).toBeLessThan(0.1);
    expect(minutesDiff(day.solarNoonUtcMs, local(r.date, r.transit))).toBeLessThan(1);
    expect(minutesDiff(day.sunriseUtcMs!, local(r.date, r.sunrise))).toBeLessThan(2);
    expect(minutesDiff(day.sunsetUtcMs!, local(r.date, r.sunset))).toBeLessThan(2);
  });

  it('w południe 21 grudnia Słońce stoi ok. 17° nad horyzontem, 21 marca ok. 40°', () => {
    expect(sunDay({ year: 2026, month: 12, day: 21 }, LAT, LON, TZ).noonElevationDeg).toBeCloseTo(17, 0);
    expect(sunDay({ year: 2026, month: 3, day: 21 }, LAT, LON, TZ).noonElevationDeg).toBeCloseTo(40.8, 0);
  });

  it.each(REFERENCE_POSITIONS)('$date $time: wysokość i azymut zgodne z NREL SPA (±0,05°)', (r) => {
    const p = sunPosition(local(r.date, r.time), LAT, LON);
    expect(Math.abs(p.elevationDeg - r.elevationDeg)).toBeLessThan(0.05);
    expect(Math.abs(p.azimuthDeg - r.azimuthDeg)).toBeLessThan(0.05);
  });

  it('w nocy Słońce jest pod horyzontem, w górowaniu azymut = 180°', () => {
    expect(sunPosition(local('2026-12-21', '23:00'), LAT, LON).elevationDeg).toBeLessThan(-30);
    const day = sunDay({ year: 2026, month: 12, day: 21 }, LAT, LON, TZ);
    expect(sunPosition(day.solarNoonUtcMs, LAT, LON).azimuthDeg).toBeCloseTo(180, 1);
  });

  it('za kołem podbiegunowym: noc polarna i dzień polarny', () => {
    const tz0 = { standardOffsetHours: 0, euDaylightSaving: false };
    const winter = sunDay({ year: 2026, month: 12, day: 21 }, 78, 15, tz0);
    expect(winter.sunriseUtcMs).toBeNull();
    expect(winter.dayLengthHours).toBe(0);
    expect(sunDay({ year: 2026, month: 6, day: 21 }, 78, 15, tz0).dayLengthHours).toBe(24);
  });
});

describe('Czas lokalny (czas zimowy i letni wg zasady UE)', () => {
  it('zmiana na czas letni: ostatnia niedziela marca 01:00 UTC (2:00 → 3:00 w Polsce)', () => {
    expect(isEuSummerTime(Date.UTC(2026, 2, 29, 0, 59))).toBe(false);
    expect(isEuSummerTime(Date.UTC(2026, 2, 29, 1, 0))).toBe(true);
    expect(utcMsToLocal(Date.UTC(2026, 2, 29, 0, 30), TZ).hour).toBeCloseTo(1.5);
    expect(utcMsToLocal(Date.UTC(2026, 2, 29, 1, 30), TZ).hour).toBeCloseTo(3.5);
  });

  it('zmiana na czas zimowy: ostatnia niedziela października 01:00 UTC', () => {
    expect(isEuSummerTime(Date.UTC(2026, 9, 25, 0, 59))).toBe(true);
    expect(isEuSummerTime(Date.UTC(2026, 9, 25, 1, 0))).toBe(false);
  });

  it('przeliczenie czas lokalny ↔ UTC jest odwracalne zimą i latem', () => {
    for (const [date, hour] of [
      ['2026-01-15', 12],
      ['2026-07-15', 12],
      ['2026-12-21', 7.5],
    ] as const) {
      const [y, m, d] = date.split('-').map(Number);
      const utc = localToUtcMs({ year: y, month: m, day: d, hour }, TZ);
      const back = utcMsToLocal(utc, TZ);
      expect(formatIsoDate(back)).toBe(date);
      expect(back.hour).toBeCloseTo(hour, 9);
    }
    // Zimą 12:00 w Polsce = 11:00 UTC, latem = 10:00 UTC.
    expect(new Date(local('2026-01-15', '12:00')).getUTCHours()).toBe(11);
    expect(new Date(local('2026-07-15', '12:00')).getUTCHours()).toBe(10);
  });
});
