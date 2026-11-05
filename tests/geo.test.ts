import { describe, expect, it } from 'vitest';
import { latLonToPuwg92, puwg92ToLatLon } from '../src/sim/geo';

// Wartości wzorcowe policzone biblioteką PROJ (pyproj 3, EPSG:4326 → EPSG:2180).
const REFERENCE = [
  { name: 'Hala Miziowa (przybliżenie)', latDeg: 49.54, lonDeg: 19.32, eastingM: 523144.5672, northingM: 185890.1104 },
  { name: 'południk osiowy 19° E', latDeg: 52.0, lonDeg: 19.0, eastingM: 500000.0, northingM: 459309.2094 },
  { name: 'Świnoujście (skraj zachodni)', latDeg: 53.9, lonDeg: 14.2, eastingM: 184816.0951, northingM: 681281.2864 },
  { name: 'Bieszczady (skraj wschodni)', latDeg: 49.1, lonDeg: 24.1, eastingM: 872097.6779, northingM: 149472.9608 },
  { name: 'Warszawa', latDeg: 52.2297, lonDeg: 21.0122, eastingM: 637382.2044, northingM: 486757.2095 },
];

describe('Współrzędne PUWG 1992 (EPSG:2180)', () => {
  it.each(REFERENCE)('$name: stopnie → PUWG 1992 zgodnie z PROJ (±1 cm)', (p) => {
    const r = latLonToPuwg92(p.latDeg, p.lonDeg);
    expect(Math.abs(r.eastingM - p.eastingM)).toBeLessThan(0.01);
    expect(Math.abs(r.northingM - p.northingM)).toBeLessThan(0.01);
  });

  it.each(REFERENCE)('$name: PUWG 1992 → stopnie zgodnie z PROJ (±1e-7°, ok. 1 cm)', (p) => {
    const r = puwg92ToLatLon(p.eastingM, p.northingM);
    expect(Math.abs(r.latDeg - p.latDeg)).toBeLessThan(1e-7);
    expect(Math.abs(r.lonDeg - p.lonDeg)).toBeLessThan(1e-7);
  });
});
