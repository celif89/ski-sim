/**
 * Profil klimatyczny z danych IMGW (archiwum danych publicznych, danepubliczne.imgw.pl).
 *
 * Uruchomienie:  npm run import-climate
 *
 * Ustawienia (okres, stacje): data/climate/pilsko-sources.json. Wynik: data/climate/pilsko.json.
 * Surowe pliki IMGW zapisywane są w .cache/imgw (poza repozytorium).
 *
 * Co liczy (dla każdego miesiąca):
 *  – temperatura: średnia na wysokości odniesienia i spadek z wysokością – regresja średnich
 *    miesięcznych ze wszystkich stacji w promieniu regressionRadiusKm (średnie ze stacji o krótszych
 *    seriach wyrównane do pełnego okresu metodą różnic względem stacji homogenization);
 *    rozrzut i pamięć (autokorelacja) odchyleń dobowych, amplituda dobowa, różnica dni z opadem
 *    i bez – ze stacji odniesienia;
 *  – opad: prawdopodobieństwa dnia mokrego po suchym i po mokrym (łańcuch Markowa), rozkład gamma
 *    sum dobowych, średnie sumy i liczby dni z opadem – z posterunku precipitation;
 *    przyrost opadu z wysokością – regresja sum rocznych z posterunków w promieniu
 *    precipitationRegressionRadiusKm;
 *  – wilgotność, zachmurzenie (osobno w dni z opadem i bez), prędkość wiatru – stacje odniesienia;
 *  – kierunki wiatru i przyrost prędkości z wysokością – stacja windAloft.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { readNumber } from '../sim/params';

const BASE = 'https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/dane_meteorologiczne';
const API_STATIONS = 'https://danepubliczne.imgw.pl/api/data/meteo/';
const CACHE = '.cache/imgw/raw';
const SOURCES_FILE = 'data/climate/pilsko-sources.json';
const OUTPUT_FILE = 'data/climate/pilsko.json';
const PARALLEL = 6;
const MONTHS = 12;
const DECODER = new TextDecoder('windows-1250');

function log(message: string): void {
  console.log(`[import-climate] ${message}`);
}

// ---------------------------------------------------------------- pobieranie i odczyt plików

async function download(url: string, file: string): Promise<Uint8Array | null> {
  const path = join(CACHE, file);
  if (existsSync(path)) return new Uint8Array(await readFile(path));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = new Uint8Array(await response.arrayBuffer());
      await mkdir(CACHE, { recursive: true });
      await writeFile(path, data);
      return data;
    } catch (error) {
      if (attempt === 3) throw new Error(`Nie udało się pobrać ${url}: ${String(error)}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return null;
}

/** Zawartość plików CSV z archiwum ZIP (kodowanie Windows-1250). */
function unzipCsv(zip: Uint8Array): Map<string, string> {
  const files = unzipSync(zip);
  const out = new Map<string, string>();
  for (const [name, data] of Object.entries(files)) if (name.toLowerCase().endsWith('.csv')) out.set(name, DECODER.decode(data));
  return out;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else current += ch;
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function* csvRows(text: string): Generator<string[]> {
  for (const line of text.split(/\r?\n/)) if (line.length > 0) yield parseCsvLine(line);
}

/** Grupa pięcioletnia katalogów IMGW dla lat ≤ 2000 (np. 1996_2000). */
function fiveYearGroup(year: number): string {
  const start = Math.floor((year - 1) / 5) * 5 + 1;
  return `${start}_${start + 4}`;
}

// ---------------------------------------------------------------- struktury danych

interface DayRecord {
  tMax?: number;
  tMin?: number;
  tMean?: number;
  precipMm?: number;
  humidity?: number;
  windMs?: number;
  cloudOktas?: number;
  windDirDeg?: number[];
}

type StationDays = Map<number, DayRecord>;
const dayKey = (y: number, m: number, d: number) => y * 10000 + m * 100 + d;
const keyYear = (k: number) => Math.floor(k / 10000);
const keyMonth = (k: number) => Math.floor(k / 100) % 100;

function nextDayKey(k: number): number {
  const date = new Date(Date.UTC(keyYear(k), keyMonth(k) - 1, k % 100) + 86_400_000);
  return dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function num(value: string, status: string | undefined): number | undefined {
  if (status === '8' || value === '') return undefined;
  const v = Number(value);
  return Number.isFinite(v) ? v : undefined;
}

class Store {
  readonly stations = new Map<string, StationDays>();
  readonly names = new Map<string, string>();
  /** Miesiące (rrrr·100+mm), w których posterunek opadowy przysłał dane. */
  readonly precipMonths = new Map<string, Set<number>>();

  day(code: string, key: number): DayRecord {
    let s = this.stations.get(code);
    if (!s) this.stations.set(code, (s = new Map()));
    let r = s.get(key);
    if (!r) s.set(key, (r = {}));
    return r;
  }
}

/** k_d / s_d: TMAX(5) WTMAX TMIN(7) WTMIN STD(9) WSTD TMNG WTMNG SMDB(13) WSMDB(14). */
function ingestDailyMain(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 15 || !/^\d{4}$/.test(f[2])) continue;
    const r = store.day(f[0], dayKey(+f[2], +f[3], +f[4]));
    store.names.set(f[0], f[1]);
    r.tMax = num(f[5], f[6]);
    r.tMin = num(f[7], f[8]);
    r.tMean = num(f[9], f[10]);
    r.precipMm = f[14] === '9' ? 0 : num(f[13], f[14]);
  }
}

