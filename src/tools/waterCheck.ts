/**
 * Sprawdzenie modelu potoków (etap 6b): sieć cieków na mapie, przepływy w wybranych miejscach,
 * porównanie długości cieków z OSM i z modelu terenu. Uruchomienie: npm run water-check
 */
import { readFileSync } from 'node:fs';
import { parseClimateProfile } from '../sim/climate';
import type { PointM } from '../sim/lifts';
import { parseSnowmakingParams } from '../sim/snowmakingParams';
import { annualPrecipitationMm, buildStreamNet, flowFactor, normalPrecipMm, parseWaterParams, wellYieldM3h } from '../sim/water';
import { loadMapFromDisk } from './loadMapFromDisk';

const { grid } = loadMapFromDisk('pilsko');
const sp = parseSnowmakingParams(JSON.parse(readFileSync('data/snowmaking.json', 'utf8')));
const wp = parseWaterParams(JSON.parse(readFileSync('data/water.json', 'utf8')));
const profile = parseClimateProfile(JSON.parse(readFileSync('data/climate/pilsko.json', 'utf8')));
const osmRaw = JSON.parse(readFileSync('data/maps/pilsko/osm-water.json', 'utf8')) as { streams: { name: string; points: [number, number][] }[] };
const osm = osmRaw.streams.map((s) => ({ name: s.name, points: s.points.map(([e, n]) => grid.puwg92ToLocal(e, n)).filter((q): q is PointM => q !== null) }));
const t0 = performance.now();
const net = buildStreamNet({ grid, osm, annualPrecipMm: (z) => annualPrecipitationMm(profile, z), params: wp });
console.log(`Sieć cieków: ${(performance.now() - t0).toFixed(0)} ms`);
const len = (pts: PointM[]) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p.xM - pts[i - 1].xM, p.yM - pts[i - 1].yM) : 0), 0);
const osmL = net.lines.filter((l) => l.osm);
const demL = net.lines.filter((l) => !l.osm);
console.log(`OSM: ${osmL.length} linii, ${(osmL.reduce((a, l) => a + len(l.points), 0) / 1000).toFixed(1)} km; z modelu terenu: ${demL.length} linii, ${(demL.reduce((a, l) => a + len(l.points), 0) / 1000).toFixed(1)} km`);
const byName = new Map<string, number>();
for (const l of net.lines) byName.set(l.name, Math.max(byName.get(l.name) ?? 0, ...l.meanFlowM3s));
for (const [n, q] of [...byName].sort((a, b) => b[1] - a[1])) console.log(`  ${n}: największy średni przepływ na mapie ${(q * 1000).toFixed(0)} l/s (${(q * 3600).toFixed(0)} m³/h)`);
let maxK = 0;
for (let k = 0; k < net.accM2.length; k++) if (net.accM2[k] > net.accM2[maxK]) maxK = k;
console.log(`Największa zlewnia na mapie: ${(net.accM2[maxK] / 1e6).toFixed(2)} km², średnia wysokość ${net.meanZM[maxK].toFixed(0)} m, przepływ ${(net.meanFlowM3s[maxK] * 1000).toFixed(0)} l/s → ${((net.meanFlowM3s[maxK] * 1000) / (net.accM2[maxK] / 1e6)).toFixed(1)} l/(s·km²)`);
console.log('Rytm (czynnik przepływu przy normalnym opadzie):', Array.from({ length: 12 }, (_, m) => flowFactor(m + 1, normalPrecipMm(profile, m + 1, 30), normalPrecipMm(profile, m + 1, 30), wp).toFixed(2)).join(' '));

// Ujęcia na nazwanych potokach (najniższy punkt na mapie i połowa biegu): ile wolno pobrać w miesiącu
// przy normalnym opadzie i w ile dni ujęcie 60 m³/h napełni zbiornik 50 tys. m³ (bez zużycia).
const MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const intakeCap = 60;
for (const name of ['Glinna', 'Buczynka', 'Kamienny', 'Potok w Cebuli']) {
  const lines = net.lines.filter((l) => l.name === name);
  if (!lines.length) continue;
  const pts = lines.flatMap((l) => l.points.map((p, i) => ({ p, q: l.meanFlowM3s[i] })));
  pts.sort((a, b) => a.q - b.q);
  for (const pick of [pts[Math.floor(pts.length / 2)], pts[pts.length - 1]]) {
    const meanH = pick.q * 3600;
    const row = MONTHS.map((_, m) => {
      const f = flowFactor(m + 1, normalPrecipMm(profile, m + 1, 30), normalPrecipMm(profile, m + 1, 30), wp);
      return Math.max(0, Math.min(wp.streams.maxWithdrawalShare * meanH * f, meanH * f - wp.streams.ecologicalFlowShare * meanH));
    });
    const days = (m: number) => 50000 / (24 * Math.min(intakeCap, row[m]));
    console.log(
      `${name} (z = ${grid.sampleElevationM(pick.p.xM, pick.p.yM).toFixed(0)} m): średnio ${meanH.toFixed(0)} m³/h; wolno pobrać [m³/h] ${row.map((v, m) => `${MONTHS[m]} ${v.toFixed(0)}`).join(', ')}; zbiornik 50 tys. m³ z ujęcia 60 m³/h: w maju ${days(4).toFixed(0)} dni, w listopadzie ${days(10).toFixed(0)} dni`,
    );
  }
}
const mains = sp.buildings.find((b) => b.kind === 'mains')!;
console.log(`Wodociąg ${mains.capacity} m³/h: ${mains.capacity * 24} m³/dobę, 50 tys. m³ w ${(50000 / (mains.capacity * 24)).toFixed(0)} dni za ${((50000 * wp.mains.pricePlnPerM3) / 1000).toFixed(0)} tys. zł`);
const ys = Array.from({ length: 2000 }, (_, k) => wellYieldM3h(k, 'S1', 100, wp)).sort((a, b) => a - b);
console.log(`Studnia 100 m: wydajność (2000 losowań) 10 % ${ys[200].toFixed(1)}, mediana ${ys[1000].toFixed(1)}, 90 % ${ys[1800].toFixed(1)} m³/h → 50 tys. m³ przy medianie w ${(50000 / (24 * ys[1000])).toFixed(0)} dni`);
