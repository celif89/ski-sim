/**
 * Położenie Słońca – algorytm NOAA (Global Monitoring Laboratory, „Solar Calculator”,
 * oparty na J. Meeus, „Astronomical Algorithms”). Dokładność ok. 0,01° dla lat 1800–2100,
 * czasy wschodu i zachodu z dokładnością do ok. minuty.
 *
 * Wysokość Słońca podawana jest „pozorna” – z poprawką na refrakcję atmosferyczną (jak widać
 * Słońce na niebie). Azymut: 0° = północ, 90° = wschód, 180° = południe.
 *
 * Stałe w tym pliku to współczynniki szeregów astronomicznych (definicja algorytmu NOAA),
 * a nie parametry gry.
 */
import { MS_PER_DAY, MS_PER_HOUR, julianDay, localToUtcMs } from './time';
import type { TimeZoneRule } from './time';

const DEG = Math.PI / 180;

export interface SunPosition {
  /** Wysokość nad horyzontem z refrakcją [°] (ujemna – pod horyzontem). */
  elevationDeg: number;
  /** Wysokość geometryczna bez refrakcji [°]. */
  geometricElevationDeg: number;
  /** Azymut [°], 0 = N, 90 = E. */
  azimuthDeg: number;
  /** Deklinacja [°]. */
  declinationDeg: number;
  /** Równanie czasu [min]. */
  equationOfTimeMin: number;
  /** Odległość Ziemia–Słońce [AU]. */
  sunDistanceAu: number;
}

function normalizeDeg(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** Poprawka refrakcji [°] dla wysokości geometrycznej [°] (wzór NOAA). */
export function refractionCorrectionDeg(elevationDeg: number): number {
  if (elevationDeg > 85) return 0;
  const te = Math.tan(elevationDeg * DEG);
  let arcsec: number;
  if (elevationDeg > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevationDeg > -0.575)
    arcsec = 1735 + elevationDeg * (-518.2 + elevationDeg * (103.4 + elevationDeg * (-12.79 + elevationDeg * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

/** Położenie Słońca w chwili UTC [ms] dla szerokości i długości geograficznej [°] (E dodatnia). */
export function sunPosition(utcMs: number, latDeg: number, lonDeg: number): SunPosition {
  const t = (julianDay(utcMs) - 2451545) / 36525;
  const l0 = normalizeDeg(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mRad = m * DEG;
  const c =
    Math.sin(mRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mRad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mRad) * 0.000289;
  const trueLong = l0 + c;
  const trueAnomaly = m + c;
  const sunDistanceAu = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly * DEG));
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * DEG);
  const declRad = Math.asin(Math.sin(obliq * DEG) * Math.sin(appLong * DEG));
  const y = Math.tan((obliq / 2) * DEG) ** 2;
  const l0Rad = l0 * DEG;
  const eqTimeMin =
    (4 / DEG) *
    (y * Math.sin(2 * l0Rad) -
      2 * e * Math.sin(mRad) +
      4 * e * y * Math.sin(mRad) * Math.cos(2 * l0Rad) -
      0.5 * y * y * Math.sin(4 * l0Rad) -
      1.25 * e * e * Math.sin(2 * mRad));

  const minutesUtc = ((utcMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY / 60000;
  const trueSolarTime = (((minutesUtc + eqTimeMin + 4 * lonDeg) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;
  const latRad = latDeg * DEG;
  const cosZenith = Math.min(
    1,
    Math.max(-1, Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngle * DEG)),
  );
  const zenithRad = Math.acos(cosZenith);
  const geometricElevationDeg = 90 - zenithRad / DEG;

  let azimuthDeg: number;
  const denom = Math.cos(latRad) * Math.sin(zenithRad);
  if (Math.abs(denom) > 1e-12) {
    const cosAz = Math.min(1, Math.max(-1, (Math.sin(latRad) * cosZenith - Math.sin(declRad)) / denom));
    const az = Math.acos(cosAz) / DEG;
    azimuthDeg = hourAngle > 0 ? normalizeDeg(az + 180) : normalizeDeg(540 - az);
  } else {
    azimuthDeg = latDeg > 0 ? 180 : 0;
  }

  return {
    elevationDeg: geometricElevationDeg + refractionCorrectionDeg(geometricElevationDeg),
    geometricElevationDeg,
    azimuthDeg,
    declinationDeg: declRad / DEG,
    equationOfTimeMin: eqTimeMin,
    sunDistanceAu,
  };
}

/** Wysokość środka tarczy przy wschodzie/zachodzie: −0,833° (promień tarczy + refrakcja). */
const SUNRISE_GEOMETRIC_ELEVATION_DEG = -0.833;

export interface SunDay {
  /** Chwile UTC [ms]; null, gdy Słońce danego dnia nie wschodzi/nie zachodzi. */
  sunriseUtcMs: number | null;
  sunsetUtcMs: number | null;
  /** Górowanie (południe słoneczne). */
  solarNoonUtcMs: number;
  /** Wysokość Słońca w górowaniu (z refrakcją) [°]. */
  noonElevationDeg: number;
  /** Długość dnia [h]. */
  dayLengthHours: number;
}

/**
 * Wschód, górowanie i zachód Słońca dla dnia kalendarzowego (czasu lokalnego).
 * Szukane numerycznie (bisekcja) na funkcji wysokości – dokładność kilku sekund.
 */
export function sunDay(
  date: { year: number; month: number; day: number },
  latDeg: number,
  lonDeg: number,
  tz: TimeZoneRule,
): SunDay {
  const start = localToUtcMs({ ...date, hour: 0 }, tz);
  const end = start + MS_PER_DAY;
  const geo = (ms: number) => sunPosition(ms, latDeg, lonDeg).geometricElevationDeg;
  // Górowanie: szukanie maksimum (złoty podział) na całej dobie.
  let a = start;
  let b = end;
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 60; k++) {
    const c = b - phi * (b - a);
    const d = a + phi * (b - a);
    if (geo(c) > geo(d)) b = d;
    else a = c;
  }
  const noon = (a + b) / 2;
  const noonGeo = geo(noon);
  const findCrossing = (from: number, to: number): number | null => {
    const f = (ms: number) => geo(ms) - SUNRISE_GEOMETRIC_ELEVATION_DEG;
    let lo = from;
    let hi = to;
    let flo = f(lo);
    const fhi = f(hi);
    if (flo * fhi > 0) return null;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (fm * flo <= 0) hi = mid;
      else {
        lo = mid;
        flo = fm;
      }
    }
    return (lo + hi) / 2;
  };
  const sunrise = findCrossing(start, noon);
  const sunset = findCrossing(noon, end);
  return {
    sunriseUtcMs: sunrise,
    sunsetUtcMs: sunset,
    solarNoonUtcMs: noon,
    noonElevationDeg: noonGeo + refractionCorrectionDeg(noonGeo),
    dayLengthHours: sunrise !== null && sunset !== null ? (sunset - sunrise) / MS_PER_HOUR : noonGeo > 0 ? 24 : 0,
  };
}
