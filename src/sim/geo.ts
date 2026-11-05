/**
 * Przeliczanie współrzędnych: PUWG 1992 (EPSG:2180) ↔ współrzędne geograficzne (ETRS89 / WGS84).
 *
 * PUWG 1992 to odwzorowanie poprzeczne Merkatora na elipsoidzie GRS80:
 * południk osiowy 19° E, skala na południku osiowym 0,9993, przesunięcia E +500 000 m, N −5 300 000 m.
 * Te stałe są częścią DEFINICJI układu (rejestr EPSG, kod 2180), a nie parametrami gry – dlatego
 * są w kodzie, a nie w pliku danych.
 *
 * Wzory: szeregi Krügera 6. rzędu (C.F.F. Karney, „Transverse Mercator with an accuracy of a few
 * nanometers”, J. Geodesy 2011) – dokładność rzędu milimetrów w całym pasie Polski.
 *
 * Oznaczenia: E (easting) – współrzędna wschodnia, N (northing) – północna.
 * W polskiej geodezji ta sama para to Y = E i X = N.
 */

const GRS80_A_M = 6378137;
const GRS80_F = 1 / 298.257222101;
const PUWG92_K0 = 0.9993;
const PUWG92_LON0_DEG = 19;
const PUWG92_FALSE_EASTING_M = 500000;
const PUWG92_FALSE_NORTHING_M = -5300000;

const DEG = Math.PI / 180;
const n = GRS80_F / (2 - GRS80_F);
const E2 = GRS80_F * (2 - GRS80_F);
const ECC = Math.sqrt(E2);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const n5 = n4 * n;
const n6 = n5 * n;
/** Promień prostujący (rectifying radius). */
const A_RECT = (GRS80_A_M / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);

const ALPHA = [
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
  (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
  (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
  (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
  (212378941 * n6) / 319334400,
];

const BETA = [
  n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
  (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
  (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
  (4583 * n5) / 161280 - (108847 * n6) / 3991680,
  (20648693 * n6) / 638668800,
];

export interface Puwg92Point {
  eastingM: number;
  northingM: number;
}

export interface LatLon {
  latDeg: number;
  lonDeg: number;
}

/** Współrzędne geograficzne [°] → PUWG 1992 [m]. */
export function latLonToPuwg92(latDeg: number, lonDeg: number): Puwg92Point {
  const phi = latDeg * DEG;
  const lambda = (lonDeg - PUWG92_LON0_DEG) * DEG;
  const sinPhi = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sinPhi) - ECC * Math.atanh(ECC * sinPhi));
  const xiP = Math.atan2(t, Math.cos(lambda));
  const etaP = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 6; j++) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  return {
    eastingM: PUWG92_FALSE_EASTING_M + PUWG92_K0 * A_RECT * eta,
    northingM: PUWG92_FALSE_NORTHING_M + PUWG92_K0 * A_RECT * xi,
  };
}

/** PUWG 1992 [m] → współrzędne geograficzne [°]. */
export function puwg92ToLatLon(eastingM: number, northingM: number): LatLon {
  const xi = (northingM - PUWG92_FALSE_NORTHING_M) / (PUWG92_K0 * A_RECT);
  const eta = (eastingM - PUWG92_FALSE_EASTING_M) / (PUWG92_K0 * A_RECT);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 6; j++) {
    xiP -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const sinhEtaP = Math.sinh(etaP);
  const cosXiP = Math.cos(xiP);
  const lambda = Math.atan2(sinhEtaP, cosXiP);
  // τ' = tan χ (szerokość konforemna) → τ = tan φ metodą Newtona.
  const tauP = Math.sin(xiP) / Math.sqrt(sinhEtaP * sinhEtaP + cosXiP * cosXiP);
  let tau = tauP;
  for (let iter = 0; iter < 6; iter++) {
    const sqrt1Tau = Math.sqrt(1 + tau * tau);
    const sigma = Math.sinh(ECC * Math.atanh((ECC * tau) / sqrt1Tau));
    const tauPi = tau * Math.sqrt(1 + sigma * sigma) - sigma * sqrt1Tau;
    const dTau =
      ((tauP - tauPi) / Math.sqrt(1 + tauPi * tauPi)) * ((1 + (1 - E2) * tau * tau) / ((1 - E2) * sqrt1Tau));
    tau += dTau;
    if (Math.abs(dTau) < 1e-14) break;
  }
  return { latDeg: Math.atan(tau) / DEG, lonDeg: PUWG92_LON0_DEG + lambda / DEG };
}
