/**
 * Diagnoza śniegu naturalnego (etap 6b): ile dni w sezonie (1 XII – 31 III) baza ubita na otwartym
 * terenie przekracza progi otwarcia trasy – na wysokości dolnej stacji i Hali Miziowej – w zimach
 * z generatora pogody i w prawdziwych zimach IMGW 2001–2025 (model śniegu na zmierzonej pogodzie,
 * przeniesionej na tę wysokość). Do tego pomiary grubości pokrywy na stacjach i miejsce zimy
 * 2026/27 (seed z ustawień) w rozkładzie.
 *
 * Uruchomienie: npm run snow-diagnosis [liczba zim generatora, domyślnie 100]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import climateJson from '../../data/climate/pilsko.json';
import radiationJson from '../../data/radiation.json';
import settingsJson from '../../data/settings.json';
import snowJson from '../../data/snow.json';
import wxJson from '../../data/weather-generator.json';
import { parseClimateProfile } from '../sim/climate';
import { seasonWeather } from '../sim/environment';
import { puwg92ToLatLon } from '../sim/geo';
import { parseRadiationParams } from '../sim/radiation';
import { parseSimSettings } from '../sim/settings';
import { parseSnowParams } from '../sim/snow';
import type { StationData } from '../sim/snowCalibration';
import { observedDays } from '../sim/snowCalibration';
import { winterSkiDays, winterSnowDays } from '../sim/winterClass';
import { observedToDailyWeather, profileAtPoint, runPointSnow } from '../sim/snowPoint';
import { parseRidingParams } from '../sim/snowRiding';
import { addDays, parseIsoDate } from '../sim/time';
import { parseWeatherParams } from '../sim/weather';
import { loadMapFromDisk } from './loadMapFromDisk';

const CLASSES = process.argv.includes('--klasy');
const N = Number(process.argv.find((a, i) => i >= 2 && /^\d+$/.test(a)) ?? 100);
const profile = parseClimateProfile(climateJson);
const wp = parseWeatherParams(wxJson);
const sp = parseSnowParams(snowJson);
const rp = parseRadiationParams(radiationJson);
const riding = parseRidingParams(snowJson);
const settings = parseSimSettings(settingsJson);
const { def, grid } = loadMapFromDisk();
const c = puwg92ToLatLon(grid.georef!.westEastingM + grid.widthM / 2, grid.georef!.northNorthingM - grid.heightM / 2);
const loc = { latDeg: c.latDeg, lonDeg: c.lonDeg, timeZone: def.timeZone };
const ELEV = [{ name: 'dolna stacja (750 m)', z: 750 }, { name: 'Hala Miziowa (1270 m)', z: 1270 }];
const TH = [riding.minBaseCmByGround[1], riding.minBaseCmByGround[2], riding.minBaseCmByGround[4]];

type Row = { label: string; cover30: number; base: number[] };
const stats = (rows: Row[]) => {
  const m = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
  const q = (f: (r: Row) => number, p: number) => {
    const v = rows.map(f).sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0;
  };
  return { n: rows.length, cover30: m((r) => r.cover30), base: TH.map((_, i) => m((r) => r.base[i])), p20: TH.map((_, i) => q((r) => r.base[i], 0.2)), p50: TH.map((_, i) => q((r) => r.base[i], 0.5)) };
};
const fmt = (v: number) => v.toFixed(1).padStart(6);

const t0 = performance.now();
if (CLASSES) {
  // Rozkład wielolecia do oceny zimy w raporcie sezonu (data/winter-classes.json): 4 ziarna × 40 zim.
  const z = 1100;
  const base = riding.minBaseCmByGround[2];
  const t = { elevationM: z, baseThresholdCm: base, sortedDays: [0], meanDays: 0 };
  const deps = { profile, weatherParams: wp, snowParams: sp, radiationParams: rp, riding, location: loc };
  const days: number[] = [];
  for (let s = 0; s < 4; s++) for (let y = 0; y < 40; y++) days.push(winterSkiDays(settings.seed + 1000 * s, 2026 + y, t, deps));
  days.sort((a, b) => a - b);
  const mean = days.reduce((a, b) => a + b, 0) / days.length;
  const out = {
    _opis: 'Rozkład liczby dni sezonu (1 XII – 31 III) z bazą ubitą ≥ progu łąki naturalnej na otwartym terenie na wysokości odniesienia – 160 zim z generatora pogody (4 ziarna × 40 lat), model śniegu w punkcie. Do oceny zimy w raporcie sezonu (kwintyle: bardzo słaba … bardzo dobra) i do wyboru pierwszej zimy kariery (nie z najsłabszych 20 %). Wynik npm run snow-diagnosis -- --klasy; nie edytować ręcznie.',
    elevationM: { value: z, unit: 'm n.p.m.', source: 'środek wysokości ośrodka Pilsko (dolne stacje ok. 750 m, Hala Miziowa ok. 1300 m)' },
    baseThresholdCm: { value: base, unit: 'cm bazy ubitej', source: 'data/snow.json, riding.minBaseMeadowCm' },
    meanDays: { value: Math.round(mean * 10) / 10, unit: 'dni', source: 'średnia ze 160 zim' },
    sortedDays: { value: days, unit: 'dni', source: 'liczby dni w kolejnych zimach, rosnąco' },
  };
  writeFileSync('data/winter-classes.json', JSON.stringify(out, null, 1) + '\n');
  const pct = (p: number) => days[Math.floor(p * days.length)];
  console.log(`Zapisano data/winter-classes.json: ${z} m, próg ${base} cm, średnio ${mean.toFixed(1)} dni, kwintyle ${[0.2, 0.4, 0.6, 0.8].map(pct).join(' / ')}`);
  console.log(`Zima 2026/27 (seed ${settings.seed}): ${winterSkiDays(settings.seed, 2026, t, deps)} dni`);
  process.exit(0);
}
for (const e of ELEV) {
  console.log(`\n=== ${e.name} – dni 1 XII – 31 III (122) z bazą ubitą ≥ ${TH.join(' / ')} cm i z pokrywą ≥ 30 cm (teren otwarty) ===`);
  // Generator
  const gen: Row[] = [];
  for (let k = 0; k < N; k++) {
    const y = 2026 + k;
    const weather = seasonWeather(profile, wp, settings.seed, y).slice(0, wp.seasonLengthDays + 1);
    const run = runPointSnow({ elevationM: e.z, ...loc, weather, profile, weatherParams: wp, snowParams: sp, radiationParams: rp, weatherAtPointElevation: false });
    const d = winterSnowDays(run.dates, run.sweMm, run.depthM, riding, TH);
    gen.push({ label: `${y}/${String((y + 1) % 100).padStart(2, '0')}`, cover30: d.cover30, base: d.base });
  }
  const g30 = stats(gen.slice(0, 30));
  const gAll = stats(gen);
  // Prawdziwe zimy: model na zmierzonej pogodzie przeniesionej na wysokość e.z.
  const stations = (JSON.parse(readFileSync(new URL('../../data/calibration/imgw-stations.json', import.meta.url), 'utf8')) as { stations: StationData[] }).stations;
  const real: Row[] = [];
  for (const st of stations) {
    for (const w of st.winters) {
      const weather = observedToDailyWeather(observedDays(w), profileAtPoint(profile, st.elevationM), wp);
      const run = runPointSnow({ elevationM: e.z, ...loc, weather, profile: profileAtPoint(profile, st.elevationM), weatherParams: wp, snowParams: sp, radiationParams: rp, weatherAtPointElevation: false });
      const d = winterSnowDays(run.dates, run.sweMm, run.depthM, riding, TH);
      real.push({ label: `${st.name} ${w.start.slice(0, 4)}`, cover30: d.cover30, base: d.base });
    }
  }
  const r = stats(real);
  console.log(`źródło                         zim   pokr≥30  ${TH.map((t) => `baza≥${t}`.padStart(8)).join('')}   (mediana / 20. percentyl bazy≥25)`);
  console.log(`generator, zimy 2026–2055      ${String(g30.n).padStart(3)}  ${fmt(g30.cover30)}  ${g30.base.map((v) => fmt(v) + '  ').join('')}  ${g30.p50[1]} / ${g30.p20[1]}`);
  console.log(`generator, ${N} zim             ${String(gAll.n).padStart(3)}  ${fmt(gAll.cover30)}  ${gAll.base.map((v) => fmt(v) + '  ').join('')}  ${gAll.p50[1]} / ${gAll.p20[1]}`);
  console.log(`IMGW 2001–2025 (model)         ${String(r.n).padStart(3)}  ${fmt(r.cover30)}  ${r.base.map((v) => fmt(v) + '  ').join('')}  ${r.p50[1]} / ${r.p20[1]}`);
  const first = gen[0];
  const rank = gen.filter((x) => x.base[1] < first.base[1]).length / gen.length;
  console.log(`zima ${first.label} (seed ${settings.seed}): pokrywa ≥30 cm ${first.cover30} dni, baza ≥ ${TH.join('/')}: ${first.base.join(' / ')} dni – percentyl (baza ≥ 25) ${(rank * 100).toFixed(0)} %`);
}

// Pomiary grubości na stacjach (ok. 650–700 m) a model na generatorze na tej samej wysokości.
console.log('\n=== Pomiary IMGW: dni 1 XII – 31 III z pokrywą ≥ 30 cm (zmierzoną) – stacje 650–700 m ===');
{
  const stations = (JSON.parse(readFileSync(new URL('../../data/calibration/imgw-stations.json', import.meta.url), 'utf8')) as { stations: StationData[] }).stations;
  for (const st of stations) {
    const days: number[] = [];
    const days10: number[] = [];
    for (const w of st.winters) {
      const s = parseIsoDate(w.start);
      let n = 0;
      let n10 = 0;
      let valid = 0;
      w.snowDepthCm.forEach((v, i) => {
        const d = addDays(s, i);
        if (!(d.month === 12 || d.month <= 3)) return;
        if (v === null) return;
        valid++;
        if (v >= 30) n++;
        if (v >= 10) n10++;
      });
      if (valid > 100) {
        days.push(n);
        days10.push(n10);
      }
    }
    const gen: number[] = [];
    const gen10: number[] = [];
    for (let k = 0; k < 30; k++) {
      const weather = seasonWeather(profile, wp, settings.seed, 2026 + k).slice(0, wp.seasonLengthDays + 1);
      const run = runPointSnow({ elevationM: st.elevationM, ...loc, weather, profile, weatherParams: wp, snowParams: sp, radiationParams: rp, weatherAtPointElevation: false });
      const d = winterSnowDays(run.dates, run.sweMm, run.depthM, riding, TH);
      gen.push(d.cover30);
      gen10.push(d.cover10);
    }
    const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    console.log(`${st.name.padEnd(10)} ${st.elevationM} m: zmierzone ${days.length} zim – pokrywa ≥30 cm ${m(days).toFixed(1)} dni, ≥10 cm ${m(days10).toFixed(1)} dni; generator (30 zim, model) ≥30 cm ${m(gen).toFixed(1)}, ≥10 cm ${m(gen10).toFixed(1)}`);
  }
}
console.log(`\nCzas ${((performance.now() - t0) / 1000).toFixed(0)} s`);
