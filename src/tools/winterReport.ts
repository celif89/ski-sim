/**
 * Raport „przewiń zimę” – npm run winter-report.
 *
 * 1. Kalibracja: model śniegu na rzeczywistej pogodzie IMGW w punktach stacji (Korbielów, Zawoja,
 *    Laliki) i porównanie z mierzoną grubością pokrywy – werdykt na górze raportu.
 * 2. Sprawdzenie promieniowania na pomiarach aktynometrycznych (Bielsko-Biała, Kasprowy Wierch).
 * 3. Cała mapa: przykładowa zima gry (2026/27) dzień po dniu – punkty kontrolne i mapy grubości
 *    1 XII … 1 IV; 30 wygenerowanych zim – liczba dni z pokrywą ≥ 30 cm, rozkład z wysokością,
 *    porównanie z pracą Łajczaka (1996).
 *
 * Wynik: reports/raport-zimy.html (jeden plik). Opcjonalnie ścieżka wyjściowa jako argument,
 * a jako drugi argument liczba zim (np. 4 – szybki podgląd).
 * Sezony liczone są równolegle w kilku wątkach (worker_threads).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { Worker } from 'node:worker_threads';
import climateJson from '../../data/climate/pilsko.json';
import radiationJson from '../../data/radiation.json';
import settingsJson from '../../data/settings.json';
import snowJson from '../../data/snow.json';
import wxJson from '../../data/weather-generator.json';
import reportJson from '../../data/winter-report.json';
import lajczakJson from '../../data/calibration/lajczak-1996.json';
import mapStyleJson from '../../data/map-style.json';
import { parseClimateProfile } from '../sim/climate';
import { puwg92ToLatLon } from '../sim/geo';
import { computeHorizon, parseHorizonParams } from '../sim/horizon';
import { parseRadiationParams, prepareSolarTerrain } from '../sim/radiation';
import type { RadiationParams } from '../sim/radiation';
import type { RadiationStationData } from '../sim/radiationValidation';
import { validateRadiation } from '../sim/radiationValidation';
import { parseSimSettings } from '../sim/settings';
import type { SnowBalance, SnowParams } from '../sim/snow';
import { SNOW_QUALITY_CODES, SNOW_QUALITY_NAMES, parseSnowParams } from '../sim/snow';
import type { CalibrationSummary, StationData, WinterComparison } from '../sim/snowCalibration';
import { compareStations } from '../sim/snowCalibration';
import { runPointSnow } from '../sim/snowPoint';
import { seasonWeather } from '../sim/environment';
import { buildSolarCache, createSnowDomain } from '../sim/snowSeason';
import { computeHillshade } from '../sim/terrainAnalysis';
import { addDays, daysBetween } from '../sim/time';
import type { CalendarDate, Location } from '../sim/weather';
import { parseWeatherParams } from '../sim/weather';
import { FOREST_COLOR, SNOW_DEPTH_STOPS, sampleColorStops } from '../render/colors';
import { loadMapFromDisk } from './loadMapFromDisk';
import { MONTH_NAMES, MONTH_SHORT, encodePng, esc, fmt, niceStep } from './reportKit';
import type { WinterJob, WinterWorkerData } from './winterWorker';
import type { SeasonRunOutput } from './winterRuns';

const OUT = process.argv[2] ?? 'reports/raport-zimy.html';
const WINTERS_OVERRIDE = process.argv[3] ? Number(process.argv[3]) : null;

function log(message: string): void {
  console.log(`[winter-report] ${message}`);
}

// ------------------------------------------------------------------ ustawienia

interface Param {
  value: number;
}
const R = reportJson as unknown as {
  verdict: { maxMaeCm: Param; maxCoverDaysBias: Param; maxStationBiasCm: Param };
  generatedWinters: { count: Param; firstSeasonStartYear: Param; runUntilMonth: Param; deepCoverThresholdCm: Param };
  mapDates: { dates: string[] };
  points: { list: { id: string; name: string; eastingM: number; northingM: number; note: string }[] };
  calibration: { before: { file: 'snow' | 'radiation'; param: string; label: string; value: number; unit: string; source: string }[] };
};
const LAJ = lajczakJson as unknown as {
  sites: { name: string; elevationM: number; meltOut1994: string; meltOutNormal: string; coverDays1994: number; coverDaysNormal: number; maxDepthNormalCm?: number; maxDepth1993Cm?: number; maxDepth1994Cm?: number }[];
  qualitative: string[];
};

const MONTH_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const POINT_COLORS = ['#1f6fd1', '#7b3fbf', '#d1495b', '#e08a1e', '#2e8b57', '#0f9fb0', '#8a6d3b', '#6b7280'];

const dateLabel = (d: CalendarDate) => `${d.day} ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][d.month - 1]}`;
const signed = (x: number, digits = 1) => `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x), digits)}`;
const mean = (a: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : Number.NaN;
};
const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return Number.NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

// ------------------------------------------------------------------ wykresy

interface TimeSeries {
  name: string;
  color: string;
  values: ArrayLike<number | null>;
  width?: number;
  dashed?: boolean;
  /** Pasmo (np. 10–90 %) wokół serii. */
  band?: { lo: ArrayLike<number>; hi: ArrayLike<number> };
  dots?: boolean;
}

/** Wykres czasowy: oś X – dni od `start`, etykiety miesięcy. */
function timeChart(start: CalendarDate, days: number, series: TimeSeries[], unit: string, opts: { width?: number; height?: number; yMax?: number; small?: boolean; hLines?: { v: number; label: string }[] } = {}): string {
  const W = opts.width ?? 1040;
  const H = opts.height ?? 260;
  const pad = { l: opts.small ? 34 : 46, r: 10, t: 16, b: 22 };
  let hi = opts.yMax ?? 0;
  if (opts.yMax === undefined) {
    for (const s of series) {
      for (let i = 0; i < days; i++) {
        const v = s.values[i];
        if (v !== null && v !== undefined && v > hi) hi = v;
        if (s.band && s.band.hi[i] > hi) hi = s.band.hi[i];
      }
    }
  }
  const step = niceStep(Math.max(hi, 10), opts.small ? 3 : 5);
  hi = Math.max(step, Math.ceil(hi / step) * step);
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (pw * (i + 0.5)) / days;
  const y = (v: number) => pad.t + ph * (1 - Math.min(v, hi) / hi);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart${opts.small ? ' small' : ' wide'}" role="img">`;
  for (let v = 0; v <= hi + 1e-9; v += step) {
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    svg += `<text x="${pad.l - 5}" y="${y(v) + 4}" class="tick" text-anchor="end">${fmt(v, 0)}</text>`;
  }
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    if (d.day !== 1) continue;
    svg += `<line x1="${x(i) - pw / days / 2}" x2="${x(i) - pw / days / 2}" y1="${pad.t}" y2="${H - pad.b}" class="grid"/>`;
    svg += `<text x="${x(i) + 2}" y="${H - 6}" class="tick">${opts.small ? MONTH_SHORT[d.month - 1] : MONTH_NAMES[d.month - 1]}</text>`;
  }
  for (const h of opts.hLines ?? []) {
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(h.v)}" y2="${y(h.v)}" class="hline"/><text x="${W - pad.r - 4}" y="${y(h.v) - 4}" class="tick" text-anchor="end">${esc(h.label)}</text>`;
  }
  for (const s of series) {
    if (s.band) {
      const up: string[] = [];
      const down: string[] = [];
      for (let i = 0; i < days; i++) {
        up.push(`${x(i)},${y(s.band.hi[i])}`);
        down.push(`${x(days - 1 - i)},${y(s.band.lo[days - 1 - i])}`);
      }
      svg += `<polygon points="${up.join(' ')} ${down.join(' ')}" fill="${s.color}" opacity="0.18"/>`;
    }
    if (s.dots) {
      for (let i = 0; i < days; i++) {
        const v = s.values[i];
        if (v === null || v === undefined) continue;
        svg += `<circle cx="${x(i)}" cy="${y(v)}" r="${opts.small ? 1.6 : 2.2}" fill="${s.color}"/>`;
      }
      continue;
    }
    // Linia z przerwami tam, gdzie brak danych.
    let path = '';
    let pen = false;
    for (let i = 0; i < days; i++) {
      const v = s.values[i];
      if (v === null || v === undefined || Number.isNaN(v)) {
        pen = false;
        continue;
      }
      path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 1.8}"${s.dashed ? ' stroke-dasharray="4 3"' : ''}/>`;
  }
  svg += `<text x="${pad.l}" y="${pad.t - 4}" class="unit">${unit}</text></svg>`;
  return svg;
}

