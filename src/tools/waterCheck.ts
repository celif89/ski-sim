/**
 * Sprawdzenie modelu potoków (etap 6b): sieć cieków na mapie, przepływy w wybranych miejscach,
 * porównanie długości cieków z OSM i z modelu terenu. Uruchomienie: npm run water-check
 */
import { readFileSync } from 'node:fs';
import { parseClimateProfile } from '../sim/climate';
import type { PointM } from '../sim/lifts';
import { annualPrecipitationMm, buildStreamNet, flowFactor, normalPrecipMm, parseWaterParams } from '../sim/water';
import { loadMapFromDisk } from './loadMapFromDisk';

const { grid } = loadMapFromDisk('pilsko');
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
