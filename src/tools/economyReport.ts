/**
 * Raport ekonomii (etap 6): 10 sezonów prostego ośrodka na prawdziwym terenie Pilska – orczyk
 * Korbielów – Buczynka (ok. 790–1010 m, wzdłuż prawdziwej kanapy Jontek–Buczynka), dwie trasy, parking. Tryb kariery, gra bez
 * grafiki (ten sam kod co w przeglądarce): pogoda, śnieg na mapie, konkurencja, popyt, karnety,
 * koszty. Dni z gośćmi – model zgrubny; soboty stycznia i lutego – pełna symulacja gości (porównanie).
 *
 * Uruchomienie: npm run economy-report [plik wyjściowy] – domyślnie reports/raport-ekonomii.html.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import climateJson from '../../data/climate/pilsko.json';
import constructionJson from '../../data/construction.json';
import economyJson from '../../data/economy.json';
import snowmakingJson from '../../data/snowmaking.json';
import guestsJson from '../../data/guests.json';
import liftsJson from '../../data/lifts.json';
import pistesJson from '../../data/pistes.json';
import radiationJson from '../../data/radiation.json';
import settingsJson from '../../data/settings.json';
import snowJson from '../../data/snow.json';
import wxJson from '../../data/weather-generator.json';
import { weekdayIndex } from '../sim/calendar';
import { parseClimateProfile } from '../sim/climate';
import type { SeasonReport } from '../sim/economy';
import { COST_KEYS, FLOW_NAMES, REVENUE_KEYS, debtOf, fmtPln, objectCosts, reputationOf, sumCosts, sumRevenue } from '../sim/economy';
import { parseEconomyParams, withSnowmaking } from '../sim/economyParams';
import { acquireGroomer, infraFacts } from '../sim/operations';
import { pipelineHydrants } from '../sim/snowmaking';
import { parseSnowmakingParams } from '../sim/snowmakingParams';
import { puwg92ToLatLon } from '../sim/geo';
import { parseGroundParams } from '../sim/ground';
import { parseGuestParams } from '../sim/guestParams';
import { HeadlessGame } from '../sim/headlessGame';
import type { HorizonField } from '../sim/horizon';
import { computeHorizon, parseHorizonParams } from '../sim/horizon';
import { analyzeLift, designLift, parseLiftParams } from '../sim/lifts';
import { analyzePiste, parsePisteParams } from '../sim/pistes';
import { parseRadiationParams } from '../sim/radiation';
import type { ResortLayout } from '../sim/resort';
import { parseConstructionParams } from '../sim/resort';
import { parseSimSettings } from '../sim/settings';
import { parseSnowParams } from '../sim/snow';
import { parseRidingParams } from '../sim/snowRiding';
import { TerrainGrid } from '../sim/terrainGrid';
import { computeSlopeAndAspect } from '../sim/terrainAnalysis';
import { parseWeatherParams } from '../sim/weather';
import { loadMapFromDisk } from './loadMapFromDisk';
import { esc, fmt } from './reportKit';

const OUT = process.argv[2] ?? 'reports/raport-ekonomii.html';
const SEASONS = Number(process.env.SEASONS ?? 10);
/** Etap 7: liczba zim w porównaniu z naśnieżaniem i bez. */
const WINTERS = Number(process.env.WINTERS ?? 30);
const t0 = performance.now();
const log = (s: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)} s] ${s}`);

// ------------------------------------------------------------------ teren: wycinek Pilska
const { grid: full, dem, landCover, def } = loadMapFromDisk();
const settings = parseSimSettings(settingsJson);
log('Horyzont całej mapy (cienie)…');
const hp = parseHorizonParams(radiationJson);
const fullHorizon = computeHorizon(full, dem, hp);
// Okno ok. 1,3 × 1,2 km wokół orczyka (współrzędne lokalne mapy). Wyższe linie (Hala Miziowa) są
// dla orczyka za strome w poprzek toru (przechył > 10 %) – na Pilsku jeżdżą tam kanapy i orczyki po
// łagodniejszych grzbietach, których siatka 10 m nie oddaje.
const X0 = 2150;
const Y0 = 1000;
const W = 130;
const H = 120;
const i0 = Math.floor(X0 / full.cellSizeM);
const j0 = Math.floor(Y0 / full.cellSizeM);
const z = new Float32Array(W * H);
const forest = new Float32Array(W * H);
const shrub = new Float32Array(W * H);
const dirs = fullHorizon.directions;
const horizon: HorizonField = { directions: dirs, angleDeg: new Float32Array(W * H * dirs), skyViewFactor: new Float32Array(W * H) };
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const k = j * W + i;
    const kf = (j0 + j) * full.widthCells + (i0 + i);
    z[k] = full.elevationM[kf];
    forest[k] = landCover?.forest[kf] ?? 0;
    shrub[k] = landCover?.shrub[kf] ?? 0;
    horizon.skyViewFactor[k] = fullHorizon.skyViewFactor[kf];
    for (let d = 0; d < dirs; d++) horizon.angleDeg[k * dirs + d] = fullHorizon.angleDeg[kf * dirs + d];
  }
}
const grid = new TerrainGrid(W, H, full.cellSizeM, z);
computeSlopeAndAspect(grid);
const off = (p: { xM: number; yM: number }) => ({ xM: p.xM - i0 * full.cellSizeM, yM: p.yM - j0 * full.cellSizeM });
const center = puwg92ToLatLon(full.georef!.westEastingM + full.widthM / 2, full.georef!.northNorthingM - full.heightM / 2);
const location = { latDeg: center.latDeg, lonDeg: center.lonDeg, timeZone: def.timeZone };

// ------------------------------------------------------------------ parametry
const lp = parseLiftParams(liftsJson);
const pp = parsePisteParams(pistesJson);
const gp = parseGuestParams(guestsJson);
const ep = parseEconomyParams(economyJson);
const riding = parseRidingParams(snowJson);
const clearing = parseConstructionParams(constructionJson).clearing;

// ------------------------------------------------------------------ ośrodek: orczyk + 2 trasy + parking
const bottom = off({ xM: 3000, yM: 1300 });
const top = off({ xM: 2434, yM: 1866 });
const lift = designLift(grid, lp, 'W1', 'orczyk', 'Orczyk Korbielów – Buczynka', bottom, top);
const dx = top.xM - bottom.xM;
const dy = top.yM - bottom.yM;
const len = Math.hypot(dx, dy);
const nx = -dy / len;
const ny = dx / len;
const along = (t: number, side: number) => ({ xM: bottom.xM + dx * t + nx * side, yM: bottom.yM + dy * t + ny * side });
const pisteCtx = { grid, params: pp, forest, shrub, clearingCost: clearing };
function pisteAt(id: string, name: string, side: number, wiggle: number, widthM: number) {
  const ts = [0.99, 0.75, 0.5, 0.25, 0.02];
  return { id, name, points: ts.map((t, i) => ({ ...along(t, i === 0 || i === ts.length - 1 ? side * 0.4 : side + (i % 2 ? wiggle : -wiggle)), widthM })) };
}
const piste1 = pisteAt('T1', 'Buczynka', 60, 20, 40);
// Druga trasa po drugiej stronie wyciągu. Na tym stoku (ok. 28 %, przy stacjach ponad 30 %) obie
// wychodzą czerwone – nawet zakosy nie dają niebieskiej (sprawdzone), więc początkujący nie mają gdzie jeździć.
const piste2 = pisteAt('T2', 'Leśna', -70, 30, 30);
const layout: ResortLayout = { version: 1, lifts: [lift], pistes: [piste1, piste2], bases: [{ id: 'B1', name: 'Parking', ...along(-0.04, 30), typeId: 'parking' }], nextId: 10 };
const la = analyzeLift(lift, { grid, params: lp, forest, shrub, clearingCost: clearing, otherLifts: [] });
if (!la.ok) throw new Error(`Orczyk niepoprawny: ${la.issues.map((i) => i.message).join('; ')}`);
const pa = [piste1, piste2].map((p) => analyzePiste(p, pisteCtx));
for (const [i, a] of pa.entries()) if (a.issues.some((x) => x.severity === 'error')) throw new Error(`Trasa ${[piste1, piste2][i].name}: ${a.issues.map((x) => x.message).join('; ')}`);
log(`Orczyk ${fmt(la.slopeLengthM, 0)} m, ${fmt(la.ground[0].elevationM, 0)}–${fmt(la.ground[la.ground.length - 1].elevationM, 0)} m; trasy: ${pa.map((a, i) => `${[piste1, piste2][i].name} ${fmt(a.lengthM, 0)} m (${pp.classes[a.classIndex].name})`).join(', ')}`);

// ------------------------------------------------------------------ gra: kariera, 10 sezonów
/** Polityka gracza: sezon otwarty od grudnia do połowy kwietnia, gdy na trasach jest śnieg (ocena ≥ 0,35). */
let openSince = 0;
const game = new HeadlessGame({
  grid,
  horizon,
  forest,
  shrub,
  profile: parseClimateProfile(climateJson),
  weatherParams: parseWeatherParams(wxJson),
  radiationParams: parseRadiationParams(radiationJson),
  snowParams: parseSnowParams(snowJson),
  guestParams: gp,
  liftParams: lp,
  pisteParams: pp,
  clearing,
  ground: parseGroundParams(constructionJson),
  riding,
  economy: ep,
  seed: settings.seed,
  location,
  mode: 'career',
  startDate: { year: 2026, month: 5, day: 1 },
  agentsOn: (d) => (d.month === 1 || d.month === 2) && weekdayIndex(d) === 5,
  policy: (g) => {
    const d = g.state.date;
    const window = d.month === 12 || d.month <= 3 || (d.month === 4 && d.day <= 15);
    if (!window) {
      g.state.seasonOpen = false;
      return;
    }
    const s = g.context(d).snow.score;
    if (!g.state.seasonOpen && s >= 0.35) {
      g.state.seasonOpen = true;
      openSince = 0;
    } else if (g.state.seasonOpen && s < 0.25 && ++openSince > 3) g.state.seasonOpen = false;
    else if (s >= 0.25) openSince = 0;
  },
});
const build = game.setLayout(layout);
log(`Budowa: ${fmtPln(build.netPln)}`);

interface AgentCmp {
  date: string;
  agents: { guests: number; rating: number; revenue: number };
  quick: { guests: number; rating: number; revenue: number };
}
const cmp: AgentCmp[] = [];
const end = { year: 2026 + SEASONS, month: 5, day: 1 };
let lastYear = 0;
game.runUntil(end, (r) => {
  const y = Number(r.record.date.slice(0, 4));
  if (y !== lastYear && r.record.date.endsWith('-01-01')) {
    lastYear = y;
    log(`${r.record.date}: saldo ${fmtPln(r.record.balancePln)}`);
  }
  if (r.record.src === 'a') {
    cmp.push({ date: r.record.date, agents: { guests: r.record.guests, rating: r.record.rating ?? 0, revenue: r.record.revenuePln }, quick: { guests: 0, rating: 0, revenue: 0 } });
  }
});
log(`Gotowe: ${game.state.history.length} sezonów, saldo ${fmtPln(game.state.balancePln)}`);

// Porównanie: te same dni modelem zgrubnym (osobna gra z tym samym seedem, bez agentów).
log('Porównanie dni z gośćmi i modelu zgrubnego…');
const quickDays = new Map<string, { guests: number; rating: number; revenue: number }>();
{
  const g2 = new HeadlessGame({ ...game.o, agentsOn: undefined, policy: game.o.policy });
  openSince = 0;
  g2.setLayout(layout);
  const want = new Set(cmp.map((c) => c.date));
  const last = cmp[cmp.length - 1]?.date;
  if (last) {
    const [y, m, d] = last.split('-').map(Number);
    g2.runUntil({ year: y, month: m, day: d + 1 > 28 ? 28 : d + 1 }, (r) => {
      if (want.has(r.record.date)) quickDays.set(r.record.date, { guests: r.record.guests, rating: r.record.rating ?? 0, revenue: r.record.revenuePln });
    });
  }
}
for (const c of cmp) c.quick = quickDays.get(c.date) ?? c.quick;

// ------------------------------------------------------------------ etap 7: ten sam ośrodek z naśnieżaniem
const sp = parseSnowmakingParams(snowmakingJson);
const epS = withSnowmaking(ep, sp);
/** Ośrodek z systemem naśnieżania: ujęcie, zbiornik, pompownia, przyłącze, garaż; rurociąg wzdłuż każdej trasy, armatki na hydrantach. */
function snowLayout(): ResortLayout {
  const l = JSON.parse(JSON.stringify(layout)) as ResortLayout;
  const b = along(-0.03, -20);
  l.buildings = [
    { id: 'S1', typeId: 'intake', name: 'Ujęcie z potoku', xM: b.xM - 40, yM: b.yM + 20 },
    { id: 'S2', typeId: 'reservoir50', name: 'Zbiornik', xM: b.xM - 20, yM: b.yM + 50 },
    { id: 'S3', typeId: 'pump300', name: 'Pompownia', xM: b.xM, yM: b.yM },
    { id: 'S4', typeId: 'grid1000', name: 'Przyłącze', xM: b.xM + 30, yM: b.yM + 30 },
    { id: 'S5', typeId: 'garage', name: 'Garaż ratraków', xM: b.xM + 60, yM: b.yM + 10 },
    // Punkt kotwienia wyciągarki przy górnej stacji (strome odcinki przy stacjach – ponad 40 %).
    { id: 'S6', typeId: 'anchor', name: 'Punkt kotwienia', ...along(1.0, 0) },
  ];
  l.pipelines = [];
  l.snowGuns = [];
  let id = 50;
  for (const [i, a] of pa.entries()) {
    const ax = [...a.axis].filter((q) => !Number.isNaN(q.elevationM));
    if (ax[0].elevationM > ax[ax.length - 1].elevationM) ax.reverse(); // od dołu w górę
    const pts = [{ xM: b.xM, yM: b.yM }];
    const step = Math.max(1, Math.floor(ax.length / 10));
    for (let k = 0; k < ax.length; k += step) {
      // Skraj trasy (hydranty z boku), ok. 0,35 szerokości od osi.
      const q = ax[k];
      const r = ax[Math.min(ax.length - 1, k + 1)];
      const d = Math.hypot(r.xM - q.xM, r.yM - q.yM) || 1;
      const side = (i === 0 ? 1 : -1) * q.widthM * 0.35;
      pts.push({ xM: q.xM - ((r.yM - q.yM) / d) * side, yM: q.yM + ((r.xM - q.xM) / d) * side });
    }
    const pipe = { id: `R${id++}`, name: `Rurociąg ${i + 1}`, points: pts };
    l.pipelines.push(pipe);
    for (const h of pipelineHydrants(pipe, sp)) {
      // Armatki na hydrantach przy trasie (od pierwszych 60 m za pompownią), na przemian śmigłowa i lanca.
      if (Math.hypot(h.xM - b.xM, h.yM - b.yM) < 60) continue;
      l.snowGuns.push({ id: `A${id++}`, typeId: h.index % 2 ? 'lance' : 'fan', pipelineId: pipe.id, hydrant: h.index });
    }
  }
  l.nextId = id + 10;
  return l;
}
const snowL = snowLayout();
interface WinterRun {
  seasons: SeasonReport[];
  investPln: number;
  snowInvestPln: number;
  snowHa: number;
}
/** Piaskownica (budowa od razu, bez limitu pieniędzy), te same zasady otwierania sezonu, model zgrubny dni. */
function runWinters(withSnow: boolean): WinterRun {
  const e = withSnow ? epS : ep;
  const g = new HeadlessGame({ ...game.o, economy: e, mode: 'sandbox', agentsOn: undefined });
  const L = withSnow ? snowL : layout;
  g.setLayout(L);
  const costs = objectCosts(L, (g as unknown as { analysis: Parameters<typeof objectCosts>[1] }).analysis, e);
  const investPln = costs.reduce((a, c) => a + c.costPln, 0);
  const snowInvestPln = costs.filter((c) => c.kind === 'pipeline' || c.kind === 'gun' || ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].includes(c.id)).reduce((a, c) => a + c.costPln, 0);
  let snowHa = 0;
  if (withSnow) {
    const an = (g as unknown as { analysis: Parameters<typeof infraFacts>[1] }).analysis;
    const inf = infraFacts(L, an, g.state, sp, grid);
    acquireGroomer(g.state, 'winch', false, inf.garageSlots, sp);
    const pistesWithGuns = new Set(inf.guns.map((x) => x.pisteId));
    for (const [i, p] of [piste1, piste2].entries()) if (pistesWithGuns.has(p.id)) snowHa += pa[i].areaM2 / 10000;
  }
  openSince = 0;
  g.runUntil({ year: 2026 + WINTERS, month: 5, day: 1 });
  return { seasons: g.state.history, investPln, snowInvestPln, snowHa };
}
log(`${WINTERS} zim bez naśnieżania…`);
const winA = runWinters(false);
log(`${WINTERS} zim z naśnieżaniem (${snowL.snowGuns!.length} armatek)…`);
const winB = runWinters(true);
log('Gotowe porównanie zim.');

// ------------------------------------------------------------------ HTML
const hist = game.state.history;
const seasonName = (s: SeasonReport) => `${s.startYear}/${String((s.startYear + 1) % 100).padStart(2, '0')}`;
const opResult = (s: SeasonReport) => sumRevenue(s.flows) - sumCosts(s.flows);
const rows = hist
  .map(
    (s) => `<tr><td>${seasonName(s)}</td><td>${s.openDays}</td><td>${s.guests.toLocaleString('pl-PL')}</td><td>${s.meanRating === null ? '–' : fmt(s.meanRating, 2)}</td><td>${fmtPln(sumRevenue(s.flows))}</td><td>${fmtPln(sumCosts(s.flows))}</td><td class="${opResult(s) >= 0 ? 'ok' : 'bad'}">${fmtPln(opResult(s))}</td><td>${fmtPln(s.flows.construction)}</td><td>${fmtPln(s.balanceEnd)}</td><td>${fmt(s.reputationEnd, 2)}</td></tr>`,
  )
  .join('');
const n = hist.length;
const avg = (f: (s: SeasonReport) => number) => hist.reduce((a, s) => a + f(s), 0) / Math.max(1, n);
const flowRows = (keys: readonly string[]) =>
  keys
    .map((k) => `<tr><td>${FLOW_NAMES[k as keyof typeof FLOW_NAMES]}</td><td>${fmtPln(avg((s) => s.flows[k as keyof typeof s.flows]))}</td></tr>`)
    .join('');
const compRows = ep.competitors.list
  .map((c, i) => `<tr><td>${esc(c.name)}</td><td>${fmt(c.bottomM, 0)}–${fmt(c.topM, 0)} m</td><td>${fmt(c.pisteKm, 1)} km</td><td>${c.dayPln} zł</td><td>${fmt(avg((s) => s.competitors[i].openDays), 0)}</td><td>${Math.round(avg((s) => s.competitors[i].guests)).toLocaleString('pl-PL')}</td></tr>`)
  .join('');

function barChart(values: number[], labels: string[], unit: string, color: string, w = 640, h = 220): string {
  const pad = { l: 60, r: 10, t: 16, b: 28 };
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const minV = Math.min(0, ...values);
  const span = Math.max(...values, 0) - minV || 1;
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const y = (v: number) => pad.t + ph * (1 - (v - minV) / span);
  const bw = pw / values.length;
  let s = `<svg viewBox="0 0 ${w} ${h}" class="chart">`;
  s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
  values.forEach((v, i) => {
    s += `<rect x="${pad.l + i * bw + bw * 0.15}" y="${Math.min(y(0), y(v))}" width="${bw * 0.7}" height="${Math.abs(y(v) - y(0))}" fill="${v < 0 ? 'var(--bad)' : color}" rx="2"><title>${labels[i]}: ${fmt(v, 0)} ${unit}</title></rect>`;
    s += `<text x="${pad.l + (i + 0.5) * bw}" y="${h - 8}" class="tick" text-anchor="middle">${labels[i]}</text>`;
  });
  s += `<text x="${pad.l - 6}" y="${pad.t + 8}" class="tick" text-anchor="end">${fmt(Math.max(...values, 0), 0)}</text><text x="${pad.l - 6}" y="${y(minV)}" class="tick" text-anchor="end">${fmt(minV, 0)}</text>`;
  s += `<text x="${pad.l}" y="${pad.t - 4}" class="unit">${unit}</text></svg>`;
  void max;
  return s;
}

function dailyChart(s: SeasonReport): string {
  const days = s.days.filter((d) => Number(d.date.slice(5, 7)) >= 11 || Number(d.date.slice(5, 7)) <= 4);
  const w = 900;
  const h = 240;
  const pad = { l: 50, r: 50, t: 16, b: 28 };
  const maxG = Math.max(1, ...days.map((d) => Math.max(d.guests, ...d.compGuests.slice(2, 3))));
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / Math.max(1, days.length - 1)) * pw;
  const yG = (v: number) => pad.t + ph * (1 - v / maxG);
  const yS = (v: number) => pad.t + ph * (1 - v);
  let svg = `<svg viewBox="0 0 ${w} ${h}" class="chart">`;
  days.forEach((d, i) => {
    if (d.open) svg += `<rect x="${x(i) - 1}" y="${yG(d.guests)}" width="2.2" height="${pad.t + ph - yG(d.guests)}" fill="${d.src === 'a' ? 'var(--c2)' : 'var(--c1)'}"><title>${d.date} ${esc(d.label)}: ${d.guests} gości</title></rect>`;
  });
  svg += `<polyline fill="none" stroke="var(--forest)" stroke-width="1.5" points="${days.map((d, i) => `${x(i)},${yS(d.snowScore)}`).join(' ')}"/>`;
  svg += `<polyline fill="none" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" points="${days.map((d, i) => `${x(i)},${yG(d.compGuests[2] ?? 0)}`).join(' ')}"/>`;
  days.forEach((d, i) => {
    if (d.date.endsWith('-01')) svg += `<text x="${x(i)}" y="${h - 8}" class="tick">${d.date.slice(5, 7)}.${d.date.slice(2, 4)}</text>`;
  });
  svg += `<text x="${pad.l - 6}" y="${pad.t + 8}" class="tick" text-anchor="end">${Math.round(maxG)}</text><text x="${w - pad.r + 6}" y="${pad.t + 8}" class="tick">śnieg 1</text>`;
  svg += `<text x="${pad.l}" y="${pad.t - 4}" class="unit">goście/dzień</text></svg>`;
  return `<div class="legend"><span><i style="background:var(--c1)"></i>goście (model zgrubny)</span><span><i style="background:var(--c2)"></i>goście (pełna symulacja – soboty I–II)</span><span><i style="background:var(--forest)"></i>ocena śniegu na trasach 0–1</span><span><i style="background:var(--muted)"></i>${esc(ep.competitors.list[2].name)} (mały konkurent, goście)</span></div>${svg}`;
}