/** k_d_t: TEMP(5) WTEMP WLGS(7) WWLGS FWS(9) WFWS NOS(11) WNOS. */
function ingestKlimatT(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 13 || !/^\d{4}$/.test(f[2])) continue;
    const r = store.day(f[0], dayKey(+f[2], +f[3], +f[4]));
    r.humidity = num(f[7], f[8]);
    r.windMs = num(f[9], f[10]);
    r.cloudOktas = num(f[11], f[12]);
  }
}

/** s_d_t: NOS(5) WNOS FWS(7) WFWS TEMP(9) WTEMP CPW(11) WCPW WLGS(13) WWLGS. */
function ingestSynopT(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 15 || !/^\d{4}$/.test(f[2])) continue;
    const r = store.day(f[0], dayKey(+f[2], +f[3], +f[4]));
    r.cloudOktas = num(f[5], f[6]);
    r.windMs = num(f[7], f[8]);
    r.humidity = num(f[13], f[14]);
  }
}

/** o_d: SMDB(5) WSMDB(6). Brak wiersza w miesiącu z danymi = brak opadu. Status Z (opad zbiorczy) = brak. */
function ingestOpad(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 7 || !/^\d{4}$/.test(f[2])) continue;
    const code = f[0];
    store.names.set(code, f[1]);
    let months = store.precipMonths.get(code);
    if (!months) store.precipMonths.set(code, (months = new Set()));
    months.add(+f[2] * 100 + +f[3]);
    const r = store.day(code, dayKey(+f[2], +f[3], +f[4]));
    r.precipMm = f[6] === 'Z' ? Number.NaN : f[6] === '9' ? 0 : num(f[5], f[6]) ?? Number.NaN;
  }
}

/** s_t: KRWR(23) WKRWR(24) FWR(25). Kierunki z terminów pomiarowych → do dnia. */
function ingestSynopTerm(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 26 || !/^\d{4}$/.test(f[2])) continue;
    const dir = num(f[23], f[24]);
    const speed = num(f[25], f[26]);
    if (dir === undefined || speed === undefined || speed < 0.5 || dir <= 0 || dir > 360) continue;
    const r = store.day(f[0], dayKey(+f[2], +f[3], +f[4]));
    (r.windDirDeg ??= []).push(dir);
  }
}

// ---------------------------------------------------------------- statystyka

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
function std(a: number[]): number {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
}
function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < xs.length; k++) {
    sxy += (xs[k] - mx) * (ys[k] - my);
    sxx += (xs[k] - mx) ** 2;
    syy += (ys[k] - my) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: (sxy * sxy) / (sxx * syy) };
}
/** Estymator Thoma (1958) parametrów rozkładu gamma. */
function gammaFit(xs: number[]): { shape: number; scale: number } {
  const m = mean(xs);
  const a = Math.log(m) - mean(xs.map(Math.log));
  const shape = (1 + Math.sqrt(1 + (4 * a) / 3)) / (4 * a);
  return { shape, scale: m / shape };
}
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;
const roundAll = (a: number[], digits: number) => a.map((x) => round(x, digits));

// ---------------------------------------------------------------- główny program

interface StationMeta {
  code: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  elevationM: number;
}

