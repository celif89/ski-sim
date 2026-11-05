/**
 * Raport „przewiń zimy” – npm run climate-report.
 *
 * Generuje 30 zim generatorem pogody i porównuje je z danymi IMGW (profil klimatyczny), rysuje
 * przykładową zimę dzień po dniu oraz mapy sum promieniowania dla 21 grudnia i 21 marca.
 * Wynik: reports/raport-klimatu.html (jeden plik, bez zewnętrznych zależności).
 * Opcjonalnie: ścieżka wyjściowa jako argument (np. dist/raport-klimatu.html przy publikacji).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import climateJson from '../../data/climate/pilsko.json';
import radiationJson from '../../data/radiation.json';
import settingsJson from '../../data/settings.json';
import wxJson from '../../data/weather-generator.json';
import { parseClimateProfile } from '../sim/climate';
import { parseValidationSettings, validateWinters } from '../sim/climateValidation';
import { puwg92ToLatLon } from '../sim/geo';
import { computeHorizon, parseHorizonParams } from '../sim/horizon';
import { dailyRadiationSum, parseRadiationParams, prepareSolarTerrain } from '../sim/radiation';
import { parseSimSettings } from '../sim/settings';
import { computeHillshade } from '../sim/terrainAnalysis';
import { dailyAtElevation, parseWeatherParams } from '../sim/weather';
import type { DailyWeather } from '../sim/weather';
import { RADIATION_SUM_STOPS, sampleColorStops } from '../render/colors';
import { loadMapFromDisk } from './loadMapFromDisk';

const OUT = process.argv[2] ?? 'reports/raport-klimatu.html';
const MONTH_NAMES = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTH_SHORT = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const TZ = { standardOffsetHours: 1, euDaylightSaving: true };
const STATION_ROLE_NAMES: Record<string, string> = {
  reference: 'Stacje odniesienia (temperatura dobowa, zachmurzenie, wiatr)',
  humidity: 'Wilgotność',
  precipitation: 'Opad',
  homogenization: 'Wyrównanie średnich do pełnego okresu',
  windAloft: 'Wiatr na wysokości',
  temperatureRegression: 'Spadek temperatury z wysokością – stacje',
  precipitationRegression: 'Przyrost opadu z wysokością – posterunki',
};

const fmt = (x: number, digits = 1) => x.toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function log(message: string): void {
  console.log(`[climate-report] ${message}`);
}

// ------------------------------------------------------------------ PNG (bez bibliotek)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(width: number, height: number, rgba: Uint8Array): string {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ------------------------------------------------------------------ wykresy SVG

interface Series {
  name: string;
  values: number[];
  color: string;
  kind: 'bar' | 'line';
  errors?: number[];
}

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Wykres kategorii (miesięcy): słupki obok siebie i/lub linie z punktami. */
function categoryChart(categories: string[], series: Series[], unit: string, opts: { width?: number; height?: number; zeroBased?: boolean } = {}): string {
  const W = opts.width ?? 420;
  const H = opts.height ?? 250;
  const pad = { l: 50, r: 12, t: 20, b: 30 };
  const all = series.flatMap((s) => s.values.map((v, i) => [v - (s.errors?.[i] ?? 0), v + (s.errors?.[i] ?? 0)]).flat());
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (opts.zeroBased) lo = Math.min(0, lo);
  const step = niceStep(hi - lo || 1, 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const y = (v: number) => pad.t + ph * (1 - (v - lo) / (hi - lo));
  const cw = pw / categories.length;
  const bars = series.filter((s) => s.kind === 'bar');
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    svg += `<text x="${pad.l - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${fmt(v, step < 1 ? 1 : 0)}</text>`;
  }
  if (lo < 0 && hi > 0) svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
  categories.forEach((c, i) => {
    svg += `<text x="${pad.l + cw * (i + 0.5)}" y="${H - 8}" class="tick" text-anchor="middle">${c}</text>`;
  });
  const bw = (cw * 0.7) / Math.max(1, bars.length);
  bars.forEach((s, si) => {
    s.values.forEach((v, i) => {
      const x = pad.l + cw * i + cw * 0.15 + bw * si;
      const y0 = y(Math.max(lo, Math.min(0, hi)));
      const yv = y(v);
      svg += `<rect x="${x}" y="${Math.min(y0, yv)}" width="${bw - 2}" height="${Math.abs(y0 - yv)}" rx="2" fill="${s.color}"><title>${s.name}: ${fmt(v)} ${unit}</title></rect>`;
      if (s.errors) {
        const cx = x + (bw - 2) / 2;
        svg += `<line x1="${cx}" x2="${cx}" y1="${y(v - s.errors[i])}" y2="${y(v + s.errors[i])}" class="err"/>`;
      }
    });
  });
  for (const s of series.filter((x) => x.kind === 'line')) {
    const pts = s.values.map((v, i) => `${pad.l + cw * (i + 0.5)},${y(v)}`);
    svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
    s.values.forEach((v, i) => {
      const cx = pad.l + cw * (i + 0.5);
      if (s.errors) svg += `<line x1="${cx}" x2="${cx}" y1="${y(v - s.errors[i])}" y2="${y(v + s.errors[i])}" stroke="${s.color}" stroke-width="1.5"/>`;
      svg += `<circle cx="${cx}" cy="${y(v)}" r="4" fill="${s.color}" stroke="var(--bg)" stroke-width="2"><title>${s.name}: ${fmt(v)} ${unit}</title></circle>`;
    });
  }
  svg += `<text x="${pad.l}" y="${pad.t - 2}" class="unit">${unit}</text></svg>`;
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
  return `<div class="legend">${legend}</div>${svg}`;
}