const best = hist.reduce((a, s) => (s.guests > a.guests ? s : a), hist[0]);
const worst = hist.reduce((a, s) => (s.guests < a.guests ? s : a), hist[0]);
const totalOp = hist.reduce((a, s) => a + opResult(s), 0);
const invest = hist.reduce((a, s) => a + s.flows.construction, 0);
const cmpRows = cmp
  .slice(0, 30)
  .map((c) => `<tr><td>${c.date}</td><td>${c.agents.guests}</td><td>${c.quick.guests}</td><td>${fmt(c.agents.rating, 2)}</td><td>${fmt(c.quick.rating, 2)}</td><td>${fmtPln(c.agents.revenue)}</td><td>${fmtPln(c.quick.revenue)}</td></tr>`)
  .join('');
const meanRatingA = cmp.length ? cmp.reduce((a, c) => a + c.agents.rating, 0) / cmp.length : 0;
const meanRatingQ = cmp.length ? cmp.reduce((a, c) => a + c.quick.rating, 0) / cmp.length : 0;
const revPerGuestA = cmp.reduce((a, c) => a + c.agents.revenue, 0) / Math.max(1, cmp.reduce((a, c) => a + c.agents.guests, 0));
const revPerGuestQ = cmp.reduce((a, c) => a + c.quick.revenue, 0) / Math.max(1, cmp.reduce((a, c) => a + c.quick.guests, 0));

