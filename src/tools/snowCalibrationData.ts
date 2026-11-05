/**
 * Dane do kalibracji modelu śniegu: rzeczywista pogoda dobowa i grubość pokrywy śnieżnej
 * ze stacji IMGW Korbielów, Zawoja i Laliki – zimy 2009/10–2018/19.
 *
 * Uruchomienie:  npm run snow-calibration-data
 *
 * Wynik: data/calibration/imgw-stations.json (kilkaset kB – mieści się w repozytorium, więc raport
 * i testy nie potrzebują sieci). Surowe pliki IMGW: .cache/imgw/raw.
 *
 * Skąd co:
 *  – Zawoja, Laliki (stacje klimatologiczne): temperatura (średnia, maks., min.), opad, grubość
 *    śniegu, zachmurzenie i prędkość wiatru;
 *  – Korbielów (posterunek opadowy): opad i grubość śniegu; temperatura = średnia z Zawoi i Lalik
 *    przeliczona na 650 m spadkiem temperatury z profilu klimatycznego; zachmurzenie i wiatr – j.w.;
 *  – wilgotność: średnia ze stacji synoptycznych Bielsko-Biała i Zakopane (klimatologiczne jej nie mierzą).
 * Doba opadowa IMGW: suma zmierzona o 6 UTC przypisana do dnia poprzedniego; grubość śniegu – pomiar
 * o 6 UTC danego dnia.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import climateJson from '../../data/climate/pilsko.json';
import { parseClimateProfile } from '../sim/climate';
import { interpolateMonthly } from '../sim/climate';
import { addDays, daysInMonth, formatIsoDate } from '../sim/time';
import { BASE, Store, dayKey, download, ingestDailyMain, ingestKlimatT, ingestOpad, ingestSynopT, unzipCsv } from './imgwData';

const OUT = 'data/calibration/imgw-stations.json';
const FIRST_WINTER = 2009;
const LAST_WINTER = 2018; // sezon 2018/19
const SEASON_START_MONTH = 10;
const SEASON_DAYS = 243; // 1 X – 31 V (w roku przestępnym do 30 V)
/** Najwięcej brakujących dni (uzupełnianych z dnia poprzedniego), przy których zima jest użyta. */
const MAX_MISSING_DAYS = 10;
const ZAWOJA = '249190350';
const LALIKI = '249190480';
const KORBIELOW = '249190440';
const BIELSKO = '349190600';
const ZAKOPANE = '349190625';

function log(m: string): void {
  console.log(`[snow-calibration-data] ${m}`);
}