/** Przykładowa zima dzień po dniu: temperatura na dole i na górze + opad (słupki w kolorze rodzaju). */
function seasonChart(days: DailyWeather[], bottom: { t: number[]; p: number[]; phase: string[] }, top: { t: number[]; p: number[]; phase: string[] }, zBottom: number, zTop: number): string {
  const W = 1040;
  const Ht = 220;
  const Hp = 120;
  const pad = { l: 46, r: 12, t: 14, b: 26 };
  const n = days.length;
  const pw = W - pad.l - pad.r;
  const x = (i: number) => pad.l + (pw * (i + 0.5)) / n;
  const temps = [...bottom.t, ...top.t];
  const step = 5;
  const lo = Math.floor(Math.min(...temps) / step) * step;
  const hi = Math.ceil(Math.max(...temps) / step) * step;
  const yT = (v: number) => pad.t + (Ht - pad.t - 6) * (1 - (v - lo) / (hi - lo));
  let svg = `<svg viewBox="0 0 ${W} ${Ht + Hp}" class="chart wide" role="img">`;
  for (let v = lo; v <= hi; v += step) {
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yT(v)}" y2="${yT(v)}" class="${v === 0 ? 'zero' : 'grid'}"/>`;
    svg += `<text x="${pad.l - 6}" y="${yT(v) + 4}" class="tick" text-anchor="end">${v}</text>`;
  }
  svg += `<text x="${pad.l}" y="10" class="unit">°C – średnia dobowa</text>`;
  const line = (vals: number[], color: string) => `<polyline points="${vals.map((v, i) => `${x(i)},${yT(v)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.6"/>`;
  svg += line(bottom.t, 'var(--c1)') + line(top.t, 'var(--c2)');
  // Opad.
  const pMax = Math.max(10, ...top.p);
  const y0 = Ht + Hp - pad.b;
  const yP = (v: number) => y0 - (Hp - pad.b - 14) * (v / pMax);
  const phaseColor: Record<string, string> = { snow: 'var(--snow)', sleet: 'var(--sleet)', rain: 'var(--rain)' };
  const bw = Math.max(1, pw / n - 1);
  days.forEach((_, i) => {
    if (top.p[i] <= 0) return;
    svg += `<rect x="${x(i) - bw / 2}" y="${yP(top.p[i])}" width="${bw}" height="${y0 - yP(top.p[i])}" fill="${phaseColor[top.phase[i]]}"><title>${days[i].date.day}.${days[i].date.month}: ${fmt(top.p[i])} mm (${zTop} m)</title></rect>`;
    // Kreska u dołu: rodzaj opadu na dole.
    svg += `<rect x="${x(i) - bw / 2}" y="${y0 + 3}" width="${bw}" height="5" fill="${phaseColor[bottom.phase[i]]}"/>`;
  });
  svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y0}" y2="${y0}" class="grid"/>`;
  svg += `<text x="${pad.l}" y="${Ht + 14}" class="unit">opad na ${zTop} m [mm/doba] (kolor = rodzaj; pasek pod osią = rodzaj opadu na ${zBottom} m)</text>`;
  // Miesiące.
  days.forEach((d, i) => {
    if (d.date.day === 1) {
      svg += `<line x1="${x(i) - pw / n / 2}" x2="${x(i) - pw / n / 2}" y1="${pad.t}" y2="${y0}" class="grid"/>`;
      svg += `<text x="${x(i) + 3}" y="${Ht + Hp - 6}" class="tick">${MONTH_NAMES[d.date.month - 1]}</text>`;
    }
  });
  svg += '</svg>';
  const legend = [
    `<span><i style="background:var(--c1)"></i>temperatura na ${zBottom} m</span>`,
    `<span><i style="background:var(--c2)"></i>temperatura na ${zTop} m</span>`,
    `<span><i style="background:var(--snow)"></i>śnieg</span>`,
    `<span><i style="background:var(--sleet)"></i>deszcz ze śniegiem</span>`,
    `<span><i style="background:var(--rain)"></i>deszcz</span>`,
  ].join('');
  return `<div class="legend">${legend}</div>${svg}`;
}