function legend(items: { name: string; color: string; dashed?: boolean; band?: boolean }[]): string {
  return `<div class="legend">${items.map((s) => `<span><i style="background:${s.color}${s.band ? ';opacity:.35' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

// ------------------------------------------------------------------ mapy

function makeMapImage(values: ArrayLike<number>, maxValue: number, hillshade: Float32Array, forest: Float32Array, emptyBelow: number): Uint8Array {
  const n = values.length;
  const rgba = new Uint8Array(n * 4);
  const c: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const v = values[k];
    if (Number.isNaN(v)) {
      rgba.set([190, 190, 196, 255], k * 4);
      continue;
    }
    if (v < emptyBelow) {
      // Bez śniegu: trawa / las.
      const f = forest[k];
      c[0] = 196 * (1 - f) + FOREST_COLOR[0] * f;
      c[1] = 190 * (1 - f) + FOREST_COLOR[1] * f;
      c[2] = 160 * (1 - f) + FOREST_COLOR[2] * f;
    } else {
      sampleColorStops(SNOW_DEPTH_STOPS, Math.min(1, 0.08 + (0.92 * v) / maxValue), c);
    }
    const shade = 0.78 + 0.32 * (hillshade[k] / Math.SQRT1_2 - 1);
    rgba.set([Math.min(255, c[0] * shade), Math.min(255, c[1] * shade), Math.min(255, c[2] * shade), 255], k * 4);
  }
  return rgba;
}

function scaleBar(maxValue: number, unit: string): string {
  const stops = Array.from({ length: 11 }, (_, i) => {
    const c: [number, number, number] = [0, 0, 0];
    sampleColorStops(SNOW_DEPTH_STOPS, 0.08 + 0.092 * i, c);
    return `rgb(${c.map(Math.round).join(',')}) ${i * 10}%`;
  }).join(', ');
  return `<div class="scalebox"><div class="scale" style="background:linear-gradient(90deg,${stops})"></div><div class="scale-labels"><span>0</span><span>${fmt(maxValue / 2, 0)}</span><span>≥ ${fmt(maxValue, 0)} ${unit}</span></div></div>`;
}

// ------------------------------------------------------------------ obliczenia

function runWinters(base: WinterWorkerData, jobs: WinterJob[], threads: number): Promise<Map<number, SeasonRunOutput>> {
  return new Promise((resolve, reject) => {
    const results = new Map<number, SeasonRunOutput>();
    const queue = [...jobs];
    const workers: Worker[] = [];
    let done = 0;
    const next = (w: Worker) => {
      const job = queue.shift();
      if (job) w.postMessage(job);
    };
    for (let i = 0; i < Math.min(threads, jobs.length); i++) {
      const w = new Worker(new URL('./winterWorker.ts', import.meta.url), { workerData: base });
      w.on('message', (m: { startYear: number; result: SeasonRunOutput }) => {
        results.set(m.startYear, m.result);
        done++;
        log(`  sezon ${m.startYear}/${String(m.startYear + 1).slice(-2)} gotowy (${(m.result.elapsedMs / 1000).toFixed(1)} s) – ${done}/${jobs.length}`);
        if (done === jobs.length) {
          for (const x of workers) void x.terminate();
          resolve(results);
        } else next(w);
      });
      w.on('error', reject);
      workers.push(w);
      next(w);
    }
  });
}

function withOverrides(sp: SnowParams, rp: RadiationParams, list: { file: string; param: string; value: number }[]): { sp: SnowParams; rp: RadiationParams } {
  const s = { ...sp } as Record<string, number>;
  const r = { ...rp } as Record<string, number>;
  for (const o of list) {
    const target = o.file === 'snow' ? s : r;
    if (!(o.param in target)) throw new Error(`winter-report.json: nieznany parametr ${o.file}.${o.param}`);
    target[o.param] = o.value;
  }
  return { sp: s as unknown as SnowParams, rp: r as unknown as RadiationParams };
}

// ------------------------------------------------------------------ główny program

