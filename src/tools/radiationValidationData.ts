/**
 * Dane do sprawdzenia modelu promieniowania: godzinne promieniowanie całkowite (pomiary
 * aktynometryczne IMGW) w Bielsku-Białej i na Kasprowym Wierchu, lata 2007–2014, oraz średnie
 * dobowe zachmurzenie z tych samych stacji synoptycznych.
 *
 * Uruchomienie:  npm run radiation-validation-data
 * Wynik: data/calibration/radiation-stations.json (sumy dobowe).
 *
 * Format plików IMGW (*.DAN): nagłówek, potem tabela „Godzinne wartosci promieniowania calkowitego”
 * – wiersz = dzień miesiąca, kolumny = godziny 04–21, wartości w J/cm² na godzinę.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { daysInMonth } from '../sim/time';
import { BASE, Store, dayKey, download, ingestDailyMain, ingestSynopT, unzipCsv } from './imgwData';

const AKTYNO = 'https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/dane_aktynometryczne';
const OUT = 'data/calibration/radiation-stations.json';
const FIRST_YEAR = 2007;
const LAST_YEAR = 2014;
/** 1 J/cm² = 10⁴ J/m² = 10⁴ / 3,6·10⁶ kWh/m². */
const KWH_PER_J_CM2 = 1e4 / 3.6e6;
const DECODER = new TextDecoder('windows-1250');

const STATIONS = [
  { name: 'Bielsko-Biała', dir: 'Bielsko-Bia%c5%82a', prefix: 'BBA', synop: '349190600', latDeg: 49 + 48 / 60 + 26 / 3600, lonDeg: 19 + 0 / 60 + 1 / 3600, elevationM: 396 },
  { name: 'Kasprowy Wierch', dir: 'Kasprowy%20Wierch', prefix: 'KAW', synop: '349190650', latDeg: 49 + 13 / 60 + 57 / 3600, lonDeg: 19 + 58 / 60 + 55 / 3600, elevationM: 1990 },
];

function log(m: string): void {
  console.log(`[radiation-validation-data] ${m}`);
}

/** Sumy dobowe [J/cm²] z tabeli promieniowania całkowitego; null, gdy dzień niepełny. */
function parseGlobalDaily(text: string): Map<number, number | null> {
  const lines = text.split(/\r?\n/);
  const out = new Map<number, number | null>();
  const start = lines.findIndex((l) => /promieniowania calkowitego/i.test(l));
  if (start < 0) return out;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/Godzinne/i.test(l)) break;
    const m = /^(\d{2})\s+(.*)$/.exec(l.trim().length ? l.replace(/^\s+/, '') : '');
    if (!m) continue;
    const values = m[2].trim().split(/\s+/).map(Number);
    if (values.length < 10) continue;
    const bad = values.some((v) => !Number.isFinite(v) || v < 0 || v > 500);
    out.set(Number(m[1]), bad ? null : values.reduce((a, b) => a + b, 0));
  }
  return out;
}

async function main(): Promise<void> {
  const result = [];
  for (const st of STATIONS) {
    const synop = new Store();
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
      const zip = await download(`${BASE}/dobowe/synop/${y}/${y}_${st.synop.slice(-3)}_s.zip`, `s_d_${y}_${st.synop.slice(-3)}.zip`);
      if (zip) for (const [name, text] of unzipCsv(zip)) (/s_d_t_/i.test(name) ? ingestSynopT : ingestDailyMain)(synop, text);
    }
    const days: [string, number, number][] = [];
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
      for (let m = 1; m <= 12; m++) {
        const file = `${st.prefix}${String(m).padStart(2, '0')}-${String(y).slice(-2)}.DAN`;
        const data = await download(`${AKTYNO}/${st.dir}/zweryfikowane/${y}/${file}`, `aktyno_${file}`);
        if (!data) continue;
        const daily = parseGlobalDaily(DECODER.decode(data));
        for (let d = 1; d <= daysInMonth(y, m); d++) {
          const sum = daily.get(d);
          const cloud = synop.stations.get(st.synop)?.get(dayKey(y, m, d))?.cloudOktas;
          if (sum === undefined || sum === null || cloud === undefined) continue;
          days.push([`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, Math.round(sum * KWH_PER_J_CM2 * 1000) / 1000, Math.round((cloud / 8) * 1000) / 1000]);
        }
      }
    }
    log(`${st.name}: ${days.length} dni z pomiarem i zachmurzeniem`);
    result.push({ name: st.name, latDeg: st.latDeg, lonDeg: st.lonDeg, elevationM: st.elevationM, days });
  }
  await mkdir('data/calibration', { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        _opis: 'Sumy dobowe promieniowania całkowitego (pomiar) i średnie dobowe zachmurzenie – do sprawdzenia modelu promieniowania. Wynik npm run radiation-validation-data.',
        source: `IMGW-PIB, dane aktynometryczne (godzinne, J/cm², zweryfikowane) ${FIRST_YEAR}–${LAST_YEAR}; zachmurzenie: dane dobowe synop (oktanty / 8). Współrzędne i wysokości stacji: zestawienie IMGW „Promieniowanie słoneczne – zakres danych”.`,
        units: 'dzień: [data, suma promieniowania całkowitego kWh/m², zachmurzenie 0–1]',
        stations: result,
      },
      null,
      0,
    ) + '\n',
  );
  log(`Zapisano ${OUT}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