// ------------------------------------------------------------------ główny program

function main(): void {
  const profile = parseClimateProfile(climateJson);
  const params = parseWeatherParams(wxJson);
  const validation = parseValidationSettings(wxJson);
  const seed = parseSimSettings(settingsJson).seed;

  log(`Generuję ${validation.winters} zim…`);
  const result = validateWinters(profile, params, validation, seed, 2001);
  const { grid, dem, def } = loadMapFromDisk('pilsko');
  const { minM, maxM } = grid.elevationRangeM();
  const zBottom = Math.round(minM / 10) * 10;
  const zTop = Math.round(maxM / 10) * 10;

  // Przykładowa zima: pierwsza z serii, od listopada do kwietnia.
  const example = result.seasons[0].filter((d) => d.date.month >= 11 || d.date.month <= 4);
  const at = (z: number) => {
    const rows = example.map((d) => dailyAtElevation(d, z, profile, params));
    return { t: rows.map((r) => r.tMeanC), p: rows.map((r) => r.precipitationMm), phase: rows.map((r) => r.phase) };
  };
  const bottom = at(zBottom);
  const top = at(zTop);
  const snowDaysTop = top.phase.filter((p) => p === 'snow').length;
  const snowDaysBottom = bottom.phase.filter((p) => p === 'snow').length;
  const rainDaysBottom = bottom.phase.filter((p) => p === 'rain').length;

  // Promieniowanie.
  log('Liczę horyzont (ok. 10–20 s)…');
  const horizon = computeHorizon(grid, dem, parseHorizonParams(radiationJson));
  const st = prepareSolarTerrain(grid, horizon);
  const rp = parseRadiationParams(radiationJson);
  const centerE = def.westEastingM + grid.widthM / 2;
  const centerN = def.northNorthingM - grid.heightM / 2;
  const { latDeg, lonDeg } = puwg92ToLatLon(centerE, centerN);
  log('Liczę sumy dobowe promieniowania…');
  const dec = dailyRadiationSum(st, { year: 2026, month: 12, day: 21 }, latDeg, lonDeg, TZ, rp);
  const mar = dailyRadiationSum(st, { year: 2026, month: 3, day: 21 }, latDeg, lonDeg, TZ, rp);
  const hillshade = computeHillshade(grid, { lightAzimuthDeg: 315, lightAltitudeDeg: 45, zFactor: 1.5 });
  let marMax = 0;
  for (const v of mar) if (v > marMax) marMax = v;
  const scaleMax = Math.ceil(marMax);
  const radiationImage = (sum: Float32Array) => {
    const rgba = new Uint8Array(grid.cellCount * 4);
    const color: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < grid.cellCount; k++) {
      const v = sum[k];
      if (Number.isNaN(v)) {
        rgba.set([190, 190, 196, 255], k * 4);
        continue;
      }
      sampleColorStops(RADIATION_SUM_STOPS, v / scaleMax, color);
      const shade = 0.75 + 0.35 * (hillshade[k] / Math.SQRT1_2 - 1);
      rgba.set([Math.min(255, color[0] * shade), Math.min(255, color[1] * shade), Math.min(255, color[2] * shade), 255], k * 4);
    }
    return encodePng(grid.widthCells, grid.heightCells, rgba);
  };
  const statsFor = (sum: Float32Array) => {
    const north: number[] = [];
    const south: number[] = [];
    const all: number[] = [];
    for (let k = 0; k < grid.cellCount; k++) {
      const v = sum[k];
      if (Number.isNaN(v)) continue;
      all.push(v);
      const a = grid.aspectDeg[k];
      if (grid.slopePercent[k] < 15 || Number.isNaN(a)) continue;
      if (a <= 45 || a >= 315) north.push(v);
      else if (a >= 135 && a <= 225) south.push(v);
    }
    const mean = (x: number[]) => x.reduce((s, y) => s + y, 0) / x.length;
    let min = Infinity;
    let max = -Infinity;
    for (const v of all) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { all: mean(all), north: mean(north), south: mean(south), min, max };
  };
  const decStats = statsFor(dec);
  const marStats = statsFor(mar);
  const legendStops = Array.from({ length: 11 }, (_, i) => {
    const c: [number, number, number] = [0, 0, 0];
    sampleColorStops(RADIATION_SUM_STOPS, i / 10, c);
    return `rgb(${c.map(Math.round).join(',')}) ${i * 10}%`;
  }).join(', ');

  // Werdykt.
  const rows = result.months;
  const failures = rows.flatMap((m) =>
    (
      [
        ['temperatura', m.temperatureC],
        ['opad', m.precipitationMm],
        ['dni z opadem', m.wetDays],
      ] as const
    )
      .filter(([, c]) => !c.ok)
      .map(([name]) => `${MONTH_NAMES[m.month - 1]}: ${name}`),
  );
  const maxTempDiff = Math.max(...rows.map((m) => Math.abs(m.temperatureC.generated - m.temperatureC.observed)));
  const maxPrecipPct = Math.max(...rows.map((m) => (100 * Math.abs(m.precipitationMm.generated - m.precipitationMm.observed)) / m.precipitationMm.observed));
  const maxWetDiff = Math.max(...rows.map((m) => Math.abs(m.wetDays.generated - m.wetDays.observed)));
  const okCount = rows.length * 3 - failures.length;

  const cell = (c: { generated: number; observed: number; tolerance: number; ok: boolean }, digits: number, unit: string) =>
    `<td>${fmt(c.observed, digits)}</td><td>${fmt(c.generated, digits)}</td><td class="${c.ok ? 'ok' : 'bad'}">${c.generated - c.observed >= 0 ? '+' : '−'}${fmt(Math.abs(c.generated - c.observed), digits)} ${unit} <small>(±${fmt(c.tolerance, digits)})</small> ${c.ok ? '✓' : '✗'}</td>`;
  const table = `<table><thead><tr><th rowspan="2">miesiąc</th><th colspan="3">temperatura na ${profile.referenceElevationM} m [°C]</th><th colspan="3">suma opadu, Korbielów [mm]</th><th colspan="3">dni z opadem</th></tr>
    <tr><th>IMGW</th><th>gra</th><th>różnica</th><th>IMGW</th><th>gra</th><th>różnica</th><th>IMGW</th><th>gra</th><th>różnica</th></tr></thead><tbody>
    ${rows.map((m) => `<tr><td>${MONTH_NAMES[m.month - 1]}</td>${cell(m.temperatureC, 1, '°C')}${cell(m.precipitationMm, 0, 'mm')}${cell(m.wetDays, 1, '')}</tr>`).join('')}
    </tbody></table>`;

  const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);
  // Średnie z 30 zim dla wszystkich miesięcy sezonu generatora (październik–kwiecień).
  const seasonMonths = [10, 11, 12, 1, 2, 3, 4];
  const genMonthly = (fn: (d: DailyWeather[]) => number) =>
    seasonMonths.map((m) => {
      const vals = result.seasons.map((s) => s.filter((d) => d.date.month === m)).filter((d) => d.length > 0).map(fn);
      return vals.reduce((s, x) => s + x, 0) / vals.length;
    });
  const tGen = genMonthly((d) => d.reduce((s, x) => s + x.tMeanC, 0) / d.length);
  const pGen = genMonthly((d) => d.reduce((s, x) => s + x.precipitationMm, 0));
  const wGen = genMonthly((d) => d.filter((x) => x.wet).length);
  const sm = (arr: number[]) => seasonMonths.map((m) => arr[m - 1]);
  const errT = sm(profile.temperature.observedMonthlyMeanStdC).map((s) => (validation.toleranceSigma * s) / Math.sqrt(validation.winters));
  const cats = seasonMonths.map((m) => MONTH_SHORT[m - 1]);
  void allMonths;

  const verdictOk = result.allOk;
  const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raport klimatu – Pilsko</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d2329;--muted:#5d6670;--grid:#e3e1db;--card:#ffffff;--c1:#1f6fd1;--c2:#d1495b;--imgw:#8a94a0;--gen:#1f6fd1;--snow:#6fa8dc;--sleet:#9b7fd1;--rain:#2e8b57;--ok:#1e7d3c;--bad:#b3261e}