async function main(): Promise<void> {
  const tStart = performance.now();
  const profile = parseClimateProfile(climateJson);
  const wp = parseWeatherParams(wxJson);
  const sp = parseSnowParams(snowJson);
  const rp = parseRadiationParams(radiationJson);
  const seed = parseSimSettings(settingsJson).seed;
  const maxDepthScaleCm = (mapStyleJson as unknown as { overlayScales: { snowDepthMaxCm: Param } }).overlayScales.snowDepthMaxCm.value;

  // ---- 1. Kalibracja na stacjach IMGW
  log('Kalibracja: model na rzeczywistej pogodzie stacji IMGW…');
  const stations = (JSON.parse(readFileSync(new URL('../../data/calibration/imgw-stations.json', import.meta.url), 'utf8')) as { stations: StationData[] }).stations;
  const tCal = performance.now();
  const cal = compareStations(stations, profile, wp, sp, rp);
  const calMs = performance.now() - tCal;
  const before = withOverrides(sp, rp, R.calibration.before);
  const calBefore = compareStations(stations, profile, wp, before.sp, before.rp);
  const v = R.verdict;
  const stationBiasOk = cal.perStation.every((s) => Math.abs(s.biasCm) <= v.maxStationBiasCm.value);
  const checks = [
    { ok: cal.maeCm <= v.maxMaeCm.value, text: `średni błąd grubości ${fmt(cal.maeCm)} cm (próg ${fmt(v.maxMaeCm.value, 0)} cm)` },
    { ok: Math.abs(cal.coverDaysBias) <= v.maxCoverDaysBias.value, text: `długość zalegania ${signed(cal.coverDaysBias)} dnia średnio (próg ±${fmt(v.maxCoverDaysBias.value, 0)})` },
    { ok: stationBiasOk, text: `zawyżenie/zaniżenie na każdej stacji w granicach ±${fmt(v.maxStationBiasCm.value, 0)} cm` },
  ];
  const verdictOk = checks.every((c) => c.ok);

  // ---- 2. Promieniowanie
  log('Sprawdzenie promieniowania na pomiarach aktynometrycznych…');
  const radStations = (JSON.parse(readFileSync(new URL('../../data/calibration/radiation-stations.json', import.meta.url), 'utf8')) as { stations: RadiationStationData[] }).stations;
  const rad = validateRadiation(radStations, rp);
  const radBefore = validateRadiation(radStations, before.rp);

  // ---- 2b. Cały łańcuch: generator pogody + model śniegu w punktach stacji (teren płaski, otwarty)
  log('Cały łańcuch: wygenerowana pogoda + model w punktach stacji…');
  const chainWinters = WINTERS_OVERRIDE ?? R.generatedWinters.count.value;
  const chain = stations.map((stn) => {
    const obs = cal.winters.filter((w) => w.station === stn.name);
    const obsCover = mean(obs.map((w) => w.observedCoverDays));
    const obsMax = mean(obs.map((w) => w.observedMaxCm));
    const obsCoverSd = Math.sqrt(mean(obs.map((w) => (w.observedCoverDays - obsCover) ** 2)));
    const cover: number[] = [];
    const maxes: number[] = [];
    for (let i = 0; i < chainWinters; i++) {
      const weather = seasonWeather(profile, wp, seed, R.generatedWinters.firstSeasonStartYear.value + i);
      const run = runPointSnow({ elevationM: stn.elevationM, latDeg: stn.latDeg, lonDeg: stn.lonDeg, timeZone: { standardOffsetHours: 1, euDaylightSaving: true }, weather: weather.slice(0, 245), profile, weatherParams: wp, snowParams: sp, radiationParams: rp, weatherAtPointElevation: false });
      let c = 0;
      let mx = 0;
      run.dates.forEach((d, j) => {
        if (d.month < 11 && d.month > 4) return;
        const cm = run.depthM[j] * 100;
        if (cm >= sp.coverDepthM * 100) c++;
        if (cm > mx) mx = cm;
      });
      cover.push(c);
      maxes.push(mx);
    }
    return { name: stn.name, elevationM: stn.elevationM, winters: obs.length, obsCover, obsCoverSd, obsMax, genCover: mean(cover), genMax: mean(maxes) };
  });

  // ---- 3. Mapa: teren, horyzont, promieniowanie bezchmurne
  const { grid, dem, def, landCover } = loadMapFromDisk('pilsko');
  if (!landCover) throw new Error('Brak pokrycia terenu (npm run import-landcover).');
  log('Liczę horyzont (ok. 10–20 s)…');
  const horizon = computeHorizon(grid, dem, parseHorizonParams(radiationJson));
  const st = prepareSolarTerrain(grid, horizon);
  const ll = puwg92ToLatLon(def.westEastingM + grid.widthM / 2, def.northNorthingM - grid.heightM / 2);
  const location: Location = { latDeg: ll.latDeg, lonDeg: ll.lonDeg, timeZone: def.timeZone };
  const { forest, shrub } = landCover;
  const domain = createSnowDomain(grid, forest, shrub, sp);

  const g = R.generatedWinters;
  const winters = WINTERS_OVERRIDE ?? g.count.value;
  const firstYear = g.firstSeasonStartYear.value;
  const seasonStart: CalendarDate = { year: firstYear, month: wp.seasonStartMonth, day: 1 };
  const runEnd: CalendarDate = { year: firstYear + 1, month: g.runUntilMonth.value + 1, day: 1 };
  const days = daysBetween(seasonStart, runEnd);
  const statsFrom = daysBetween(seasonStart, { year: firstYear, month: 11, day: 1 });
  const statsTo = daysBetween(seasonStart, { year: firstYear + 1, month: 5, day: 1 });
  const mapDates = R.mapDates.dates.map((s) => {
    const [m, d] = s.split('-').map(Number);
    return { year: m >= wp.seasonStartMonth ? firstYear : firstYear + 1, month: m, day: d };
  });
  const mapAfterDays = mapDates.map((d) => daysBetween(seasonStart, d));
  log('Promieniowanie bezchmurnego nieba na sezon…');
  const tSolar = performance.now();
  const solar = buildSolarCache(st, seasonStart, days + 1, location, rp, sp);
  const solarMs = performance.now() - tSolar;

  const cellOf = (e: number, n: number) => Math.floor((def.northNorthingM - n) / grid.cellSizeM) * grid.widthCells + Math.floor((e - def.westEastingM) / grid.cellSizeM);
  const points = R.points.list.map((p, i) => ({ ...p, cell: cellOf(p.eastingM, p.northingM), color: POINT_COLORS[i % POINT_COLORS.length] }));

  const threads = Math.max(1, Math.min(availableParallelism(), 8));
  log(`Liczę ${winters} sezonów na całej mapie (${grid.widthCells} × ${grid.heightCells} komórek, ${days} dni każdy) w ${threads} wątkach…`);
  const base: WinterWorkerData = {
    domain,
    solar,
    profile,
    weatherParams: wp,
    snowParams: sp,
    radiationParams: rp,
    location,
    days,
    statsFromDay: statsFrom,
    statsToDay: statsTo,
    deepThresholdM: g.deepCoverThresholdCm.value / 100,
    coverThresholdM: sp.coverDepthM,
    pointCells: points.map((p) => p.cell),
    seed,
  };
  const years = Array.from({ length: winters }, (_, i) => firstYear + i);
  const tWinters = performance.now();
  const results = await runWinters(base, years.map((y) => ({ startYear: y, mapAfterDays: y === firstYear ? mapAfterDays : [] })), threads);
  const wintersMs = performance.now() - tWinters;
  const example = results.get(firstYear)!;
  const all = years.map((y) => results.get(y)!);
  const seasonMsMean = mean(all.map((r) => r.elapsedMs));

  // ---- statystyki z wielu zim
  const n = grid.cellCount;
  const z = grid.elevationM;
  const meanDeep = new Float32Array(n);
  const meanCover = new Float32Array(n);
  const meanCoverAll = new Float32Array(n);
  const meanMax = new Float32Array(n);
  const meanLast = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (z[k] !== z[k]) {
      meanDeep[k] = Number.NaN;
      continue;
    }
    let sd = 0;
    let sc = 0;
    let sca = 0;
    let sm = 0;
    let sl = 0;
    let nl = 0;
    for (const r of all) {
      sd += r.deepDays[k];
      sc += r.coverDays[k];
      sca += r.coverDaysAll[k];
      sm += r.maxDepthCm[k];
      if (r.lastCoverDay[k] >= 0) {
        sl += r.lastCoverDay[k] + 1;
        nl++;
      }
    }
    meanDeep[k] = sd / all.length;
    meanCover[k] = sc / all.length;
    meanCoverAll[k] = sca / all.length;
    meanMax[k] = sm / all.length;
    meanLast[k] = nl ? sl / nl : Number.NaN;
  }

  // Krzywizna: średnia wysokość w promieniu 100 m minus wysokość komórki (>0 – wklęsłe).
  const curvature = new Float32Array(n);
  {
    const r = Math.round(100 / grid.cellSizeM);
    const W = grid.widthCells;
    const H = grid.heightCells;
    for (let yy = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++) {
        const k = yy * W + xx;
        if (z[k] !== z[k]) continue;
        let s = 0;
        let c = 0;
        for (let dy = -r; dy <= r; dy += 2) {
          for (let dx = -r; dx <= r; dx += 2) {
            const x2 = xx + dx;
            const y2 = yy + dy;
            if (x2 < 0 || y2 < 0 || x2 >= W || y2 >= H) continue;
            const v2 = z[y2 * W + x2];
            if (v2 === v2) {
              s += v2;
              c++;
            }
          }
        }
        curvature[k] = s / c - z[k];
      }
    }
  }

  // Pasy wysokości (100 m): teren otwarty i las.
  interface Band {
    z0: number;
    open: number[];
    forest: number[];
  }
  const bands = new Map<number, Band>();
  for (let k = 0; k < n; k++) {
    if (z[k] !== z[k]) continue;
    const z0 = Math.floor(z[k] / 100) * 100;
    let b = bands.get(z0);
    if (!b) bands.set(z0, (b = { z0, open: [], forest: [] }));
    if (forest[k] < 0.2 && shrub[k] < 0.5) b.open.push(k);
    else if (forest[k] >= 0.8) b.forest.push(k);
  }
  const bandRows = [...bands.values()].sort((a, b) => a.z0 - b.z0).filter((b) => b.open.length + b.forest.length >= 200);
  const avg = (cells: number[], arr: Float32Array) => {
    let sum = 0;
    let cnt = 0;
    for (const k of cells) {
      if (Number.isNaN(arr[k])) continue;
      sum += arr[k];
      cnt++;
    }
    return cnt ? sum / cnt : Number.NaN;
  };
  const dayToDate = (d: number) => addDays(seasonStart, Math.round(d));

  // Wklęsłe vs wypukłe (teren otwarty, powyżej 1100 m).
  const concave: number[] = [];
  const convex: number[] = [];
  for (let k = 0; k < n; k++) {
    if (z[k] !== z[k] || z[k] < 1100 || forest[k] >= 0.2) continue;
    if (curvature[k] > 3) concave.push(k);
    else if (curvature[k] < -3) convex.push(k);
  }
  // Stoki N i S (nachylenie ≥ 15 %), te same pasy wysokości 800–1200 m, las i teren otwarty razem.
  const aspectCells = (lo: number, hi: number, inForest: boolean) => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      if (z[k] !== z[k] || z[k] < 800 || z[k] >= 1400 || grid.slopePercent[k] < 15) continue;
      if (inForest ? forest[k] < 0.8 : forest[k] >= 0.2) continue;
      const a = grid.aspectDeg[k];
      if (lo < hi ? a >= lo && a < hi : a >= lo || a < hi) out.push(k);
    }
    return out;
  };
  const nsCompare = [false, true].map((inForest) => {
    const north = aspectCells(315, 45, inForest);
    const south = aspectCells(135, 225, inForest);
    // Porównanie w tych samych pasach wysokości (ważone liczbą komórek stoku S).
    let dCover = 0;
    let dMelt = 0;
    let ratio = 0;
    let wsum = 0;
    for (let z0 = 800; z0 < 1400; z0 += 100) {
      const nb = north.filter((k) => z[k] >= z0 && z[k] < z0 + 100);
      const sb = south.filter((k) => z[k] >= z0 && z[k] < z0 + 100);
      if (nb.length < 20 || sb.length < 20) continue;
      const wgt = sb.length;
      dCover += wgt * (avg(nb, meanCover) - avg(sb, meanCover));
      ratio += wgt * (avg(nb, meanCover) / Math.max(1, avg(sb, meanCover)));
      dMelt += wgt * (avg(nb, meanLast) - avg(sb, meanLast));
      wsum += wgt;
    }
    return { inForest, north: north.length, south: south.length, dCover: dCover / wsum, ratio: ratio / wsum, dMelt: dMelt / wsum };
  });

  // ---- bilans masy przykładowej zimy
  const bal: SnowBalance = example.balance;
  const perCell = (x: number) => x / example.validCells;
  const balanceErrorPercent = (100 * Math.abs(bal.precipitationMm - (example.storageMm + bal.runoffMm + bal.sublimationMm + bal.windOutMm))) / Math.max(1e-9, bal.precipitationMm);

  // ---- rysowanie
  log('Rysuję raport…');
  const hillshade = computeHillshade(grid, { lightAzimuthDeg: 315, lightAltitudeDeg: 45, zFactor: 1.5 });
  const png = (values: ArrayLike<number>, maxV: number, emptyBelow: number) => encodePng(grid.widthCells, grid.heightCells, makeMapImage(values, maxV, hillshade, forest, emptyBelow));
  let deepMax = 30;
  for (const x of meanDeep) if (x > deepMax) deepMax = x;
  deepMax = Math.ceil(deepMax / 30) * 30;

  // Punkty kontrolne – opis i statystyki z wielu zim.
  const pointStats = points.map((p, i) => {
    const maxes = all.map((r) => Math.max(...r.pointDepthCm[i]));
    const lasts = all.map((r) => {
      let last = -1;
      for (let d = 0; d < days; d++) if (r.pointDepthCm[i][d] >= sp.coverDepthM * 100) last = d;
      return last + 1;
    });
    const meltDays = lasts.filter((d) => d > 0);
    return {
      z: z[p.cell],
      slope: grid.slopePercent[p.cell],
      aspect: grid.aspectDeg[p.cell],
      forest: forest[p.cell],
      curvature: curvature[p.cell],
      meanMax: mean(maxes),
      cover: meanCover[p.cell],
      deep: meanDeep[p.cell],
      meltOut: meltDays.length ? mean(meltDays) : Number.NaN,
      march: mean(all.map((r) => mean(r.pointDepthCm[i].slice(daysBetween(seasonStart, { year: firstYear + 1, month: 3, day: 1 }), daysBetween(seasonStart, { year: firstYear + 1, month: 4, day: 1 }))))),
    };
  });
  const aspectName = (a: number) => (Number.isNaN(a) ? '–' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8]);
  const pS = points.findIndex((p) => p.id === 'southSlope');
  const pN = points.findIndex((p) => p.id === 'northForest');
  const nsRatio = pS >= 0 && pN >= 0 ? pointStats[pN].cover / Math.max(1, pointStats[pS].cover) : Number.NaN;

  // Wykres przykładowej zimy – wszystkie punkty.
  const chartStart = addDays(seasonStart, statsFrom);
  const chartDays = days - statsFrom;
  const examplePointsChart = timeChart(
    chartStart,
    chartDays,
    points.map((p, i) => ({ name: p.name, color: p.color, values: Array.from(example.pointDepthCm[i].slice(statsFrom)) })),
    'grubość śniegu [cm] – koniec dnia',
    { hLines: [{ v: g.deepCoverThresholdCm.value, label: `${g.deepCoverThresholdCm.value} cm` }] },
  );
  // Małe wykresy: przykładowa zima na tle 30 zim (mediana i 10–90 %).
  const pointCards = points
    .map((p, i) => {
      const med: number[] = [];
      const lo: number[] = [];
      const hi: number[] = [];
      for (let d = statsFrom; d < days; d++) {
        const vals = all.map((r) => r.pointDepthCm[i][d]).sort((a, b) => a - b);
        med.push(quantile(vals, 0.5));
        lo.push(quantile(vals, 0.1));
        hi.push(quantile(vals, 0.9));
      }
      const s = pointStats[i];
      const chart = timeChart(
        chartStart,
        chartDays,
        [
          { name: `mediana ${winters} zim`, color: 'var(--muted)', values: med, band: { lo, hi }, dashed: true, width: 1.4 },
          { name: 'zima 2026/27', color: p.color, values: Array.from(example.pointDepthCm[i].slice(statsFrom)) },
        ],
        'cm',
        { width: 480, height: 190, small: true, hLines: [{ v: g.deepCoverThresholdCm.value, label: '' }] },
      );
      return `<div class="card"><b style="color:${p.color}">${esc(p.name)}</b>
<p class="muted small">${fmt(s.z, 0)} m n.p.m. · nachylenie ${fmt(s.slope, 0)} % · ekspozycja ${aspectName(s.aspect)} · las ${fmt(100 * s.forest, 0)} % – ${esc(p.note)}</p>${chart}
<p class="small">Średnio z ${winters} zim: maksimum <b>${fmt(s.meanMax, 0)} cm</b>, dni z pokrywą (XI–IV) <b>${fmt(s.cover, 0)}</b>, w tym ≥ ${g.deepCoverThresholdCm.value} cm: <b>${fmt(s.deep, 0)}</b>; zanik ${Number.isNaN(s.meltOut) ? '–' : `ok. <b>${dateLabel(dayToDate(s.meltOut))}</b>`}.</p></div>`;
    })
    .join('');

  // Mapy grubości.
  const mapCards = mapDates
    .map((d, i) => {
      const m = example.maps[i];
      let sum = 0;
      let cnt = 0;
      let covered = 0;
      for (let k = 0; k < n; k++) {
        if (Number.isNaN(m[k])) continue;
        sum += m[k];
        cnt++;
        if (m[k] >= g.deepCoverThresholdCm.value) covered++;
      }
      return `<div class="card"><b>${d.day} ${MONTH_GENITIVE[d.month - 1]}</b> <span class="muted">${d.year}</span><img src="${png(m, maxDepthScaleCm, sp.coverDepthM * 100)}" alt="Grubość śniegu ${dateLabel(d)}">
<p class="small">średnio ${fmt(sum / cnt, 0)} cm; ≥ ${g.deepCoverThresholdCm.value} cm na ${fmt((100 * covered) / cnt, 0)} % mapy</p></div>`;
    })
    .join('');

  // Kalibracja – małe wykresy dla każdej zimy.
  const stationNames = [...new Set(cal.winters.map((w) => w.station))];
  const calCharts = stationNames
    .map((name) => {
      const ws = cal.winters.filter((w) => w.station === name);
      const ps = cal.perStation.find((s) => s.station === name)!;
      const pb = calBefore.perStation.find((s) => s.station === name)!;
      const stn = stations.find((s) => s.name === name)!;
      const cards = ws
        .map((w: WinterComparison) => {
          const from = w.dates.findIndex((d) => d.month === 11 && d.day === 1);
          const to = w.dates.findIndex((d) => d.month === 5 && d.day === 1);
          const a = Math.max(0, from);
          const b = to > 0 ? to : w.dates.length;
          const chart = timeChart(
            w.dates[a],
            b - a,
            [
              { name: 'pomiar IMGW', color: 'var(--obs)', values: w.observedCm.slice(a, b), dots: true },
              { name: 'model', color: 'var(--c1)', values: w.modelCm.slice(a, b) },
            ],
            'cm',
            { width: 340, height: 150, small: true },
          );
          return `<div class="mini"><div class="mini-head"><b>${w.start.year}/${String(w.start.year + 1).slice(-2)}</b><span>błąd ${fmt(w.maeCm)} cm · dni ${w.observedCoverDays}→${w.modelCoverDays}</span></div>${chart}</div>`;
        })
        .join('');
      return `<h3>${esc(name)} <span class="muted">${fmt(stn.elevationM, 0)} m n.p.m. · ${ws.length} zim</span></h3>
<p>Średni błąd <b>${fmt(ps.maeCm)} cm</b> (przed kalibracją ${fmt(pb.maeCm)} cm), zawyżenie ${signed(ps.biasCm)} cm (przed: ${signed(pb.biasCm)} cm), długość zalegania ${signed(ps.coverDaysBias)} dnia (przed: ${signed(pb.coverDaysBias)}).</p>
<div class="minis">${cards}</div>`;
    })
    .join('');
  const calMetricsRow = (label: string, c: CalibrationSummary) => `<tr><td>${label}</td><td>${fmt(c.maeCm)} cm</td><td>${signed(c.biasCm)} cm</td><td>${signed(c.coverDaysBias)}</td><td>${fmt(c.coverDaysMae)}</td></tr>`;
  const currentValue = (o: { file: string; param: string }) => (o.file === 'snow' ? (sp as unknown as Record<string, number>)[o.param] : (rp as unknown as Record<string, number>)[o.param]);
  const calParamRows = R.calibration.before
    .map((o) => `<tr><td>${esc(o.label)}</td><td>${fmt(o.value, o.value < 0.1 ? 4 : o.value < 10 ? 1 : 0)} <small>${esc(o.source)}</small></td><td><b>${fmt(currentValue(o), currentValue(o) < 0.1 ? 4 : currentValue(o) < 10 ? 1 : 0)}</b></td><td>${esc(o.unit)}</td></tr>`)
    .join('');

  // Promieniowanie.
  const radRows = rad
    .map((s, i) => `<tr><td>${esc(s.name)} <small>${fmt(s.elevationM, 0)} m</small></td><td>${fmt(s.winterMeasuredKwhM2, 2)}</td><td>${signed(radBefore[i].winterBiasPercent, 0)} %</td><td><b>${signed(s.winterBiasPercent, 0)} %</b></td><td>${fmt(s.winterRmseKwhM2, 2)}</td><td>${signed(s.clearBiasPercent, 0)} %</td><td>${signed(s.overcastBiasPercent, 0)} %</td></tr>`)
    .join('');

  // Pasy wysokości.
  const bandTable = bandRows
    .map((b) => {
      const meltOpen = avg(b.open, meanLast);
      const meltForest = avg(b.forest, meanLast);
      return `<tr><td>${b.z0}–${b.z0 + 100}</td><td>${fmt(avg(b.open, meanMax), 0)}</td><td>${fmt(avg(b.forest, meanMax), 0)}</td><td>${fmt(avg(b.open, meanCoverAll), 0)}</td><td>${fmt(avg(b.forest, meanCoverAll), 0)}</td><td>${Number.isNaN(meltOpen) ? '–' : dateLabel(dayToDate(meltOpen))}</td><td>${Number.isNaN(meltForest) ? '–' : dateLabel(dayToDate(meltForest))}</td><td>${fmt(avg([...b.open, ...b.forest], meanDeep), 0)}</td></tr>`;
    })
    .join('');
  const bandChart = (() => {
    const W = 520;
    const H = 260;
    const pad = { l: 48, r: 12, t: 18, b: 30 };
    const zs = bandRows.map((b) => b.z0 + 50);
    const zLo = Math.min(...zs) - 50;
    const zHi = Math.max(...zs) + 50;
    const vals = bandRows.flatMap((b) => [avg(b.open, meanMax), avg(b.forest, meanMax)]).filter((x) => !Number.isNaN(x));
    const xMax = Math.ceil(Math.max(...vals, ...LAJ.sites.map((s) => s.maxDepth1993Cm ?? 0)) / 20) * 20;
    const x = (v: number) => pad.l + ((W - pad.l - pad.r) * v) / xMax;
    const y = (zz: number) => pad.t + (H - pad.t - pad.b) * (1 - (zz - zLo) / (zHi - zLo));
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
    for (let zz = Math.ceil(zLo / 200) * 200; zz <= zHi; zz += 200) svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(zz)}" y2="${y(zz)}" class="grid"/><text x="${pad.l - 5}" y="${y(zz) + 4}" class="tick" text-anchor="end">${zz}</text>`;
    for (let vv = 0; vv <= xMax; vv += 20) svg += `<text x="${x(vv)}" y="${H - 10}" class="tick" text-anchor="middle">${vv}</text>`;
    const line = (fn: (b: Band) => number, color: string) => {
      const pts = bandRows.map((b) => [fn(b), b.z0 + 50]).filter(([v2]) => !Number.isNaN(v2));
      return `<polyline points="${pts.map(([v2, zz]) => `${x(v2)},${y(zz)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>${pts.map(([v2, zz]) => `<circle cx="${x(v2)}" cy="${y(zz)}" r="3.5" fill="${color}"/>`).join('')}`;
    };
    svg += line((b) => avg(b.open, meanMax), 'var(--c1)');
    svg += line((b) => avg(b.forest, meanMax), 'var(--forest)');
    const miz = LAJ.sites.find((s) => s.maxDepthNormalCm);
    if (miz) {
      const yy = y(miz.elevationM);
      svg += `<line x1="${x(miz.maxDepth1994Cm!)}" x2="${x(miz.maxDepth1993Cm!)}" y1="${yy}" y2="${yy}" stroke="var(--c2)" stroke-width="2"/><rect x="${x(miz.maxDepthNormalCm!) - 5}" y="${yy - 5}" width="10" height="10" fill="var(--c2)"/>`;
    }
    svg += `<text x="${pad.l}" y="${pad.t - 5}" class="unit">wysokość [m n.p.m.] / średnie maksimum grubości w sezonie [cm]</text></svg>`;
    return legend([
      { name: 'teren otwarty', color: 'var(--c1)' },
      { name: 'las', color: 'var(--forest)' },
      { name: 'Hala Miziowa: norma 80 cm (■), sezony 1993 i 1994 (kreska 70–100 cm)', color: 'var(--c2)' },
    ]) + svg;
  })();
  const lajRows = LAJ.sites
    .map((s) => {
      const cells: number[] = [];
      for (let k = 0; k < n; k++) if (z[k] === z[k] && Math.abs(z[k] - s.elevationM) <= 50 && forest[k] < 0.2) cells.push(k);
      const melt = avg(cells, meanLast);
      const cov = avg(cells, meanCoverAll);
      const parse = (t: string) => {
        const [m, d] = t.split('-').map(Number);
        return { month: m, day: d };
      };
      const mo = parse(s.meltOut1994);
      const mn = parse(s.meltOutNormal);
      return `<tr><td>${esc(s.name)} <small>${s.elevationM} m</small></td><td>${mo.day} ${MONTH_SHORT[mo.month - 1]}</td><td>${mn.day} ${MONTH_SHORT[mn.month - 1]}</td><td><b>${Number.isNaN(melt) ? '–' : dateLabel(dayToDate(melt))}</b></td><td>${s.coverDays1994}</td><td>${s.coverDaysNormal}</td><td><b>${fmt(cov, 0)}</b></td><td><small>${cells.length} kom.</small></td></tr>`;
    })
    .join('');
  const mizIdx = points.findIndex((p) => p.id === 'miziowa');

  const totalS = (performance.now() - tStart) / 1000;
  const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raport zimy – Pilsko</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d2329;--muted:#5d6670;--grid:#e3e1db;--card:#ffffff;--c1:#1f6fd1;--c2:#d1495b;--obs:#3a3f45;--forest:#3f7a3a;--ok:#1e7d3c;--bad:#b3261e}
@media (prefers-color-scheme: dark){:root{--bg:#16191d;--fg:#e9ecef;--muted:#a3abb4;--grid:#2c3238;--card:#1e2227;--c1:#5aa0ff;--c2:#ff7a8a;--obs:#d5d9de;--forest:#7cc07a;--ok:#5cc87a;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 60px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 8px}h3{font-size:16px;margin:22px 0 4px}p{margin:6px 0}.muted{color:var(--muted)}.small{font-size:13px}
.verdict{border-radius:10px;padding:16px 20px;margin:16px 0;color:#fff;background:${verdictOk ? 'var(--ok)' : 'var(--bad)'}}
.verdict b.big{font-size:22px;display:block}.verdict ul{margin:6px 0 0 18px;padding:0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:12px 0}
.kpi{background:var(--card);border:1px solid var(--grid);border-radius:10px;padding:10px 12px}.kpi b{font-size:22px;display:block}.kpi span{font-size:12px;color:var(--muted)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--grid);border-radius:10px;padding:12px 14px}
.chart{width:100%;height:auto;display:block}.chart .grid{stroke:var(--grid)}.chart .hline{stroke:var(--muted);stroke-dasharray:2 3}
.chart .tick,.chart .unit{fill:var(--muted);font-size:13px}.chart.small .tick,.chart.small .unit{font-size:12px}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted);margin-bottom:4px}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-2px}
.minis{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}.mini{background:var(--card);border:1px solid var(--grid);border-radius:8px;padding:6px 8px}
.mini-head{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}.mini-head b{color:var(--fg)}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}th,td{padding:5px 8px;border-bottom:1px solid var(--grid);text-align:right;vertical-align:top}th:first-child,td:first-child{text-align:left}
th{font-weight:600;color:var(--muted)}small{color:var(--muted)}
.maps{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.maps img,.bigmap img{width:100%;border-radius:6px;border:1px solid var(--grid);display:block;margin-top:4px}
.bigmap{max-width:560px}
.scalebox{max-width:520px;margin-top:8px}.scale{height:12px;border-radius:3px}.scale-labels{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}
.table-wrap{overflow-x:auto}
ul.plain{margin:6px 0 6px 18px;padding:0}
</style></head><body><main>
<h1>Raport zimy – Pilsko</h1>
<p class="muted">Wygenerowano ${new Date().toISOString().slice(0, 10)} · seed ${seed} · model śniegu naturalnego (bez narciarzy, naśnieżania i ratraków) · ${winters} zim gry od ${firstYear}/${String(firstYear + 1).slice(-2)}</p>

<div class="verdict"><b class="big">${verdictOk ? 'ZGODNE Z POMIARAMI' : 'NIEZGODNE Z POMIARAMI'}</b>
Model policzony na rzeczywistej pogodzie ${cal.winters.length} zim (${stationNames.join(', ')}; 2009/10–2018/19) i porównany z grubością śniegu mierzoną codziennie przez IMGW:
<ul>${checks.map((c) => `<li>${c.ok ? '✓' : '✗'} ${c.text}</li>`).join('')}</ul></div>
<div class="kpis">
<div class="kpi"><b>${fmt(cal.maeCm)} cm</b><span>średni błąd grubości (przed kalibracją ${fmt(calBefore.maeCm)} cm)</span></div>
<div class="kpi"><b>${signed(cal.biasCm)} cm</b><span>średnio za dużo (+) / za mało (−) śniegu (przed: ${signed(calBefore.biasCm)} cm)</span></div>
<div class="kpi"><b>${signed(cal.coverDaysBias)} dnia</b><span>różnica długości zalegania na sezon (przed: ${signed(calBefore.coverDaysBias)}); średnio co do wartości ${fmt(cal.coverDaysMae)} dnia</span></div>
<div class="kpi"><b>${signed(nsCompare[0].ratio * 100 - 100, 0)} %</b><span>o tyle dłużej leży śnieg na stokach N niż S w terenie otwartym (800–1400 m, XI–IV); w lesie ${signed(nsCompare[1].ratio * 100 - 100, 0)} %</span></div>
</div>

<h2>1. Kalibracja: model a pomiar na stacjach IMGW</h2>
<p>Model liczony jest w punkcie stacji (teren płaski, otwarty, bez przewiewania) na pogodzie zmierzonej tego dnia: temperatura średnia, maksymalna i minimalna, opad, zachmurzenie, wiatr, wilgotność. Pomiar grubości (godz. 7) porównywany jest ze stanem modelu na koniec poprzedniego dnia. Okres oceny: 1 XI – 30 IV.</p>
<div class="grid2">
<div class="card table-wrap"><b>Wynik</b><table><thead><tr><th></th><th>średni błąd</th><th>zawyżenie</th><th>dni zalegania</th><th>|dni|</th></tr></thead><tbody>
${calMetricsRow('przed kalibracją', calBefore)}${calMetricsRow('<b>po kalibracji</b>', cal)}</tbody></table>
<p class="small muted">„dni zalegania” – średnia różnica liczby dni z pokrywą ≥ 1 cm w sezonie (model − pomiar); „|dni|” – ta sama różnica bez znaku.</p></div>
<div class="card table-wrap"><b>Co zmieniono (4 parametry)</b><table><thead><tr><th>parametr</th><th>przed</th><th>po</th><th></th></tr></thead><tbody>${calParamRows}</tbody></table>
<p class="small muted">Pozostałe parametry – z literatury, bez zmian (źródła w data/snow.json).</p></div>
</div>
${calCharts}
<p class="muted small">Czarne kropki – pomiar IMGW, niebieska linia – model. Temperatura dla Korbielowa (posterunek opadowy) przeniesiona z Zawoi i Lalik z poprawką na wysokość.</p>

<h3>Cały łańcuch: generator pogody + model śniegu</h3>
<p>To samo miejsce (teren płaski przy stacji), ale pogoda nie z pomiarów, tylko z generatora gry (${chainWinters} zim). Sprawdza, czy wygenerowane zimy dają tyle śniegu, ile było naprawdę. Informacyjnie – nie wchodzi do werdyktu: pomiary obejmują tylko ${Math.max(...chain.map((c) => c.winters))} zim 2009–2019, a generator odtwarza klimat 2001–2025.</p>
<div class="card table-wrap"><table><thead><tr><th>stacja</th><th>dni z pokrywą XI–IV: pomiar</th><th>generator + model</th><th>różnica</th><th>maks. grubość: pomiar</th><th>generator + model</th></tr></thead><tbody>
${chain.map((c) => `<tr><td>${esc(c.name)} <small>${fmt(c.elevationM, 0)} m</small></td><td>${fmt(c.obsCover, 0)} <small>± ${fmt(c.obsCoverSd, 0)} z roku na rok</small></td><td>${fmt(c.genCover, 0)}</td><td><b>${signed(c.genCover - c.obsCover, 0)} dni</b></td><td>${fmt(c.obsMax, 0)} cm</td><td>${fmt(c.genMax, 0)} cm</td></tr>`).join('')}
</tbody></table>
<p class="small muted">Średni błąd średniej z ok. 10 zim to ok. ± ${fmt(mean(chain.map((c) => c.obsCoverSd / Math.sqrt(Math.max(1, c.winters)))), 0)} dni – różnica większa od tego znaczy, że wygenerowane zimy w dolnych partiach są nieco bardziej śnieżne niż zimy 2009–2019.</p></div>

<h2>2. Promieniowanie słoneczne a pomiar</h2>
<p>Suma dobowa promieniowania całkowitego na powierzchnię poziomą: model (z zachmurzeniem obserwowanym tego dnia) wobec pomiarów aktynometrycznych IMGW 2007–2014, miesiące XI–IV.</p>
<div class="card table-wrap"><table><thead><tr><th>stacja</th><th>pomiar, średnio [kWh/m²/doba]</th><th>błąd przed kalibracją</th><th>błąd po</th><th>błąd dzienny (RMSE) [kWh/m²]</th><th>dni bezchmurne</th><th>dni pochmurne</th></tr></thead><tbody>${radRows}</tbody></table>
<p class="small muted">Kalibrowany jeden parametr: wykładnik wpływu chmur (tabela wyżej). W Bielsku model zawyża także przy bezchmurnym niebie – zapylenie powietrza w mieście, którego model nie zna; na Kasprowym (warunki podobne do Pilska) zgodność jest dobra.</p></div>

<h2>3. Punkty kontrolne – zima 2026/27 dzień po dniu</h2>
<p>Pierwszy sezon gry – ta sama zima, którą widać w przeglądarce (nakładka 7). Model na całej mapie: promieniowanie z cieniami terenu, las, przewiewanie śniegu przez wiatr.</p>
<div class="card">${legend(points.map((p) => ({ name: p.name, color: p.color })))}${examplePointsChart}</div>
<h3>Każdy punkt na tle ${winters} zim</h3>
<p class="muted small">Kolor – zima 2026/27; szara przerywana linia – mediana z ${winters} wygenerowanych zim; szare pasmo – 8 zim na 10 mieści się w nim (10–90 %).</p>
<div class="grid2">${pointCards}</div>
<div class="card table-wrap" style="margin-top:16px"><b>Stoki północne a południowe</b> <span class="muted">– średnio z ${winters} zim, nachylenie ≥ 15 %, porównanie w tych samych pasach wysokości 800–1400 m</span>
<table><thead><tr><th></th><th>komórek N / S</th><th>dni z pokrywą XI–IV: N − S</th><th>N dłużej o</th><th>zanik: N później o</th></tr></thead><tbody>
${nsCompare.map((c) => `<tr><td>${c.inForest ? 'las (≥ 80 %)' : 'teren otwarty'}</td><td>${c.north} / ${c.south}</td><td>${signed(c.dCover, 0)} dni</td><td><b>${signed(c.ratio * 100 - 100, 0)} %</b></td><td>${signed(c.dMelt, 0)} dni</td></tr>`).join('')}
<tr><td>punkty kontrolne: ${esc(points[pN]?.name ?? '')} / ${esc(points[pS]?.name ?? '')}</td><td>1 / 1</td><td>${signed((pointStats[pN]?.cover ?? 0) - (pointStats[pS]?.cover ?? 0), 0)} dni</td><td><b>${signed(nsRatio * 100 - 100, 0)} %</b></td><td>${signed((pointStats[pN]?.meltOut ?? 0) - (pointStats[pS]?.meltOut ?? 0), 0)} dni</td></tr>
</tbody></table>
<p class="small muted">W lesie różnica jest mniejsza: korony przepuszczają tylko ok. ${fmt(100 * sp.canopyShortwaveTransmission, 0)} % promieniowania słonecznego, więc ekspozycja stoku mniej się liczy. W środku zimy oba stoki są zwykle pod śniegiem – różnice robią się przy odwilżach i wiosną.</p></div>

<h2>4. Mapy grubości śniegu – zima 2026/27</h2>
<div class="maps">${mapCards}</div>
${scaleBar(maxDepthScaleCm, 'cm')}
<p class="muted small">Stan o północy. Północ u góry, mapa 4 × 4,5 km, szare – Słowacja (poza mapą). Bez śniegu: beż – teren otwarty, zieleń – las.</p>

<h2>5. Dni z pokrywą ≥ ${g.deepCoverThresholdCm.value} cm – średnio z ${winters} zim</h2>
<div class="grid2"><div class="bigmap"><img src="${png(meanDeep, deepMax, 0.5)}" alt="Liczba dni z pokrywą co najmniej ${g.deepCoverThresholdCm.value} cm">${scaleBar(deepMax, 'dni')}</div>
<div><p>Okres 1 XI – 30 IV (${statsTo - statsFrom} dni). Tyle dni w przeciętnym sezonie dałoby się jeździć po samym naturalnym śniegu (bez naśnieżania i ubijania).</p>
<p>Średnio na całej mapie: <b>${fmt(mean(Array.from(meanDeep).filter((x) => !Number.isNaN(x))), 0)} dni</b>; Hala Miziowa: <b>${fmt(pointStats[mizIdx]?.deep ?? 0, 0)}</b>; dolne partie przy Korbielowie: <b>${fmt(pointStats[points.findIndex((p) => p.id === 'korbielow')]?.deep ?? 0, 0)}</b>.</p>
<p class="muted small">Widać: wzrost z wysokością, stoki północne i zagłębienia (nawiewanie) z dłuższym sezonem, grzbiety i wypukłości (wywiewanie) z krótszym, las – mniej śniegu niż polany na tej samej wysokości (korony drzew zatrzymują część opadu).</p></div></div>

<h2>6. Rozkład z wysokością – porównanie z pracą Łajczaka (1996)</h2>
<p>Łajczak mierzył pokrywę na północnym stoku Pilska w sezonie 1993/94 (640–1557 m). Ten sezon był wg autora cieplejszy i uboższy w śnieg od średniej z wielolecia; nasz model ma klimat z lat 2001–2025, też cieplejszy od dawnych norm. Porównanie jest więc jakościowe.</p>
<div class="grid2">
<div class="card">${bandChart}</div>
<div class="card table-wrap"><b>Średnio z ${winters} zim, pasy wysokości</b><table><thead><tr><th>m n.p.m.</th><th>maks. otw. [cm]</th><th>maks. las [cm]</th><th>dni otw.</th><th>dni las</th><th>zanik otw.</th><th>zanik las</th><th>dni ≥ ${g.deepCoverThresholdCm.value} cm</th></tr></thead><tbody>${bandTable}</tbody></table>
<p class="small muted">„dni” – z pokrywą ≥ 1 cm w całym sezonie (do końca czerwca); otw. – teren otwarty (las &lt; 20 %), las – las ≥ 80 %.</p></div>
</div>
<div class="card table-wrap" style="margin-top:16px"><b>Zanik pokrywy i liczba dni z pokrywą</b><table><thead><tr><th>miejsce</th><th>zanik 1994</th><th>zanik – norma</th><th>zanik – model</th><th>dni 1993/94</th><th>dni – norma</th><th>dni – model</th><th></th></tr></thead><tbody>${lajRows}</tbody></table>
<p class="small muted">Model: średnia z ${winters} zim dla terenu otwartego w paśmie ±50 m od wysokości miejsca. Normy wg Łajczaka (Hess 1967; Leśniak 1980, 1983).</p></div>
<div class="card" style="margin-top:16px"><b>Cechy rozkładu opisane przez Łajczaka – i co pokazuje model</b>
<ul class="plain">
<li>${esc(LAJ.qualitative[0])} <br><span class="muted">Model: maksimum w terenie otwartym rośnie z wysokością ${bandRows.length ? `od ${fmt(avg(bandRows[0].open, meanMax), 0)} cm (${bandRows[0].z0}–${bandRows[0].z0 + 100} m) do ${fmt(Math.max(...bandRows.map((b) => avg(b.open, meanMax)).filter((x) => !Number.isNaN(x))), 0)} cm` : ''}.</span></li>
<li>${esc(LAJ.qualitative[1])} <br><span class="muted">Model (teren otwarty powyżej 1100 m): formy wklęsłe średnio ${fmt(avg(concave, meanMax), 0)} cm, wypukłe ${fmt(avg(convex, meanMax), 0)} cm – stosunek ${fmt(avg(concave, meanMax) / avg(convex, meanMax), 2)}.</span></li>
<li>${esc(LAJ.qualitative[2])} <br><span class="muted">Model (mediana ${winters} zim): maksimum w Korbielowie ok. ${dateLabel(dayToDate(statsFrom + argmaxMedian(all, points.findIndex((p) => p.id === 'korbielow'), statsFrom, days)))}, na Hali Miziowej ok. ${dateLabel(dayToDate(statsFrom + argmaxMedian(all, mizIdx, statsFrom, days)))}.</span></li>
<li>${esc(LAJ.qualitative[3])}</li>
</ul>
${avg(concave, meanMax) / avg(convex, meanMax) < 1.2 ? `<p class="small"><b>Słaby punkt modelu:</b> przewiewanie zabiera śnieg z otwartych, wysoko położonych miejsc, ale odkłada go głównie na skraju lasu, a nie w zagłębieniach terenu – kontrastu „wklęsłe dwa razy więcej niż wypukłe” model nie odtwarza. Parametry przewiewania są z literatury, bez kalibracji (brak pomiarów rozkładu śniegu na stoku).</p>` : ''}
<p class="small">Hala Miziowa w modelu: średnia grubość w marcu <b>${fmt(pointStats[mizIdx]?.march ?? 0, 0)} cm</b>, średnie maksimum <b>${fmt(pointStats[mizIdx]?.meanMax ?? 0, 0)} cm</b> (norma z wielolecia ok. 80 cm, 1993: ok. 100 cm, 1994: ok. 70 cm).</p></div>

<h2>7. Kontrola obliczeń</h2>
<div class="grid2">
<div class="card"><b>Bilans wody – zima 2026/27, średnio na mapie</b><table><tbody>
<tr><td>opad (śnieg i deszcz) od 1 X do ${dateLabel(addDays(runEnd, -1))}</td><td>${fmt(perCell(bal.precipitationMm), 0)} mm</td></tr>
<tr><td>zostało w pokrywie</td><td>${fmt(perCell(example.storageMm), 1)} mm</td></tr><tr><td>odpłynęło (topnienie i deszcz)</td><td>${fmt(perCell(bal.runoffMm), 0)} mm</td></tr>
<tr><td>sublimacja (parowanie lodu, też śnieg zatrzymany w koronach drzew)</td><td>${fmt(perCell(bal.sublimationMm), 1)} mm</td></tr><tr><td>wywiane poza mapę i wysublimowane w zamieci</td><td>${fmt(perCell(bal.windOutMm), 1)} mm</td></tr>
<tr><td><b>niezgodność bilansu</b></td><td><b>${fmt(balanceErrorPercent, 4)} %</b></td></tr></tbody></table></div>
<div class="card"><b>Czas obliczeń</b><table><tbody>
<tr><td>mapa</td><td>${grid.widthCells} × ${grid.heightCells} komórek po ${grid.cellSizeM} m, ${SNOW_QUALITY_CODES.length - 1} stanów śniegu</td></tr>
<tr><td>jeden sezon (${days} dni, 1 wątek)</td><td><b>${fmt(seasonMsMean / 1000, 1)} s</b> – ${fmt(seasonMsMean / days, 0)} ms na dzień</td></tr>
<tr><td>promieniowanie bezchmurne na sezon</td><td>${fmt(solarMs / 1000, 1)} s</td></tr>
<tr><td>${winters} sezonów w ${threads} wątkach</td><td>${fmt(wintersMs / 1000, 0)} s</td></tr>
<tr><td>kalibracja (${cal.winters.length} zim w punktach stacji)</td><td>${fmt(calMs / 1000, 1)} s</td></tr>
<tr><td>cały raport</td><td>${fmt(totalS, 0)} s</td></tr></tbody></table>
<p class="small muted">W grze: przy prędkości ×20 jeden dzień gry trwa ok. 30 s, a model śniegu potrzebuje na dzień ułamka sekundy.</p></div>
</div>
<p class="muted small">Stany śniegu w grze: ${SNOW_QUALITY_CODES.slice(1).map((c) => SNOW_QUALITY_NAMES[c]).join(', ')}.</p>

<h2>Skąd dane</h2>
<p class="muted small">Grubość śniegu i pogoda: IMGW-PIB, danepubliczne.imgw.pl (dane dobowe klimatologiczne, opadowe i synoptyczne 2009–2019). Promieniowanie: IMGW-PIB, dane aktynometryczne 2007–2014. Pokrycie terenu: ESA WorldCover 2021 (CC BY 4.0). Teren: NMT GUGiK; okolica: Copernicus DEM GLO-30. Łajczak A. (1996), praca o pogodzie i pokrywie śnieżnej północnego stoku Pilska, rcin.org.pl.</p>
</main></body></html>`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  log(`Zapisano ${OUT} (${(html.length / 1e6).toFixed(1)} MB) w ${totalS.toFixed(0)} s. Werdykt: ${verdictOk ? 'ZGODNE' : 'NIEZGODNE'} – błąd ${cal.maeCm.toFixed(1)} cm, zaleganie ${cal.coverDaysBias.toFixed(1)} dnia.`);
}

/** Dzień (licząc od `from`) z największą medianą grubości w danym punkcie. */
function argmaxMedian(all: SeasonRunOutput[], point: number, from: number, to: number): number {
  if (point < 0) return 0;
  let best = 0;
  let bestV = -1;
  for (let d = from; d < to; d++) {
    const vals = all.map((r) => r.pointDepthCm[point][d]).sort((a, b) => a - b);
    const m = quantile(vals, 0.5);
    if (m > bestV) {
      bestV = m;
      best = d - from;
    }
  }
  return best;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