// ---- etap 7: zimy z naśnieżaniem i bez, kalibracja
const nW = Math.min(winA.seasons.length, winB.seasons.length);
const pairs = Array.from({ length: nW }, (_, i) => ({ a: winA.seasons[i], b: winB.seasons[i] }));
const meanOf = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
const sorted = [...pairs].sort((x, y) => x.a.openDays - y.a.openDays || x.a.startYear - y.a.startYear);
const third = Math.max(1, Math.floor(nW / 3));
const weak = sorted.slice(0, third);
const strong = sorted.slice(nW - third);
const gainOf = (xs: typeof pairs) => meanOf(xs.map((p) => p.b.openDays - p.a.openDays));
const sumDays = (s: SeasonReport, k: 'snowM3' | 'waterM3' | 'snowKWh' | 'fuelL') => s.days.reduce((a, d) => a + (d[k] ?? 0), 0);
const bSeasons = pairs.map((p) => p.b);
const snowM3 = meanOf(bSeasons.map((s) => sumDays(s, 'snowM3')));
const waterM3 = meanOf(bSeasons.map((s) => sumDays(s, 'waterM3')));
const snowKWh = meanOf(bSeasons.map((s) => sumDays(s, 'snowKWh')));
const fuelL = meanOf(bSeasons.map((s) => sumDays(s, 'fuelL')));
const guestsB = meanOf(bSeasons.map((s) => s.guests));
const opCostSnow = meanOf(bSeasons.map((s) => s.flows.snowEnergy + s.flows.water));
const amortYears = 20;
const fullCostSnow = opCostSnow + winB.snowInvestPln / amortYears + winB.snowInvestPln * (ep.costs.maintenanceBuildingsRatePerYear + ep.costs.insuranceRatePerYear);
const cal = sp.calibration;
const eurPln = cal.plnPerEur;
const ratio = (game: number, data: number) => (data > 0 ? game / data : 0);
const calRows: [string, number, number, string, string][] = [
  ['Woda na hektar naśnieżanej trasy w sezonie', waterM3 / Math.max(0.01, winB.snowHa), cal.waterM3PerHa, 'm³/ha', 'koncepcja – dane do kalibracji'],
  ['Energia naśnieżania na hektar w sezonie', snowKWh / Math.max(0.01, winB.snowHa), cal.energyKWhPerHa, 'kWh/ha', 'koncepcja – dane do kalibracji'],
  ['Energia naśnieżania na wizytę narciarza', snowKWh / Math.max(1, guestsB), cal.energyKWhPerVisit, 'kWh', 'koncepcja – dane do kalibracji'],
  ['Koszt śniegu – samo działanie (energia, woda)', opCostSnow / Math.max(1, snowM3), Number.NaN, 'zł/m³', 'dla porównania: dane podają pełny koszt (wiersz niżej)'],
  [`Koszt śniegu – z amortyzacją (${amortYears} lat) i utrzymaniem`, fullCostSnow / Math.max(1, snowM3), cal.costEurPerM3 * eurPln, 'zł/m³', `dane: ${cal.costEurPerM3} €/m³ × ${eurPln} zł/€ (pełny koszt)`],
];
const calTable = calRows
  .map(([name, g, d, unit, src]) => {
    if (Number.isNaN(d)) return `<tr><td>${name}</td><td>${fmt(g, g < 100 ? 1 : 0)} ${unit}</td><td>–</td><td>–</td><td class="small muted">${esc(src)}</td></tr>`;
    const r = ratio(g, d);
    const ok = r >= 0.3 && r <= 3;
    return `<tr><td>${name}</td><td>${fmt(g, g < 100 ? 1 : 0)} ${unit}</td><td>${fmt(d, d < 100 ? 1 : 0)} ${unit}</td><td class="${ok ? 'ok' : 'bad'}">× ${fmt(r, 2)}</td><td class="small muted">${esc(src)}</td></tr>`;
  })
  .join('');