@media (prefers-color-scheme: dark){:root{--bg:#16191d;--fg:#e9ecef;--muted:#a3abb4;--grid:#2c3238;--card:#1e2227;--imgw:#7d8792;--gen:#5aa0ff;--c1:#5aa0ff;--c2:#ff7a8a;--ok:#5cc87a;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 60px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}p{margin:6px 0}.muted{color:var(--muted)}
.verdict{border-radius:10px;padding:16px 20px;margin:16px 0;color:#fff;background:${verdictOk ? 'var(--ok)' : 'var(--bad)'}}
.verdict b{font-size:22px;display:block}.verdict ul{margin:6px 0 0 18px;padding:0}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--grid);border-radius:10px;padding:12px 14px}
.chart{width:100%;height:auto;display:block}.chart .grid{stroke:var(--grid)}.chart .zero{stroke:var(--muted);stroke-width:1}
.chart .tick,.chart .unit{fill:var(--muted);font-size:14px}
.chart.wide .tick,.chart.wide .unit{font-size:13px}.chart .err{stroke:var(--fg);stroke-width:1.2}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted);margin-bottom:4px}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-2px}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}th,td{padding:5px 8px;border-bottom:1px solid var(--grid);text-align:right}th:first-child,td:first-child{text-align:left}
td.ok{color:var(--ok)}td.bad{color:var(--bad);font-weight:600}small{color:var(--muted)}
.maps{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}.maps img{width:100%;image-rendering:auto;border-radius:6px;border:1px solid var(--grid)}
.scale{height:12px;border-radius:3px;background:linear-gradient(90deg,${legendStops})}.scale-labels{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}
.table-wrap{overflow-x:auto}
</style></head><body><main>
<h1>Raport klimatu – Pilsko</h1>
<p class="muted">Wygenerowano ${new Date().toISOString().slice(0, 10)} · seed ${seed} · ${validation.winters} zim z generatora porównane z danymi IMGW ${esc(String((climateJson as Record<string, any>).referencePeriod.startYear.value))}–${esc(String((climateJson as Record<string, any>).referencePeriod.endYear.value))}</p>

