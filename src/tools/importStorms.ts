/**
 * Burze latem (etap 7b): dobowe dane synoptyczne IMGW ze stacji Bielsko-Biała (350190600, 398 m –
 * najbliższa stacja synoptyczna z obserwacją burz), lata 2001–2025: w każdym miesiącu liczba dni
 * z burzą (BRZA > 0), prawdopodobieństwo burzy w dniu z opadem i bez opadu, średni czas trwania
 * i średnia temperatura maksymalna dnia z burzą – do generatora pogody letniej.
 *
 * Wynik: data/calibration/imgw-storms.json. Pliki źródłowe w .cache/imgw-synop (poza repozytorium).
 * Uruchomienie: npm run import-storms
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const CACHE = '.cache/imgw-synop';
const OUT = 'data/calibration/imgw-storms.json';
const STATION = '600';
const BASE = 'https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/dane_meteorologiczne/dobowe/synop';
const YEARS = Array.from({ length: 25 }, (_, i) => 2001 + i);

mkdirSync(CACHE, { recursive: true });
const M = Array.from({ length: 12 }, () => ({ days: 0, wet: 0, dry: 0, stormWet: 0, stormDry: 0, hours: 0, tmax: 0, tmaxAll: 0 }));
let years = 0;
for (const y of YEARS) {
  const dir = `${CACHE}/${y}`;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    const zip = `${dir}/s.zip`;
    try {
      execSync(`curl -sSf -m 120 -o ${zip} ${BASE}/${y}/${y}_${STATION}_s.zip && unzip -o -q ${zip} -d ${dir}`);
    } catch {
      console.log(`rok ${y}: brak pliku`);
      continue;
    }
  }
  const file = readdirSync(dir).find((f) => /^s_d_\d+/.test(f) && f.endsWith('.csv') && !f.includes('_t'));
  if (!file) continue;
  years++;
  for (const line of readFileSync(`${dir}/${file}`, 'latin1').split(/\r?\n/)) {
    const c = line.split(',').map((x) => x.replace(/"/g, '').trim());
    if (c.length < 52) continue;
    const m = Number(c[3]);
    if (!(m >= 1 && m <= 12)) continue;
    const tmax = Number(c[5]);
    const precip = Number(c[13]);
    const storm = Number(c[48]); // BRZA – czas trwania burzy [h] (kolumna 49, status w 50)
    const st = M[m - 1];
    st.days++;
    st.tmaxAll += tmax;
    const wet = precip >= 0.5;
    const isStorm = storm > 0 && c[49] !== '8';
    if (wet) st.wet++;
    else st.dry++;
    if (isStorm) {
      if (wet) st.stormWet++;
      else st.stormDry++;
      st.hours += storm;
      st.tmax += tmax;
    }
  }
  console.log(`rok ${y} – gotowe`);
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const months = M.map((s, i) => {
  const storms = s.stormWet + s.stormDry;
  return {
    month: i + 1,
    stormDaysPerMonth: r3((storms / Math.max(1, s.days)) * [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i]),
    pStormIfWet: r3(s.stormWet / Math.max(1, s.wet)),
    pStormIfDry: r3(s.stormDry / Math.max(1, s.dry)),
    meanHours: r3(s.hours / Math.max(1, storms)),
    meanTmaxStormC: r3(s.tmax / Math.max(1, storms)),
    meanTmaxC: r3(s.tmaxAll / Math.max(1, s.days)),
  };
});
const out = {
  _opis: 'Burze w poszczególnych miesiącach – stacja synoptyczna IMGW Bielsko-Biała (350190600, 398 m), dane dobowe (BRZA – czas trwania burzy, SMDB – opad, TMAX), lata 2001–2025. Wynik npm run import-storms – nie edytować ręcznie.',
  source: 'IMGW-PIB, danepubliczne.imgw.pl, dane meteorologiczne dobowe synop (s_d)',
  generated: new Date().toISOString().slice(0, 10),
  years: { value: years, unit: 'lat', source: 'liczba lat z danymi' },
  units: 'stormDaysPerMonth – dni z burzą w miesiącu; pStormIfWet / pStormIfDry – udział dni z burzą wśród dni z opadem ≥ 0,5 mm / bez opadu; meanHours – średni czas trwania burzy w dniu z burzą [h]; temperatury [°C]',
  months,
  stormDaysPerYear: { value: r3(months.reduce((a, m) => a + m.stormDaysPerMonth, 0)), unit: 'dni/rok', source: 'suma miesięcy' },
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(months.map((m) => `${m.month}: ${m.stormDaysPerMonth} dni, P|mokry ${m.pStormIfWet}, P|suchy ${m.pStormIfDry}, ${m.meanHours} h`).join('\n'), `\nrazem ${out.stormDaysPerYear.value} dni/rok, lat ${years}`);