const winterRows = pairs
  .map((p) => {
    const tech = p.b.days.filter((d) => d.techOpen).length;
    return `<tr><td>${seasonName(p.a)}</td><td>${p.a.openDays}</td><td>${p.b.openDays}</td><td class="${p.b.openDays >= p.a.openDays ? 'ok' : 'bad'}">${p.b.openDays - p.a.openDays >= 0 ? '+' : ''}${p.b.openDays - p.a.openDays}</td><td>${tech}</td><td>${p.a.guests.toLocaleString('pl-PL')}</td><td>${p.b.guests.toLocaleString('pl-PL')}</td><td>${fmt(sumDays(p.b, 'snowM3'), 0)}</td><td>${fmtPln(opResult(p.a))}</td><td>${fmtPln(opResult(p.b))}</td></tr>`;
  })
  .join('');
const opA = meanOf(pairs.map((p) => opResult(p.a)));
const opB = meanOf(pairs.map((p) => opResult(p.b)));
const snowExtraInvest = winB.investPln - winA.investPln + sp.groomers.types.find((t) => t.winch)!.pricePln;
/** Utrzymanie i ubezpieczenie instalacji naśnieżania rocznie (w piaskownicy nie wchodzą do wyniku dnia). */
const snowFixedPln = snowExtraInvest * (ep.costs.maintenanceBuildingsRatePerYear + ep.costs.insuranceRatePerYear);
const netGain = opB - opA - snowFixedPln;
const payback = netGain > 0 ? snowExtraInvest / netGain : Infinity;
/** Wykres: dni otwarte w każdej zimie (posortowane od najsłabszej naturalnej), bez i z naśnieżaniem. */
function winterChart(): string {
  const w = 900;
  const h = 230;
  const pad = { l: 40, r: 10, t: 14, b: 26 };
  const max = Math.max(10, ...pairs.map((p) => Math.max(p.a.openDays, p.b.openDays)));
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const bw = pw / Math.max(1, sorted.length);
  const y = (v: number) => pad.t + ph * (1 - v / max);
  let svg = `<svg viewBox="0 0 ${w} ${h}" class="chart">`;
  sorted.forEach((p, i) => {
    const x = pad.l + i * bw;
    svg += `<rect x="${x + bw * 0.1}" y="${y(p.b.openDays)}" width="${bw * 0.8}" height="${pad.t + ph - y(p.b.openDays)}" fill="var(--c1)" rx="2"><title>${seasonName(p.b)} z naśnieżaniem: ${p.b.openDays} dni</title></rect>`;
    svg += `<rect x="${x + bw * 0.28}" y="${y(p.a.openDays)}" width="${bw * 0.44}" height="${pad.t + ph - y(p.a.openDays)}" fill="var(--forest)" rx="2"><title>${seasonName(p.a)} bez naśnieżania: ${p.a.openDays} dni</title></rect>`;
  });
  svg += `<text x="${pad.l - 6}" y="${pad.t + 8}" class="tick" text-anchor="end">${max}</text><text x="${pad.l - 6}" y="${pad.t + ph}" class="tick" text-anchor="end">0</text>`;
  svg += `<text x="${pad.l}" y="${h - 8}" class="tick">najsłabsza zima (śnieg naturalny)</text><text x="${w - pad.r}" y="${h - 8}" class="tick" text-anchor="end">najlepsza</text>`;
  svg += `<text x="${pad.l}" y="${pad.t - 4}" class="unit">dni otwarte w sezonie</text></svg>`;
  return `<div class="legend"><span><i style="background:var(--forest)"></i>bez naśnieżania</span><span><i style="background:var(--c1)"></i>z naśnieżaniem</span></div>${svg}`;
}
log(`Naśnieżanie (${nW} zim): dni otwarte ${fmt(meanOf(pairs.map((p) => p.a.openDays)), 1)} → ${fmt(meanOf(pairs.map((p) => p.b.openDays)), 1)}; słabe zimy +${fmt(gainOf(weak), 1)}, mocne +${fmt(gainOf(strong), 1)}; goście ${fmt(meanOf(pairs.map((p) => p.a.guests)), 0)} → ${fmt(meanOf(pairs.map((p) => p.b.guests)), 0)}; wynik ${fmtPln(opA)} → ${fmtPln(opB)}; inwestycja ${fmtPln(snowExtraInvest)}, stałe ${fmtPln(snowFixedPln)}/rok; zwrot ${Number.isFinite(payback) ? fmt(payback, 1) + ' lat' : '—'}`);
for (const [name, g, d, unit] of calRows) log(`  kalibracja: ${name}: gra ${fmt(g, 1)} ${unit}${Number.isNaN(d) ? '' : `, dane ${fmt(d, 1)} ${unit} (× ${fmt(ratio(g, d), 2)})`}`);
const gunsN = snowL.snowGuns!.length;
const fansN = snowL.snowGuns!.filter((g) => g.typeId === 'fan').length;
const totalS = (performance.now() - t0) / 1000;