<div class="verdict"><b>${verdictOk ? 'ZGODNE' : 'NIEZGODNE'}</b>
${okCount} z ${rows.length * 3} porównań w tolerancji (miesiące XI–IV: temperatura, suma opadu, liczba dni z opadem).
Największe różnice: temperatura ${fmt(maxTempDiff, 2)} °C, suma opadu ${fmt(maxPrecipPct, 0)} %, dni z opadem ${fmt(maxWetDiff, 1)}.
${failures.length ? `<ul>${failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div>
<p class="muted">Tolerancja: ${validation.toleranceSigma} × błąd losowy średniej z ${validation.winters} lat, liczony ze zmienności z roku na rok w danych IMGW (np. średnia temperatura stycznia waha się z roku na rok o ok. ${fmt(profile.temperature.observedMonthlyMeanStdC[0], 1)} °C, więc średnia z 30 lat ma błąd ok. ${fmt(profile.temperature.observedMonthlyMeanStdC[0] / Math.sqrt(30), 2)} °C).</p>

<h2>Średnie miesięczne: dane IMGW i ${validation.winters} wygenerowanych zim</h2>
<div class="grid2">
<div class="card"><b>Średnia temperatura</b> <span class="muted">na ${profile.referenceElevationM} m n.p.m.</span>
${categoryChart(cats, [
    { name: 'IMGW', values: sm(profile.temperature.meanC), color: 'var(--imgw)', kind: 'bar', errors: errT },
    { name: `gra (${validation.winters} zim)`, values: tGen, color: 'var(--gen)', kind: 'line' },
  ], '°C')}</div>
<div class="card"><b>Suma opadu</b> <span class="muted">Korbielów, ${profile.precipitation.referenceElevationM} m</span>
${categoryChart(cats, [
    { name: 'IMGW', values: sm(profile.precipitation.observedMonthlyTotalMm), color: 'var(--imgw)', kind: 'bar' },
    { name: `gra (${validation.winters} zim)`, values: pGen, color: 'var(--gen)', kind: 'bar' },
  ], 'mm', { zeroBased: true })}</div>
<div class="card"><b>Liczba dni z opadem</b> <span class="muted">≥ ${profile.precipitation.wetDayThresholdMm} mm</span>
${categoryChart(cats, [
    { name: 'IMGW', values: sm(profile.precipitation.observedWetDays), color: 'var(--imgw)', kind: 'bar' },
    { name: `gra (${validation.winters} zim)`, values: wGen, color: 'var(--gen)', kind: 'bar' },
  ], 'dni', { zeroBased: true })}</div>
<div class="card"><b>Spadek temperatury z wysokością</b> <span class="muted">z 24 stacji IMGW</span>
${categoryChart(MONTH_SHORT, [{ name: '°C na 100 m', values: profile.temperature.lapseRateCPer100m.map((v) => -v), color: 'var(--c2)', kind: 'line' }], '°C/100 m', { zeroBased: true })}
<p class="muted" style="font-size:12px">Zimą mniejszy (inwersje – zimne powietrze zalega w dolinach), latem ok. 0,6 °C/100 m.</p></div>
</div>
<div class="card table-wrap" style="margin-top:16px">${table}</div>

<h2>Przykładowa zima dzień po dniu (sezon ${example[0].date.year}/${example[0].date.year + 1})</h2>
<div class="card">${seasonChart(example, bottom, top, zBottom, zTop)}
<p class="muted">Na ${zTop} m: ${snowDaysTop} dni ze śniegiem. Na ${zBottom} m: ${snowDaysBottom} dni ze śniegiem i ${rainDaysBottom} z deszczem – izoterma 0 °C często leży między dołem a górą ośrodka.</p></div>

<h2>Suma dobowa promieniowania przy bezchmurnym niebie</h2>
<div class="maps">
<div class="card"><b>21 grudnia</b><img src="${radiationImage(dec)}" alt="Mapa sumy promieniowania 21 grudnia">
<p>średnio ${fmt(decStats.all, 2)} kWh/m²; stoki północne ${fmt(decStats.north, 2)}, południowe ${fmt(decStats.south, 2)} kWh/m² (${fmt(decStats.south / decStats.north, 1)} × więcej); zakres ${fmt(decStats.min, 2)}–${fmt(decStats.max, 2)}</p></div>
<div class="card"><b>21 marca</b><img src="${radiationImage(mar)}" alt="Mapa sumy promieniowania 21 marca">
<p>średnio ${fmt(marStats.all, 2)} kWh/m²; stoki północne ${fmt(marStats.north, 2)}, południowe ${fmt(marStats.south, 2)} kWh/m² (${fmt(marStats.south / marStats.north, 1)} × więcej); zakres ${fmt(marStats.min, 2)}–${fmt(marStats.max, 2)}</p></div>
</div>
<div style="max-width:520px;margin-top:8px"><div class="scale"></div><div class="scale-labels"><span>0</span><span>${fmt(scaleMax / 2, 1)}</span><span>${scaleMax} kWh/m²</span></div></div>
<p class="muted">Obie mapy w tej samej skali. Północ u góry, mapa 4 × 4,5 km; szare – Słowacja (poza mapą). Cienie terenu z modelu 15 × 15 km (Copernicus) – kopuła Pilska zacienia stoki tuż pod granicą. Stoki o nachyleniu ≥ 15 %: północne = ekspozycja N ±45°, południowe = S ±45°.</p>

<h2>Skąd dane</h2>
<p class="muted">${Object.entries(profile.stations).map(([k, v]) => `<b>${esc(STATION_ROLE_NAMES[k] ?? k)}:</b> ${esc(v)}`).join('<br>')}</p>
<p class="muted">Dane: IMGW-PIB, danepubliczne.imgw.pl. Model terenu okolicy: Copernicus DEM GLO-30 (© DLR e.V. 2010–2014, © Airbus Defence and Space GmbH 2014–2018, ESA/UE). NMT: GUGiK.</p>
</main></body></html>`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  log(`Zapisano ${OUT}. Werdykt: ${verdictOk ? 'ZGODNE' : 'NIEZGODNE'} (${okCount}/${rows.length * 3}).`);
}

main();