async function main(): Promise<void> {
  const profile = parseClimateProfile(climateJson);
  const store = new Store();
  const jobs: { url: string; file: string; kind: 'klimat' | 'opad' | 'synop' }[] = [];
  for (let y = FIRST_WINTER; y <= LAST_WINTER + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      jobs.push({ url: `${BASE}/dobowe/klimat/${y}/${y}_${mm}_k.zip`, file: `k_d_${y}_${mm}.zip`, kind: 'klimat' });
      jobs.push({ url: `${BASE}/dobowe/opad/${y}/${y}_${mm}_o.zip`, file: `o_d_${y}_${mm}.zip`, kind: 'opad' });
    }
    for (const s of [BIELSKO, ZAKOPANE]) jobs.push({ url: `${BASE}/dobowe/synop/${y}/${y}_${s.slice(-3)}_s.zip`, file: `s_d_${y}_${s.slice(-3)}.zip`, kind: 'synop' });
  }
  log(`Czytam ${jobs.length} plików IMGW (z pamięci podręcznej albo z sieci)…`);
  for (const job of jobs) {
    const zip = await download(job.url, job.file);
    if (!zip) continue;
    for (const [name, text] of unzipCsv(zip)) {
      if (job.kind === 'opad') ingestOpad(store, text);
      else if (job.kind === 'klimat') (/k_d_t_/i.test(name) ? ingestKlimatT : ingestDailyMain)(store, text);
      else (/s_d_t_/i.test(name) ? ingestSynopT : ingestDailyMain)(store, text);
    }
  }
  // Uzupełnienie dni bez opadu na posterunku (brak wiersza w miesiącu z danymi = 0 mm, 0 cm śniegu).
  for (const [code, months] of store.precipMonths) {
    for (const ym of months) {
      const y = Math.floor(ym / 100);
      const m = ym % 100;
      for (let d = 1; d <= daysInMonth(y, m); d++) {
        const r = store.day(code, dayKey(y, m, d));
        if (r.precipMm === undefined) r.precipMm = 0;
        if (r.snowDepthCm === undefined) r.snowDepthCm = 0;
      }
    }
  }
  const meta = JSON.parse(new TextDecoder().decode((await readFile('.cache/imgw/raw/api_meteo.json')) as Uint8Array)) as Record<string, string>[];
  const metaOf = (code: string) => {
    const m = meta.find((s) => s.kod_stacji === code);
    if (!m) throw new Error(`Brak metadanych stacji ${code}`);
    return { latDeg: Number(m.lat), lonDeg: Number(m.lon), elevationM: Number(m.wysokosc_npm), name: m.nazwa_stacji };
  };
  const rec = (code: string, k: number) => store.stations.get(code)?.get(k);
  const humidity = (k: number, month: number) => {
    const v = [BIELSKO, ZAKOPANE].map((c) => rec(c, k)?.humidity).filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : profile.humidity.meanDryPercent[month - 1];
  };

  const stations = [];
  for (const code of [KORBIELOW, ZAWOJA, LALIKI]) {
    const m = metaOf(code);
    const winters = [];
    for (let y = FIRST_WINTER; y <= LAST_WINTER; y++) {
      const start = { year: y, month: SEASON_START_MONTH, day: 1 };
      const series = { tMeanC: [] as number[], tMaxC: [] as number[], tMinC: [] as number[], precipMm: [] as number[], cloudFraction: [] as number[], windMs: [] as number[], humidityPercent: [] as number[], snowDepthCm: [] as (number | null)[] };
      let missing = 0;
      for (let d = 0; d < SEASON_DAYS; d++) {
        const date = addDays(start, d);
        const k = dayKey(date.year, date.month, date.day);
        let t: { mean?: number; max?: number; min?: number } = {};
        let cloud: number | undefined;
        let wind: number | undefined;
        if (code === KORBIELOW) {
          const lapse = interpolateMonthly(profile.temperature.lapseRateCPer100m, date.month, date.day, daysInMonth(date.year, date.month)) / 100;
          const parts = [ZAWOJA, LALIKI]
            .map((c) => ({ r: rec(c, k), z: metaOf(c).elevationM }))
            .filter((p) => p.r?.tMean !== undefined && p.r?.tMax !== undefined && p.r?.tMin !== undefined);
          if (parts.length) {
            const adj = (p: (typeof parts)[number], v: number) => v + lapse * (m.elevationM - p.z);
            t = {
              mean: parts.reduce((s, p) => s + adj(p, p.r!.tMean!), 0) / parts.length,
              max: parts.reduce((s, p) => s + adj(p, p.r!.tMax!), 0) / parts.length,
              min: parts.reduce((s, p) => s + adj(p, p.r!.tMin!), 0) / parts.length,
            };
          }
          const cl = [ZAWOJA, LALIKI].map((c) => rec(c, k)?.cloudOktas).filter((x): x is number => x !== undefined);
          const wi = [ZAWOJA, LALIKI].map((c) => rec(c, k)?.windMs).filter((x): x is number => x !== undefined);
          cloud = cl.length ? cl.reduce((a, b) => a + b, 0) / cl.length / 8 : undefined;
          wind = wi.length ? wi.reduce((a, b) => a + b, 0) / wi.length : undefined;
        } else {
          const r = rec(code, k);
          t = { mean: r?.tMean, max: r?.tMax, min: r?.tMin };
          cloud = r?.cloudOktas !== undefined ? r.cloudOktas / 8 : undefined;
          wind = r?.windMs;
        }
        const r = rec(code, k);
        const prev = (arr: number[], fallback: number) => (arr.length ? arr[arr.length - 1] : fallback);
        const anyMissing = t.mean === undefined || t.max === undefined || t.min === undefined || r?.precipMm === undefined || Number.isNaN(r.precipMm);
        if (anyMissing) missing++;
        series.tMeanC.push(round(t.mean ?? prev(series.tMeanC, 5), 1));
        series.tMaxC.push(round(t.max ?? prev(series.tMaxC, 8), 1));
        series.tMinC.push(round(t.min ?? prev(series.tMinC, 2), 1));
        series.precipMm.push(round(r?.precipMm !== undefined && !Number.isNaN(r.precipMm) ? r.precipMm : 0, 1));
        series.cloudFraction.push(round(cloud ?? prev(series.cloudFraction, 0.7), 3));
        series.windMs.push(round(wind ?? prev(series.windMs, 1.5), 1));
        series.humidityPercent.push(round(humidity(k, date.month), 0));
        series.snowDepthCm.push(r?.snowDepthCm ?? null);
      }
      if (missing > MAX_MISSING_DAYS) {
        log(`  ${m.name} ${y}/${y + 1}: pominięta (braki: ${missing} dni)`);
        continue;
      }
      winters.push({ start: formatIsoDate(start), filledMissingDays: missing, ...series });
    }
    log(`${m.name}: ${winters.length} zim`);
    stations.push({ code, name: m.name, latDeg: m.latDeg, lonDeg: m.lonDeg, elevationM: m.elevationM, winters });
  }
  await mkdir('data/calibration', { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        _opis:
          'Rzeczywista pogoda dobowa i grubość pokrywy śnieżnej ze stacji IMGW do kalibracji modelu śniegu. Wynik npm run snow-calibration-data – nie edytować ręcznie. Tablice: jedna wartość na dzień od daty start (1 października) do 31 maja.',
        source:
          'IMGW-PIB, danepubliczne.imgw.pl: dane dobowe klimat (Zawoja, Laliki: temperatura, opad, pokrywa śnieżna, zachmurzenie, wiatr), opad (Korbielów: opad, pokrywa śnieżna), synop (Bielsko-Biała, Zakopane: wilgotność). Korbielów: temperatura z Zawoi i Lalik przeliczona na 650 m spadkiem z profilu klimatycznego.',
        units: 'temperatura °C, opad mm/doba, zachmurzenie 0–1, wiatr m/s, wilgotność %, grubość śniegu cm (null – brak pomiaru)',
        generated: new Date().toISOString().slice(0, 10),
        stations,
      },
      null,
      1,
    ) + '\n',
  );
  log(`Zapisano ${OUT}.`);
}

function round(x: number, d: number): number {
  return Math.round(x * 10 ** d) / 10 ** d;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