const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raport ekonomii</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d2329;--muted:#5d6670;--grid:#e3e1db;--card:#ffffff;--c1:#1f6fd1;--c2:#d1495b;--forest:#3f7a3a;--ok:#1e7d3c;--bad:#b3261e}
@media (prefers-color-scheme: dark){:root{--bg:#16191d;--fg:#e9ecef;--muted:#a3abb4;--grid:#2c3238;--card:#1e2227;--c1:#5aa0ff;--c2:#ff7a8a;--forest:#7cc07a;--ok:#5cc87a;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{margin-top:36px;font-size:20px}
.muted{color:var(--muted)}.small{font-size:13px}.card{background:var(--card);border:1px solid var(--grid);border-radius:12px;padding:14px 16px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:800px){.grid2{grid-template-columns:1fr}}
table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}td,th{padding:4px 6px;border-bottom:1px solid var(--grid);text-align:right}td:first-child,th:first-child{text-align:left}
.table-wrap{overflow-x:auto}.ok{color:var(--ok)}.bad{color:var(--bad)}
.chart{width:100%;height:auto}.chart .tick{font-size:11px;fill:var(--muted)}.chart .unit{font-size:11px;fill:var(--muted)}.chart .zero{stroke:var(--muted)}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12.5px;color:var(--muted)}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}.kpis div{background:var(--card);border:1px solid var(--grid);border-radius:12px;padding:10px 12px}.kpis b{display:block;font-size:22px}
@media(max-width:700px){.kpis{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main>
<h1>Raport ekonomii – ${n} sezonów prostego ośrodka i naśnieżanie</h1>
<p class="muted">Tryb kariery, kapitał startowy ${fmtPln(ep.career.startCapitalPln)}, start 1 maja 2026. Ośrodek: <b>${esc(lift.name)}</b> (orczyk, ${fmt(la.slopeLengthM, 0)} m, ${fmt(la.ground[0].elevationM, 0)}–${fmt(la.ground[la.ground.length - 1].elevationM, 0)} m n.p.m., ${fmt(lp.types.find((t) => t.id === 'orczyk')!.capacityPerHour, 0)} os./h), trasy ${pa.map((a, i) => `${[piste1, piste2][i].name} ${fmt(a.lengthM, 0)} m – ${pp.classes[a.classIndex].name}`).join(', ')}, parking na ${ep.buildings[0].cars} aut. Bez naśnieżania i bez ratraków – tylko śnieg naturalny z modelu śniegu na mapie (ten sam ośrodek z naśnieżaniem – część 6). Gracz otwiera sezon od grudnia do połowy kwietnia, gdy na trasach jest śnieg, i zamyka po 3 dniach bez śniegu. Ceny domyślne: dzienny ${ep.passes.dayPln} zł, 4 h ${ep.passes.fourHourPln} zł, 2 h ${ep.passes.twoHourPln} zł.</p>
<div class="kpis">
<div><span class="muted small">wynik operacyjny (10 lat)</span><b class="${totalOp >= 0 ? 'ok' : 'bad'}">${fmtPln(totalOp)}</b></div>
<div><span class="muted small">inwestycja (budowa)</span><b>${fmtPln(invest)}</b></div>
<div><span class="muted small">saldo na koniec</span><b>${fmtPln(game.state.balancePln)}</b></div>
<div><span class="muted small">reputacja na koniec</span><b>${fmt(reputationOf(game.state, ep), 2)} ★</b></div>
<div><span class="muted small">średnio dni otwartych</span><b>${fmt(avg((s) => s.openDays), 0)}</b></div>
<div><span class="muted small">średnio gości na sezon</span><b>${Math.round(avg((s) => s.guests)).toLocaleString('pl-PL')}</b></div>
<div><span class="muted small">przychód na gościa</span><b>${fmt(avg((s) => sumRevenue(s.flows)) / Math.max(1, avg((s) => s.guests)), 0)} zł</b></div>
<div><span class="muted small">kredyt na koniec</span><b>${fmtPln(debtOf(game.state))}</b></div>
</div>
<p><b>Ważne:</b> obie trasy są czerwone (stok ok. 28 %), a ok. jedna trzecia gości to początkujący (${Math.round(gp.skills[0].share * 100)} % dorosłych i większość dzieci w rodzinach i grupach szkolnych) – nie mają tu trasy na swój poziom, odjeżdżają od razu bez karnetu i są rozczarowani (ocena 2/5). To obniża średnią ocenę i reputację ośrodka; w grze warto mieć łagodną trasę lub taśmę dla początkujących.</p>
<p>Ocena: ${totalOp > invest ? 'ośrodek <b>zwraca inwestycję</b> w ciągu dziesięciu lat' : totalOp > 0 ? 'ośrodek <b>zarabia na działalności</b>, ale w 10 lat nie zwraca całej inwestycji' : 'ośrodek <b>traci na działalności</b> – bez naśnieżania sezon jest za krótki'}; najlepszy sezon ${seasonName(best)} (${best.guests.toLocaleString('pl-PL')} gości, ${best.openDays} dni), najsłabszy ${seasonName(worst)} (${worst.guests.toLocaleString('pl-PL')} gości, ${worst.openDays} dni). Liczba dni otwartych zależy wprost od śniegu naturalnego.</p>

<h2>1. Sezon po sezonie</h2>
<div class="card table-wrap"><table><thead><tr><th>sezon</th><th>dni otw.</th><th>goście</th><th>ocena</th><th>przychody</th><th>koszty</th><th>wynik</th><th>budowa</th><th>saldo na koniec</th><th>reputacja</th></tr></thead><tbody>${rows}</tbody></table>
<p class="small muted">Rok gry od 1 maja do 30 kwietnia. Wynik = przychody − koszty działalności (bez budowy i kredytu). Saldo zawiera wydatki na budowę.</p></div>
<div class="grid2" style="margin-top:16px">
<div class="card"><b>Goście w sezonie</b>${barChart(hist.map((s) => s.guests), hist.map((s) => seasonName(s)), 'osób', 'var(--c1)')}</div>
<div class="card"><b>Wynik działalności</b>${barChart(hist.map((s) => opResult(s) / 1000), hist.map((s) => seasonName(s)), 'tys. zł', 'var(--ok)')}</div>
</div>

<h2>2. Przychody i koszty – średnio na sezon</h2>
<div class="grid2"><div class="card"><b>Przychody</b><table><tbody>${flowRows(REVENUE_KEYS)}<tr><td><b>razem</b></td><td><b>${fmtPln(avg((s) => sumRevenue(s.flows)))}</b></td></tr></tbody></table></div>
<div class="card"><b>Koszty</b><table><tbody>${flowRows(COST_KEYS)}<tr><td><b>razem</b></td><td><b>${fmtPln(avg((s) => sumCosts(s.flows)))}</b></td></tr></tbody></table>
<p class="small muted">Bez ratraków i naśnieżania – ich koszty w części 6.</p></div></div>

<h2>3. Dzień po dniu – sezon ${seasonName(best)} (najlepszy) i ${seasonName(worst)} (najsłabszy)</h2>
<div class="card">${dailyChart(best)}</div>
<div class="card" style="margin-top:12px">${dailyChart(worst)}</div>
<p class="small muted">Widać weekendy (wyższe słupki), ferie śląskie i małopolskie (II), święta (koniec XII) oraz przerwy, gdy śniegu brakuje (ocena śniegu spada – gracz zamyka).</p>

<h2>4. Konkurencja (średnio na sezon)</h2>
<div class="card table-wrap"><table><thead><tr><th>ośrodek</th><th>wysokość</th><th>trasy</th><th>karnet dzienny</th><th>dni otw.</th><th>goście</th></tr></thead><tbody>
<tr><td><b>nasz</b></td><td>${fmt(la.ground[0].elevationM, 0)}–${fmt(la.ground[la.ground.length - 1].elevationM, 0)} m</td><td>${fmt(pa.reduce((a, x) => a + x.lengthM, 0) / 1000, 1)} km</td><td>${ep.passes.dayPln} zł</td><td>${fmt(avg((s) => s.openDays), 0)}</td><td>${Math.round(avg((s) => s.guests)).toLocaleString('pl-PL')}</td></tr>
${compRows}</tbody></table><p class="small muted">Konkurenci naśnieżają (${fmt(ep.competitors.snowmakingMmPerDay, 0)} mm wody/dzień przy średniej dobowej ≤ ${ep.competitors.snowmakingMaxTempC} °C) – stąd dłuższy sezon niż nasz na samym śniegu naturalnym. Nazwy wymyślone, wielkość i ceny wzorowane na ośrodkach Beskidów.</p></div>

<h2>5. Pełna symulacja gości a model zgrubny (te same dni)</h2>
<div class="card table-wrap"><table><thead><tr><th>dzień</th><th>goście (symulacja)</th><th>goście (zgrubny)</th><th>ocena (symulacja)</th><th>ocena (zgrubny)</th><th>przychód (symulacja)</th><th>przychód (zgrubny)</th></tr></thead><tbody>${cmpRows}</tbody></table>
<p class="small">Średnio: ocena ${fmt(meanRatingA, 2)} (symulacja) wobec ${fmt(meanRatingQ, 2)} (zgrubny); przychód na gościa ${fmt(revPerGuestA, 0)} zł wobec ${fmt(revPerGuestQ, 0)} zł. Liczba gości jest ta sama (wynika z popytu), różnią się wynik dnia i ocena. Dni przewijane w grze liczą się modelem zgrubnym, dni oglądane – symulacją gości.</p></div>

<h2>6. Naśnieżanie i ratraki – ten sam ośrodek, ${nW} zim z naśnieżaniem i bez</h2>
<p>Ośrodek jak wyżej + system naśnieżania: ujęcie z potoku (${fmt(sp.buildings.find((b) => b.id === 'intake')!.capacity, 0)} m³/h latem), zbiornik ${fmt(sp.buildings.find((b) => b.id === 'reservoir50')!.capacity, 0)} m³, pompownia ${fmt(sp.buildings.find((b) => b.id === 'pump300')!.capacity, 0)} m³/h, przyłącze ${fmt(sp.buildings.find((b) => b.id === 'grid1000')!.capacity, 0)} kW, rurociągi wzdłuż obu tras z hydrantami co ${sp.pipe.hydrantSpacingM} m i ${gunsN} armatek (${fansN} śmigłowych, ${gunsN - fansN} lanc), garaż, punkt kotwienia przy górnej stacji i jeden ratrak z wyciągarką (strome odcinki przy stacjach). Naśnieżana powierzchnia ${fmt(winB.snowHa, 1)} ha. Inwestycja w naśnieżanie ${fmtPln(winB.snowInvestPln)} (cały ośrodek ${fmtPln(winB.investPln)}; ratrak ${fmtPln(sp.groomers.types.find((t) => t.winch)!.pricePln)} osobno). Plan naśnieżania domyślny (docelowa baza 50 cm, automat od listopada do marca), plan nocy automatyczny. Te same zasady otwierania sezonu co wyżej; tryb piaskownicy (budowa od razu, bez limitu pieniędzy), dni liczone modelem zgrubnym.</p>
<div class="kpis">
<div><span class="muted small">dni otwarte – bez naśnieżania</span><b>${fmt(meanOf(pairs.map((p) => p.a.openDays)), 1)}</b></div>
<div><span class="muted small">dni otwarte – z naśnieżaniem</span><b>${fmt(meanOf(pairs.map((p) => p.b.openDays)), 1)}</b></div>
<div><span class="muted small">zysk dni w 1/3 najsłabszych zim</span><b class="ok">+${fmt(gainOf(weak), 1)}</b></div>
<div><span class="muted small">zysk dni w 1/3 najlepszych zim</span><b>+${fmt(gainOf(strong), 1)}</b></div>
<div><span class="muted small">wynik działalności / sezon – bez</span><b class="${opA >= 0 ? 'ok' : 'bad'}">${fmtPln(opA)}</b></div>
<div><span class="muted small">wynik działalności / sezon – z</span><b class="${opB >= 0 ? 'ok' : 'bad'}">${fmtPln(opB)}</b></div>
<div><span class="muted small">dodatkowa inwestycja</span><b>${fmtPln(snowExtraInvest)}</b></div>
<div><span class="muted small">zwrot naśnieżania (prosty)</span><b>${Number.isFinite(payback) ? `${fmt(payback, 1)} lat` : 'nie zwraca się'}</b></div>
</div>
<p class="small muted">Zwrot = dodatkowa inwestycja (instalacja + ratrak ${fmtPln(snowExtraInvest)}) / (wynik z − wynik bez − utrzymanie i ubezpieczenie instalacji ${fmtPln(snowFixedPln)} rocznie) = ${Number.isFinite(payback) ? `${fmt(payback, 1)} lat` : 'brak zwrotu'}. W obu wariantach ten sam popyt, ceny i zasady otwierania.</p>
<div class="card">${winterChart()}<p class="small muted">Zimy posortowane od najsłabszej (najmniej dni na samym śniegu naturalnym). Naśnieżanie najbardziej wydłuża sezon w słabych zimach – w dobrych i tak jest śnieg.</p></div>
<h3>Kalibracja: gra a dane z koncepcji</h3>
<div class="card table-wrap"><table><thead><tr><th>wielkość</th><th>gra (średnio na sezon)</th><th>dane</th><th>gra / dane</th><th>źródło</th></tr></thead><tbody>${calTable}</tbody></table>
<p class="small muted">Zielone – ten sam rząd wielkości (od 0,3 do 3 razy). Średnio na sezon: śnieg ${fmt(snowM3, 0)} m³, woda ${fmt(waterM3, 0)} m³, energia naśnieżania ${fmt(snowKWh / 1000, 1)} MWh, paliwo ratraków ${fmt(fuelL, 0)} l, ${fmt(guestsB, 0)} gości. Dane z koncepcji dotyczą dużych ośrodków alpejskich (długi sezon, naśnieżanie podstawowe i uzupełniające); nasz ośrodek leży nisko (790–1010 m), więc naśnieża krócej i tylko w mroźne noce.</p></div>
<h3>Zima po zimie</h3>
<div class="card table-wrap"><table><thead><tr><th>sezon</th><th>dni bez</th><th>dni z</th><th>różnica</th><th>dni dzięki naśnieżaniu</th><th>goście bez</th><th>goście z</th><th>śnieg [m³]</th><th>wynik bez</th><th>wynik z</th></tr></thead><tbody>${winterRows}</tbody></table>
<p class="small muted">„Dni dzięki naśnieżaniu” – dni otwarte, w których na samym śniegu naturalnym ponad połowa tras miałaby zbyt cienką bazę. Wynik = przychody − koszty działalności (z energią naśnieżania, wodą, paliwem, operatorami, serwisem i naprawami ratraków; bez budowy; w piaskownicy bez utrzymania i ubezpieczenia obiektów – te liczone osobno przy zwrocie).</p></div>

<h2>7. Założenia (data/economy.json, data/snowmaking.json)</h2>
<div class="card small"><ul>
<li>Popyt: pula regionu ${ep.demand.regionPoolPerDay.toLocaleString('pl-PL')} narciarzy/dzień (sobota styczniowa) × dzień tygodnia × miesiąc × ferie/święta × prognoza; udział ośrodka = A / (A + konkurencja + inne), A = km tras<sup>${ep.demand.offerExponent}</sup> × śnieg<sup>${ep.demand.snowExponent}</sup> × (reputacja/${ep.demand.reputationRef})<sup>${ep.demand.reputationExponent}</sup> × (cena/średnia konkurencji)<sup>−${ep.demand.priceElasticity}</sup>.</li>
<li>Ferie 2026 (MEN): 19 I – mazowieckie, pomorskie, podlaskie, świętokrzyskie, warmińsko-mazurskie; 2 II – m.in. małopolskie; 16 II – m.in. śląskie. Wagi regionów: śląskie ${ep.ferie.regionWeights['śląskie']}, małopolskie ${ep.ferie.regionWeights['małopolskie']}.</li>
<li>Energia ${ep.costs.energyPlnPerKWh} zł/kWh, stawka ${ep.costs.hourlyWagePln} zł/h brutto (+${Math.round((ep.costs.employerCostFactor - 1) * 100)} % składki), ratownicy ${ep.costs.patrolHourlyPln} zł/h, przegląd orczyka ${fmtPln(ep.costs.inspectionSurfacePln)}/rok, ubezpieczenie ${ep.costs.insuranceRatePerYear * 100} %, utrzymanie wyciągów ${ep.costs.maintenanceLiftsRatePerYear * 100} % wartości rocznie, stała załoga ${ep.costs.permanentStaff} os. × ${fmtPln(ep.costs.permanentMonthlyPln)}/mies..</li>
<li>Kredyt ${fmt(ep.loan.interestRatePerYear * 100, 1)} % rocznie (WIBOR 3M + marża), do ${ep.loan.maxTermYears} lat – w tym przebiegu ${game.state.history.some((s) => s.flows.loanIn > 0) ? 'zaciągnięty' : 'niepotrzebny'}.</li>
</ul><p class="muted">Liczba gości jest „do kalibracji” – brak publicznych danych o frekwencji małych ośrodków. Czas obliczeń: ${fmt(totalS, 0)} s (teren ${W} × ${H} komórek po ${grid.cellSizeM} m).</p></div>
</main></body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
log(`Zapisano ${OUT}. Wynik 10 lat: ${fmtPln(totalOp)}, budowa ${fmtPln(invest)}, saldo ${fmtPln(game.state.balancePln)}`);
void readFileSync;
