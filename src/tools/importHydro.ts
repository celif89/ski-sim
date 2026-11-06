/**
 * Przepływy potoków w okolicy Korbielowa (etap 6b): dobowe przepływy IMGW z wodowskazów w Beskidzie
 * Żywieckim (Woda Ujsolska – Ujsoły, Koszarawa – Pewel Mała i Jeleśnia), lata hydrologiczne
 * 2011–2020 → rytm roczny: stosunek średniego przepływu w miesiącu do średniej rocznej, przepływ
 * niski (10. percentyl dobowych) względem średniej – do modelu dostępnej wody w potokach.
 *
 * Wynik: data/calibration/imgw-hydro.json. Pliki źródłowe w .cache/imgw-hydro (poza repozytorium).
 * Uruchomienie: npm run import-hydro
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE = '.cache/imgw-hydro';
const OUT = 'data/calibration/imgw-hydro.json';
const STATIONS = [
  { code: '149190040', name: 'Ujsoły', river: 'Woda Ujsolska' },
  { code: '149190150', name: 'Pewel Mała', river: 'Koszarawa' },
  { code: '149199993', name: 'Jeleśnia', river: 'Koszarawa' },
];
const YEARS = [2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020];
const BASE = 'https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/dane_hydrologiczne/dobowe';

mkdirSync(CACHE, { recursive: true });
const flows = new Map<string, { month: number; q: number }[]>();
for (const s of STATIONS) flows.set(s.code, []);
for (const y of YEARS) {
  for (let m = 1; m <= 12; m++) {
    const name = `codz_${y}_${String(m).padStart(2, '0')}`;
    const csv = `${CACHE}/${name}.csv`;
    if (!existsSync(csv)) {
      const zip = `${CACHE}/${name}.zip`;
      execSync(`curl -s -m 60 -o ${zip} ${BASE}/${y}/${name}.zip && unzip -o -q ${zip} -d ${CACHE}`);
    }
    const text = readFileSync(csv, 'latin1');
    for (const line of text.split(/\r?\n/)) {
      const c = line.split(',').map((x) => x.replace(/"/g, '').trim());
      if (c.length < 10) continue;
      const list = flows.get(c[0]);
      if (!list) continue;
      const q = Number(c[7]);
      const month = Number(c[9]); // miesiąc kalendarzowy
      if (Number.isFinite(q) && q < 99999 && q >= 0 && month >= 1 && month <= 12) list.push({ month, q });
    }
  }
  console.log(`rok hydrologiczny ${y} – gotowe`);
}

const stations = STATIONS.map((s) => {
  const list = flows.get(s.code)!;
  const mean = list.reduce((a, x) => a + x.q, 0) / Math.max(1, list.length);
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const v = list.filter((x) => x.month === i + 1).map((x) => x.q);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : Number.NaN;
  });
  const sorted = list.map((x) => x.q).sort((a, b) => a - b);
  const p10 = sorted[Math.floor(0.1 * sorted.length)] ?? Number.NaN;
  return { ...s, days: list.length, meanFlowM3s: Math.round(mean * 1000) / 1000, monthlyFactor: monthly.map((v) => Math.round((v / mean) * 1000) / 1000), lowFlowFactorP10: Math.round((p10 / mean) * 1000) / 1000 };
}).filter((s) => s.days > 300);
const usable = stations;
const avg = Array.from({ length: 12 }, (_, i) => Math.round((usable.reduce((a, s) => a + s.monthlyFactor[i], 0) / usable.length) * 1000) / 1000);
const out = {
  _opis: 'Rytm roczny przepływu potoków Beskidu Żywieckiego z dobowych przepływów IMGW (lata hydrologiczne 2011–2020): monthlyFactor – średni przepływ w miesiącu (I…XII) / średni roczny; lowFlowFactorP10 – 10. percentyl przepływów dobowych / średni. Wynik npm run import-hydro – nie edytować ręcznie.',
  source: 'IMGW-PIB, danepubliczne.imgw.pl, dane hydrologiczne dobowe (codz_RRRR_MM)',
  generated: new Date().toISOString().slice(0, 10),
  stations,
  monthlyFactorMean: avg,
  lowFlowFactorP10Mean: Math.round((usable.reduce((a, s) => a + s.lowFlowFactorP10, 0) / usable.length) * 1000) / 1000,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`Zapisano ${OUT}:`, stations.map((s) => `${s.name} (${s.river}) ${s.days} dni, średnio ${s.meanFlowM3s} m³/s, rytm ${s.monthlyFactor.join(' ')}`).join('\n'));
