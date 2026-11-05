/**
 * Odczyt danych z archiwum danych publicznych IMGW (danepubliczne.imgw.pl): pobieranie plików ZIP
 * z pamięcią podręczną w .cache/imgw/raw, rozpakowanie, odczyt CSV (Windows-1250).
 * Wspólne dla narzędzi: profil klimatyczny (importClimate) i kalibracja śniegu (snowCalibration).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

export const BASE = 'https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/dane_meteorologiczne';
const CACHE = '.cache/imgw/raw';
const DECODER = new TextDecoder('windows-1250');


export async function download(url: string, file: string): Promise<Uint8Array | null> {
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
export function unzipCsv(zip: Uint8Array): Map<string, string> {
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

export function* csvRows(text: string): Generator<string[]> {
  for (const line of text.split(/\r?\n/)) if (line.length > 0) yield parseCsvLine(line);
}

/** Grupa pięcioletnia katalogów IMGW dla lat ≤ 2000 (np. 1996_2000). */
export function fiveYearGroup(year: number): string {
  const start = Math.floor((year - 1) / 5) * 5 + 1;
  return `${start}_${start + 4}`;
}

// ---------------------------------------------------------------- struktury danych

export interface DayRecord {
  tMax?: number;
  tMin?: number;
  tMean?: number;
  precipMm?: number;
  humidity?: number;
  windMs?: number;
  cloudOktas?: number;
  windDirDeg?: number[];
  /** Grubość pokrywy śnieżnej (pomiar o 6 UTC) [cm]. */
  snowDepthCm?: number;
}

export type StationDays = Map<number, DayRecord>;
export const dayKey = (y: number, m: number, d: number) => y * 10000 + m * 100 + d;
export const keyYear = (k: number) => Math.floor(k / 10000);
export const keyMonth = (k: number) => Math.floor(k / 100) % 100;

export function nextDayKey(k: number): number {
  const date = new Date(Date.UTC(keyYear(k), keyMonth(k) - 1, k % 100) + 86_400_000);
  return dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function num(value: string, status: string | undefined): number | undefined {
  if (status === '8' || value === '') return undefined;
  const v = Number(value);
  return Number.isFinite(v) ? v : undefined;
}

export class Store {
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
export function ingestDailyMain(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 15 || !/^\d{4}$/.test(f[2])) continue;
    const r = store.day(f[0], dayKey(+f[2], +f[3], +f[4]));
    store.names.set(f[0], f[1]);
    r.tMax = num(f[5], f[6]);
    r.tMin = num(f[7], f[8]);
    r.tMean = num(f[9], f[10]);
    r.precipMm = f[14] === '9' ? 0 : num(f[13], f[14]);
    // PKSN(16) WPKSN(17): status 9 – brak zjawiska (0 cm).
    if (f.length > 17) r.snowDepthCm = f[17] === '9' ? 0 : num(f[16], f[17]);
  }
}

/** k_d_t: TEMP(5) WTEMP WLGS(7) WWLGS FWS(9) WFWS NOS(11) WNOS. */
export function ingestKlimatT(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 13 || !/^\d{4}$/.test(f[2])) continue;
    const r = store.day(f[0], dayKey(+f[2], +f[3], +f[4]));
    r.humidity = num(f[7], f[8]);
    r.windMs = num(f[9], f[10]);
    r.cloudOktas = num(f[11], f[12]);
  }
}

/** s_d_t: NOS(5) WNOS FWS(7) WFWS TEMP(9) WTEMP CPW(11) WCPW WLGS(13) WWLGS. */
export function ingestSynopT(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 15 || !/^\d{4}$/.test(f[2])) continue;
    const r = store.day(f[0], dayKey(+f[2], +f[3], +f[4]));
    r.cloudOktas = num(f[5], f[6]);
    r.windMs = num(f[7], f[8]);
    r.humidity = num(f[13], f[14]);
  }
}

/** o_d: SMDB(5) WSMDB(6). Brak wiersza w miesiącu z danymi = brak opadu. Status Z (opad zbiorczy) = brak. */
export function ingestOpad(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 7 || !/^\d{4}$/.test(f[2])) continue;
    const code = f[0];
    store.names.set(code, f[1]);
    let months = store.precipMonths.get(code);
    if (!months) store.precipMonths.set(code, (months = new Set()));
    months.add(+f[2] * 100 + +f[3]);
    const r = store.day(code, dayKey(+f[2], +f[3], +f[4]));
    r.precipMm = f[6] === 'Z' ? Number.NaN : f[6] === '9' ? 0 : num(f[5], f[6]) ?? Number.NaN;
    // PKSN(8) WPKSN(9).
    if (f.length > 9) r.snowDepthCm = f[9] === '9' ? 0 : num(f[8], f[9]);
  }
}

/** s_t: KRWR(23) WKRWR(24) FWR(25). Kierunki z terminów pomiarowych → do dnia. */
export function ingestSynopTerm(store: Store, text: string): void {
  for (const f of csvRows(text)) {
    if (f.length < 26 || !/^\d{4}$/.test(f[2])) continue;
    const dir = num(f[23], f[24]);
    const speed = num(f[25], f[26]);
    if (dir === undefined || speed === undefined || speed < 0.5 || dir <= 0 || dir > 360) continue;
    const r = store.day(f[0], dayKey(+f[2], +f[3], +f[4]));
    (r.windDirDeg ??= []).push(dir);
  }
}