async function main(): Promise<void> {
  const src = JSON.parse(await readFile(SOURCES_FILE, 'utf8')) as Record<string, any>;
  const startYear = readNumber(src.period, 'startYear', SOURCES_FILE, { integer: true, min: 1951 });
  const endYear = readNumber(src.period, 'endYear', SOURCES_FILE, { integer: true });
  if (endYear >= new Date().getUTCFullYear()) throw new Error(`${SOURCES_FILE}: endYear musi być pełnym, zakończonym rokiem`);
  const zRef = readNumber(src, 'referenceElevationM', SOURCES_FILE);
  const radiusKm = readNumber(src, 'regressionRadiusKm', SOURCES_FILE);
  const precipRadiusKm = readNumber(src, 'precipitationRegressionRadiusKm', SOURCES_FILE);
  const minYears = readNumber(src, 'minYearsForRegression', SOURCES_FILE);
  const wetMm = readNumber(src, 'wetDayThresholdMm', SOURCES_FILE);
  const homeLat = readNumber(src.location, 'latDeg', SOURCES_FILE);
  const homeLon = readNumber(src.location, 'lonDeg', SOURCES_FILE);
  const st = src.stations as { reference: string[]; humidity: string[]; precipitation: string; homogenization: string; windAloft: string };
  const synopCode = (code: string) => code.slice(-3); // 349190600 → 600

  // Metadane stacji (współrzędne, wysokość) z API IMGW.
  log('Pobieram wykaz stacji z API IMGW…');
  const apiData = await download(API_STATIONS, 'api_meteo.json');
  if (!apiData) throw new Error('Brak wykazu stacji');
  const meta = new Map<string, StationMeta>();
  for (const s of JSON.parse(new TextDecoder().decode(apiData)) as Record<string, string | null>[]) {
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    const z = Number(s.wysokosc_npm);
    if (s.kod_stacji && Number.isFinite(lat) && Number.isFinite(lon) && s.wysokosc_npm !== null && Number.isFinite(z)) {
      meta.set(s.kod_stacji, { code: s.kod_stacji, name: s.nazwa_stacji ?? '', latDeg: lat, lonDeg: lon, elevationM: z });
    }
  }

  // Pobranie danych.
  const store = new Store();
  const jobs: { url: string; file: string; ingest: (text: string, name: string) => void }[] = [];
  const synopStations = [...new Set([st.homogenization, st.windAloft, ...[...meta.values()]
    .filter((m) => m.code.startsWith('3') && distanceKm(homeLat, homeLon, m.latDeg, m.lonDeg) <= radiusKm)
    .map((m) => m.code)])];
  const addedGroups = new Set<string>();
  for (let y = startYear; y <= endYear; y++) {
    if (y <= 2000) {
      const g = fiveYearGroup(y);
      jobs.push({ url: `${BASE}/dobowe/klimat/${g}/${y}_k.zip`, file: `k_d_${y}.zip`, ingest: dailyKlimat });
      jobs.push({ url: `${BASE}/dobowe/opad/${g}/${y}_o.zip`, file: `o_d_${y}.zip`, ingest: (t) => ingestOpad(store, t) });
      if (!addedGroups.has(g)) {
        addedGroups.add(g);
        for (const s of synopStations) {
          jobs.push({ url: `${BASE}/dobowe/synop/${g}/${g}_${synopCode(s)}_s.zip`, file: `s_d_${g}_${synopCode(s)}.zip`, ingest: dailySynop });
        }
        jobs.push({ url: `${BASE}/terminowe/synop/${g}/${g}_${synopCode(st.windAloft)}_s.zip`, file: `s_t_${g}_${synopCode(st.windAloft)}.zip`, ingest: (t) => ingestSynopTerm(store, t) });
      }
      continue;
    }
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      jobs.push({ url: `${BASE}/dobowe/klimat/${y}/${y}_${mm}_k.zip`, file: `k_d_${y}_${mm}.zip`, ingest: dailyKlimat });
      jobs.push({ url: `${BASE}/dobowe/opad/${y}/${y}_${mm}_o.zip`, file: `o_d_${y}_${mm}.zip`, ingest: (t) => ingestOpad(store, t) });
    }
    for (const s of synopStations) {
      jobs.push({ url: `${BASE}/dobowe/synop/${y}/${y}_${synopCode(s)}_s.zip`, file: `s_d_${y}_${synopCode(s)}.zip`, ingest: dailySynop });
    }
    jobs.push({ url: `${BASE}/terminowe/synop/${y}/${y}_${synopCode(st.windAloft)}_s.zip`, file: `s_t_${y}_${synopCode(st.windAloft)}.zip`, ingest: (t) => ingestSynopTerm(store, t) });
  }
  function dailyKlimat(text: string, name: string): void {
    if (/k_d_t_/i.test(name)) ingestKlimatT(store, text);
    else ingestDailyMain(store, text);
  }
  function dailySynop(text: string, name: string): void {
    if (/s_d_t_/i.test(name)) ingestSynopT(store, text);
    else ingestDailyMain(store, text);
  }
  log(`Pobieram i czytam ${jobs.length} plików z archiwum IMGW (pierwszy raz: kilka minut)…`);
  let done = 0;
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const zip = await download(job.url, job.file);
        if (zip) for (const [name, text] of unzipCsv(zip)) job.ingest(text, name);
        if (++done % 100 === 0) log(`  ${done}/${jobs.length}`);
      }
    }),
  );
  const inPeriod = (k: number) => keyYear(k) >= startYear && keyYear(k) <= endYear;

  // Uzupełnienie dni bez opadu na posterunkach (brak wiersza w miesiącu z danymi = 0 mm).
  for (const [code, months] of store.precipMonths) {
    for (const ym of months) {
      const y = Math.floor(ym / 100);
      const m = ym % 100;
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = 1; d <= days; d++) {
        const r = store.day(code, dayKey(y, m, d));
        if (r.precipMm === undefined) r.precipMm = 0;
      }
    }
  }

  const stationName = (code: string) => meta.get(code)?.name ?? store.names.get(code) ?? code;
  const describe = (code: string) => {
    const m = meta.get(code);
    return m ? `${m.name} (${m.elevationM} m n.p.m., ${round(distanceKm(homeLat, homeLon, m.latDeg, m.lonDeg), 1)} km)` : code;
  };
  const monthOf = (k: number) => keyMonth(k) - 1;

  // ---------------- 1. Średnie temperatury wyrównane do pełnego okresu + regresja z wysokością
  const hom = store.stations.get(st.homogenization);
  if (!hom) throw new Error('Brak danych stacji homogenization');
  const homMonthly = Array.from({ length: MONTHS }, () => [] as number[]);
  for (const [k, r] of hom) if (inPeriod(k) && r.tMean !== undefined) homMonthly[monthOf(k)].push(r.tMean);
  const homMean = homMonthly.map(mean);

  interface StationClim {
    code: string;
    elevationM: number;
    years: number;
    tMean: number[];
    dtr: number[];
  }
  const climStations: StationClim[] = [];
  for (const [code, days] of store.stations) {
    const m = meta.get(code);
    if (!m || distanceKm(homeLat, homeLon, m.latDeg, m.lonDeg) > radiusKm) continue;
    const years = new Set<number>();
    const diff = Array.from({ length: MONTHS }, () => [] as number[]);
    const dtr = Array.from({ length: MONTHS }, () => [] as number[]);
    for (const [k, r] of days) {
      if (!inPeriod(k) || r.tMean === undefined) continue;
      years.add(keyYear(k));
      const h = hom.get(k);
      if (h?.tMean !== undefined) diff[monthOf(k)].push(r.tMean - h.tMean);
      if (r.tMax !== undefined && r.tMin !== undefined) dtr[monthOf(k)].push(r.tMax - r.tMin);
    }
    if (years.size < minYears || diff.some((d) => d.length < 150) || dtr.some((d) => d.length < 150)) continue;
    climStations.push({
      code,
      elevationM: m.elevationM,
      years: years.size,
      tMean: diff.map((d, mo) => homMean[mo] + mean(d)),
      dtr: dtr.map(mean),
    });
  }
  climStations.sort((a, b) => a.elevationM - b.elevationM);
  log(`Stacje do regresji temperatury: ${climStations.length}`);
  const zs = climStations.map((s) => s.elevationM);
  const tempFits = Array.from({ length: MONTHS }, (_, mo) => linearFit(zs, climStations.map((s) => s.tMean[mo])));
  const dtrFits = Array.from({ length: MONTHS }, (_, mo) => linearFit(zs, climStations.map((s) => s.dtr[mo])));

  // ---------------- 2. Statystyki dobowe ze stacji odniesienia
  // Klimatologia dobowa stacji: średnie miesięczne interpolowane liniowo między środkami miesięcy.
  function smoothClimatology(monthMeans: number[], k: number): number {
    const y = keyYear(k);
    const m = keyMonth(k);
    const d = k % 100;
    const dim = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const pos = m - 1 + (d - 0.5) / dim(y, m) - 0.5; // 0 = środek stycznia
    const i0 = Math.floor(pos);
    const t = pos - i0;
    return monthMeans[(i0 + 12) % 12] * (1 - t) + monthMeans[(i0 + 13) % 12] * t;
  }
  const refStats = {
    anomaly: Array.from({ length: MONTHS }, () => [] as number[]),
    lagPairs: Array.from({ length: MONTHS }, () => [] as [number, number][]),
    wetAnom: Array.from({ length: MONTHS }, () => [] as number[]),
    dryAnom: Array.from({ length: MONTHS }, () => [] as number[]),
    dtrWet: Array.from({ length: MONTHS }, () => [] as number[]),
    dtrDry: Array.from({ length: MONTHS }, () => [] as number[]),
    rhWet: Array.from({ length: MONTHS }, () => [] as number[]),
    rhDry: Array.from({ length: MONTHS }, () => [] as number[]),
    cloudWet: Array.from({ length: MONTHS }, () => [] as number[]),
    cloudDry: Array.from({ length: MONTHS }, () => [] as number[]),
    wind: Array.from({ length: MONTHS }, () => [] as number[]),
  };
  const refYears: Record<string, string> = {};
  const refMonthlyMeans = Array.from({ length: MONTHS }, () => [] as number[]);
  for (const code of st.reference) {
    const days = store.stations.get(code);
    if (!days) throw new Error(`Brak danych stacji odniesienia ${code}`);
    const monthly = Array.from({ length: MONTHS }, () => [] as number[]);
    const years = new Set<number>();
    for (const [k, r] of days) if (inPeriod(k) && r.tMean !== undefined) {
      monthly[monthOf(k)].push(r.tMean);
      years.add(keyYear(k));
    }
    refYears[code] = `${Math.min(...years)}–${Math.max(...years)}`;
    // Średnie miesięczne poszczególnych lat (miesiące z co najmniej 25 dniami) – zmienność z roku na rok.
    const perYearMonth = new Map<number, number[]>();
    for (const [k, r] of days) if (inPeriod(k) && r.tMean !== undefined) {
      const ym = Math.floor(k / 100);
      let list = perYearMonth.get(ym);
      if (!list) perYearMonth.set(ym, (list = []));
      list.push(r.tMean);
    }
    for (const [ym, list] of perYearMonth) if (list.length >= 25) refMonthlyMeans[(ym % 100) - 1].push(mean(list));
    const mm = monthly.map(mean);
    // Odchylenia od klimatologii i podział na dni mokre/suche.
    const anomalyOf = new Map<number, number>();
    for (const [k, r] of days) if (inPeriod(k) && r.tMean !== undefined) anomalyOf.set(k, r.tMean - smoothClimatology(mm, k));
    const wetState = (r: DayRecord) => (r.precipMm === undefined || Number.isNaN(r.precipMm) ? undefined : r.precipMm >= wetMm);
    // Średnie odchylenie w dni mokre/suche (najpierw) – potrzebne do reszt.
    for (const [k, a] of anomalyOf) {
      const r = days.get(k)!;
      const wet = wetState(r);
      if (wet === undefined) continue;
      (wet ? refStats.wetAnom : refStats.dryAnom)[monthOf(k)].push(a);
    }
    for (const [k, r] of days) {
      if (!inPeriod(k)) continue;
      const mo = monthOf(k);
      const wet = wetState(r);
      if (r.tMax !== undefined && r.tMin !== undefined && wet !== undefined) (wet ? refStats.dtrWet : refStats.dtrDry)[mo].push(r.tMax - r.tMin);
      if (r.cloudOktas !== undefined && wet !== undefined) (wet ? refStats.cloudWet : refStats.cloudDry)[mo].push(r.cloudOktas / 8);
      if (r.windMs !== undefined) refStats.wind[mo].push(r.windMs);
    }
    // Reszty po usunięciu efektu dnia mokrego/suchego: rozrzut i autokorelacja.
    const wetMeanPerMonth = refStats.wetAnom.map((a) => (a.length ? mean(a) : 0));
    const dryMeanPerMonth = refStats.dryAnom.map((a) => (a.length ? mean(a) : 0));
    const residual = new Map<number, number>();
    for (const [k, a] of anomalyOf) {
      const wet = wetState(days.get(k)!);
      if (wet === undefined) continue;
      residual.set(k, a - (wet ? wetMeanPerMonth[monthOf(k)] : dryMeanPerMonth[monthOf(k)]));
    }
    for (const [k, v] of residual) {
      refStats.anomaly[monthOf(k)].push(v);
      const next = residual.get(nextDayKey(k));
      if (next !== undefined) refStats.lagPairs[monthOf(k)].push([v, next]);
    }
  }
  // Wilgotność – ze stacji synoptycznych (klimatologiczne jej nie mierzą).
  for (const code of st.humidity) {
    const days = store.stations.get(code);
    if (!days) throw new Error(`Brak danych stacji ${code} (wilgotność)`);
    for (const [k, r] of days) {
      if (!inPeriod(k) || r.humidity === undefined || r.precipMm === undefined || Number.isNaN(r.precipMm)) continue;
      (r.precipMm >= wetMm ? refStats.rhWet : refStats.rhDry)[monthOf(k)].push(r.humidity);
    }
  }
  const humidityNames = st.humidity.map(describe).join('; ');
  const autocorr = refStats.lagPairs.map((pairs) => {
    const xs = pairs.map((p) => p[0]);
    const ys = pairs.map((p) => p[1]);
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let k = 0; k < xs.length; k++) {
      num += (xs[k] - mx) * (ys[k] - my);
      dx += (xs[k] - mx) ** 2;
      dy += (ys[k] - my) ** 2;
    }
    return num / Math.sqrt(dx * dy);
  });

  // ---------------- 3. Opad (posterunek na mapie)
  const pr = store.stations.get(st.precipitation);
  if (!pr) throw new Error('Brak danych posterunku opadowego');
  const n01 = new Array(MONTHS).fill(0);
  const n00 = new Array(MONTHS).fill(0);
  const n11 = new Array(MONTHS).fill(0);
  const n10 = new Array(MONTHS).fill(0);
  const wetAmounts = Array.from({ length: MONTHS }, () => [] as number[]);
  const monthTotals = Array.from({ length: MONTHS }, () => [] as number[]);
  const monthWetDays = Array.from({ length: MONTHS }, () => [] as number[]);
  const monthAgg = new Map<number, { total: number; wet: number; days: number; complete: boolean }>();
  for (const [k, r] of pr) {
    if (!inPeriod(k)) continue;
    const ym = Math.floor(k / 100);
    let agg = monthAgg.get(ym);
    if (!agg) monthAgg.set(ym, (agg = { total: 0, wet: 0, days: 0, complete: true }));
    const p = r.precipMm;
    if (p === undefined || Number.isNaN(p)) {
      agg.complete = false;
      continue;
    }
    agg.days++;
    agg.total += p;
    const wet = p >= wetMm;
    if (wet) {
      agg.wet++;
      wetAmounts[monthOf(k)].push(p);
    }
    const prev = pr.get(dayKeyMinusOne(k));
    if (prev?.precipMm !== undefined && !Number.isNaN(prev.precipMm)) {
      const prevWet = prev.precipMm >= wetMm;
      const mo = monthOf(k);
      if (prevWet) wet ? n11[mo]++ : n10[mo]++;
      else wet ? n01[mo]++ : n00[mo]++;
    }
  }
  for (const [ym, agg] of monthAgg) {
    const y = Math.floor(ym / 100);
    const m = ym % 100;
    if (agg.complete && agg.days === new Date(Date.UTC(y, m, 0)).getUTCDate()) {
      monthTotals[m - 1].push(agg.total);
      monthWetDays[m - 1].push(agg.wet);
    }
  }
  const gammas = wetAmounts.map(gammaFit);

  // Przyrost opadu z wysokością: regresja sum rocznych (średnie miesięczne z lat kompletnych).
  const precipPoints: { code: string; z: number; annual: number }[] = [];
  for (const [code, months] of store.precipMonths) {
    const m = meta.get(code);
    if (!m || distanceKm(homeLat, homeLon, m.latDeg, m.lonDeg) > precipRadiusKm) continue;
    const days = store.stations.get(code)!;
    const perMonth = Array.from({ length: MONTHS }, () => [] as number[]);
    for (const ym of months) {
      const y = Math.floor(ym / 100);
      const mo = ym % 100;
      if (y < startYear || y > endYear) continue;
      let total = 0;
      let ok = true;
      for (let d = 1; d <= new Date(Date.UTC(y, mo, 0)).getUTCDate(); d++) {
        const p = days.get(dayKey(y, mo, d))?.precipMm;
        if (p === undefined || Number.isNaN(p)) ok = false;
        else total += p;
      }
      if (ok) perMonth[mo - 1].push(total);
    }
    if (perMonth.some((a) => a.length < minYears)) continue;
    precipPoints.push({ code, z: m.elevationM, annual: perMonth.map(mean).reduce((s, x) => s + x, 0) });
  }
  const precipFit = linearFit(precipPoints.map((p) => p.z), precipPoints.map((p) => p.annual));
  const zPrecip = meta.get(st.precipitation)!.elevationM;
  const precipGradientPct = (100 * precipFit.slope * 100) / (precipFit.intercept + precipFit.slope * zPrecip);

  // ---------------- 4. Wiatr na wysokości (Kasprowy Wierch)
  const aloft = store.stations.get(st.windAloft)!;
  const aloftSpeed = Array.from({ length: MONTHS }, () => [] as number[]);
  const sectorCounts = Array.from({ length: MONTHS }, () => new Array(8).fill(0));
  let samePrev = 0;
  let pairs = 0;
  const sectorOfDay = new Map<number, number>();
  for (const [k, r] of aloft) {
    if (!inPeriod(k)) continue;
    if (r.windMs !== undefined) aloftSpeed[monthOf(k)].push(r.windMs);
    if (r.windDirDeg && r.windDirDeg.length >= 4) {
      let sx = 0;
      let sy = 0;
      for (const d of r.windDirDeg) {
        sx += Math.sin((d * Math.PI) / 180);
        sy += Math.cos((d * Math.PI) / 180);
      }
      const dir = ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
      const sector = Math.round(dir / 45) % 8;
      sectorOfDay.set(k, sector);
      sectorCounts[monthOf(k)][sector]++;
    }
  }
  for (const [k, s] of sectorOfDay) {
    const prev = sectorOfDay.get(dayKeyMinusOne(k));
    if (prev === undefined) continue;
    pairs++;
    if (prev === s) samePrev++;
  }
  const zAloft = meta.get(st.windAloft)!.elevationM;
  const refWindMean = refStats.wind.map(mean);
  const windRatio = aloftSpeed.map((a, mo) => mean(a) / refWindMean[mo]);
  const windGrowthPer1000m = windRatio.map((r) => Math.log(r) / ((zAloft - zRef) / 1000));

  // ---------------- zapis
  const period = `${startYear}–${endYear}`;
  const refNames = st.reference.map((c) => `${describe(c)}, lata ${refYears[c]}`).join('; ');
  const arr = (value: number[], unit: string, source: string) => ({ value, unit, source });
  const profile = {
    _opis:
      'Profil klimatyczny okolic Pilska – wynik npm run import-climate (src/tools/importClimate.ts) z danych IMGW. Tablice mają 12 wartości: styczeń…grudzień. Nie edytować ręcznie – zmienić ustawienia w pilsko-sources.json i uruchomić narzędzie ponownie.',
    generated: new Date().toISOString().slice(0, 10),
    dataSource: 'IMGW-PIB, archiwum danych publicznych: danepubliczne.imgw.pl (dane dobowe klimat/opad/synop, terminowe synop); metadane stacji: API IMGW (api/data/meteo).',
    referencePeriod: {
      startYear: { value: startYear, unit: 'rok', source: SOURCES_FILE },
      endYear: { value: endYear, unit: 'rok', source: SOURCES_FILE },
    },
    referenceElevationM: { value: zRef, unit: 'm n.p.m.', source: SOURCES_FILE },
    stations: {
      reference: refNames,
      humidity: humidityNames,
      precipitation: `${describe(st.precipitation)}, lata ${period}`,
      homogenization: describe(st.homogenization),
      windAloft: describe(st.windAloft),
      temperatureRegression: climStations.map((s) => `${stationName(s.code)} ${s.elevationM} m (${s.years} lat)`).join(', '),
      precipitationRegression: precipPoints.map((p) => `${stationName(p.code)} ${p.z} m`).join(', '),
    },
    temperature: {
      meanC: arr(
        roundAll(tempFits.map((f) => f.intercept + f.slope * zRef), 2),
        '°C',
        `średnia dobowa na wysokości odniesienia: regresja liniowa średnich miesięcznych z ${climStations.length} stacji (${period}, wyrównanych do pełnego okresu względem ${stationName(st.homogenization)})`,
      ),
      lapseRateCPer100m: arr(
        roundAll(tempFits.map((f) => f.slope * 100), 3),
        '°C/100 m',
        `nachylenie tej regresji (R² od ${round(Math.min(...tempFits.map((f) => f.r2)), 2)} do ${round(Math.max(...tempFits.map((f) => f.r2)), 2)})`,
      ),
      dailyAnomalyStdC: arr(roundAll(refStats.anomaly.map(std), 2), '°C', `odchylenie standardowe dobowych odchyleń od normy (bez efektu dni z opadem) – ${refNames}`),
      anomalyAutocorrelation: arr(roundAll(autocorr, 3), '-', 'autokorelacja tych odchyleń z dnia na dzień (pamięć pogody) – stacje odniesienia'),
      wetDayAnomalyC: arr(roundAll(refStats.wetAnom.map(mean), 2), '°C', 'średnie odchylenie temperatury w dni z opadem – stacje odniesienia'),
      dryDayAnomalyC: arr(roundAll(refStats.dryAnom.map(mean), 2), '°C', 'średnie odchylenie temperatury w dni bez opadu – stacje odniesienia'),
      observedMonthlyMeanStdC: arr(roundAll(refMonthlyMeans.map(std), 2), '°C', 'odchylenie standardowe średniej miesięcznej z roku na rok – stacje odniesienia; do oceny zgodności w raporcie'),
      diurnalRangeDryC: arr(roundAll(refStats.dtrDry.map(mean), 2), '°C', 'średnia amplituda dobowa (Tmax − Tmin) w dni bez opadu – stacje odniesienia'),
      diurnalRangeWetC: arr(roundAll(refStats.dtrWet.map(mean), 2), '°C', 'średnia amplituda dobowa w dni z opadem – stacje odniesienia'),
      diurnalRangeChangePer100m: arr(roundAll(dtrFits.map((f) => f.slope * 100), 3), '°C/100 m', 'zmiana amplitudy dobowej z wysokością: regresja po tych samych stacjach co temperatura'),
    },
    precipitation: {
      wetDayThresholdMm: { value: wetMm, unit: 'mm', source: SOURCES_FILE },
      referenceElevationM: { value: zPrecip, unit: 'm n.p.m.', source: describe(st.precipitation) },
      pWetAfterDry: arr(roundAll(n01.map((x, mo) => x / (x + n00[mo])), 3), '-', `prawdopodobieństwo dnia z opadem po dniu bez opadu – ${describe(st.precipitation)}, ${period}`),
      pWetAfterWet: arr(roundAll(n11.map((x, mo) => x / (x + n10[mo])), 3), '-', 'prawdopodobieństwo dnia z opadem po dniu z opadem – j.w.'),
      gammaShape: arr(roundAll(gammas.map((g) => g.shape), 3), '-', 'parametr kształtu rozkładu gamma sum dobowych w dni z opadem (estymator Thoma) – j.w.'),
      gammaScaleMm: arr(roundAll(gammas.map((g) => g.scale), 3), 'mm', 'parametr skali rozkładu gamma – j.w.'),
      observedMonthlyTotalMm: arr(roundAll(monthTotals.map(mean), 1), 'mm', `średnia suma miesięczna (miesiące kompletne) – j.w.; do porównania w raporcie`),
      observedMonthlyTotalStdMm: arr(roundAll(monthTotals.map(std), 1), 'mm', 'odchylenie standardowe sum miesięcznych – j.w.'),
      observedWetDays: arr(roundAll(monthWetDays.map(mean), 2), 'dni', `średnia liczba dni z opadem ≥ ${wetMm} mm – j.w.`),
      observedWetDaysStd: arr(roundAll(monthWetDays.map(std), 2), 'dni', 'odchylenie standardowe liczby dni z opadem z roku na rok – j.w.'),
      elevationGradientPercentPer100m: {
        value: round(precipGradientPct, 2),
        unit: '%/100 m',
        source: `regresja rocznych sum opadu z ${precipPoints.length} posterunków w promieniu ${precipRadiusKm} km (${round(precipFit.slope * 100, 1)} mm/100 m, R² = ${round(precipFit.r2, 2)}); literatura dla Karpat: 40–60 mm/100 m (Hess 1965)`,
      },
    },
    humidity: {
      meanDryPercent: arr(roundAll(refStats.rhDry.map(mean), 1), '%', `średnia dobowa wilgotność względna w dni bez opadu – ${humidityNames}, ${period}`),
      meanWetPercent: arr(roundAll(refStats.rhWet.map(mean), 1), '%', 'j.w. w dni z opadem'),
      stdPercent: arr(roundAll(refStats.rhDry.map(std), 1), '%', 'odchylenie standardowe w dni bez opadu'),
    },
    cloud: {
      meanDryFraction: arr(roundAll(refStats.cloudDry.map(mean), 3), '0–1', 'średnie dobowe zachmurzenie ogólne (oktanty / 8) w dni bez opadu – stacje odniesienia'),
      meanWetFraction: arr(roundAll(refStats.cloudWet.map(mean), 3), '0–1', 'j.w. w dni z opadem'),
      stdDryFraction: arr(roundAll(refStats.cloudDry.map(std), 3), '0–1', 'odchylenie standardowe w dni bez opadu'),
      stdWetFraction: arr(roundAll(refStats.cloudWet.map(std), 3), '0–1', 'odchylenie standardowe w dni z opadem'),
    },
    wind: {
      meanSpeedMs: arr(roundAll(refWindMean, 2), 'm/s', 'średnia dobowa prędkość wiatru na wysokości odniesienia – stacje odniesienia (wiatromierz ok. 10 m nad gruntem)'),
      speedStdMs: arr(roundAll(refStats.wind.map(std), 2), 'm/s', 'odchylenie standardowe średnich dobowych'),
      growthPer1000m: arr(
        roundAll(windGrowthPer1000m, 3),
        '1/1000 m',
        `przyrost prędkości z wysokością: v(z) = v_ref · exp(g · (z − z_ref)/1000), g z ilorazu średnich ${describe(st.windAloft)} / stacje odniesienia`,
      ),
      directionSectors: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
      directionFrequencies: {
        value: sectorCounts.map((c) => {
          const total = c.reduce((s: number, x: number) => s + x, 0);
          return c.map((x: number) => round(x / total, 3));
        }),
        unit: 'udział dni (wiersz = miesiąc, kolumna = sektor)',
        source: `dominujący kierunek wiatru w dniu (średnia wektorowa z terminów) – ${describe(st.windAloft)}, ${period}`,
      },
      directionPersistence: {
        value: round(samePrev / pairs, 3),
        unit: '-',
        source: 'prawdopodobieństwo, że dominujący kierunek jest taki sam jak dzień wcześniej – j.w.',
      },
    },
  };
  await mkdir('data/climate', { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(profile, null, 2) + '\n');
  log(`Zapisano ${OUTPUT_FILE}.`);
  log(`Temperatura na ${zRef} m (I…XII): ${profile.temperature.meanC.value.join(' ')}`);
  log(`Spadek temperatury [°C/100 m]: ${profile.temperature.lapseRateCPer100m.value.join(' ')}`);
  log(`Opad Korbielów [mm]: ${profile.precipitation.observedMonthlyTotalMm.value.join(' ')}`);
  log(`Przyrost opadu z wysokością: ${profile.precipitation.elevationGradientPercentPer100m.value} %/100 m`);
}

function dayKeyMinusOne(k: number): number {
  const date = new Date(Date.UTC(keyYear(k), keyMonth(k) - 1, k % 100) - 86_400_000);
  return dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
