/**
 * Raport lata (etap 7b): ośrodek wielkości prawdziwego Pilska (układ z OpenStreetMap) w przeciętnej
 * zimie – rok gry bez sezonu letniego i ten sam ośrodek z sezonem letnim: koleje krzesełkowe dla
 * pieszych (wieszaki na rowery na najdłuższej), szlaki PTTK z OSM, restauracja i punkt widokowy przy
 * górnej stacji, plac zabaw przy parkingu, tor saneczkowy i trasa rowerowa. Wynik zimy, lata i koszty
 * wspólne osobno; ile lato zmienia wynik roku. Goście latem – symulacja agentów (SUMMER_AGENTS=0 –
 * model zgrubny).
 *
 * Uruchomienie: npm run summer-report [plik] – domyślnie reports/raport-lata.html.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import climateJson from '../../data/climate/pilsko.json';
import constructionJson from '../../data/construction.json';
import economyJson from '../../data/economy.json';
import guestsJson from '../../data/guests.json';
import liftsJson from '../../data/lifts.json';
import pistesJson from '../../data/pistes.json';
import radiationJson from '../../data/radiation.json';
import settingsJson from '../../data/settings.json';
import snowJson from '../../data/snow.json';
import summerJson from '../../data/summer.json';
import winterClassesJson from '../../data/winter-classes.json';
import wxJson from '../../data/weather-generator.json';
import snowmakingJson from '../../data/snowmaking.json';
import { parseClimateProfile } from '../sim/climate';
import type { Flows, SeasonReport } from '../sim/economy';
import { COST_KEYS, FLOW_NAMES, REVENUE_KEYS, fmtPln, markAllBuilt, objectCosts, sumCosts, sumRevenue, zeroFlows } from '../sim/economy';
import { parseEconomyParams, withSnowmaking, withSummer } from '../sim/economyParams';
import { puwg92ToLatLon } from '../sim/geo';
import { parseGroundParams } from '../sim/ground';
import { parseGuestParams } from '../sim/guestParams';
import { HeadlessGame } from '../sim/headlessGame';
import { computeHorizon, parseHorizonParams } from '../sim/horizon';
import type { PointM } from '../sim/lifts';
import { designLift, liftTypeById, parseLiftParams } from '../sim/lifts';
import { acquireGroomer, infraFacts } from '../sim/operations';
import { parsePisteParams } from '../sim/pistes';
import { parseRadiationParams } from '../sim/radiation';
import type { OsmResort, ResortLayout } from '../sim/resort';
import { layoutFromOsm, parseConstructionParams } from '../sim/resort';
import { parseSimSettings } from '../sim/settings';
import { parseSnowParams } from '../sim/snow';
import { parseSnowmakingParams } from '../sim/snowmakingParams';
import { parseRidingParams } from '../sim/snowRiding';
import type { SummerFacts, SummerOutcome, SummerPlan, TrailDesign } from '../sim/summer';
import { BIKE_CLASS_NAMES, analyzeTrail, ensureSummer } from '../sim/summer';
import type { SummerNet } from '../sim/summerGuests';
import { SummerDay, osmDestinations, summerNetFor } from '../sim/summerGuests';
import { parseSummerParams } from '../sim/summerParams';
import { parseWeatherParams } from '../sim/weather';
import { WINTER_CLASS_NAMES, parseWinterClasses, winterClass, winterPercentile, winterSkiDays } from '../sim/winterClass';
import { loadMapFromDisk } from './loadMapFromDisk';
import { MONTH_SHORT, categoryChart, esc, fmt } from './reportKit';

const OUT = process.argv[2] ?? 'reports/raport-lata.html';
const AGENTS = process.env.SUMMER_AGENTS !== '0';
const t0 = performance.now();
const log = (s: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)} s] ${s}`);
const { grid, dem, landCover, def } = loadMapFromDisk();
const settings = parseSimSettings(settingsJson);
const c = puwg92ToLatLon(grid.georef!.westEastingM + grid.widthM / 2, grid.georef!.northNorthingM - grid.heightM / 2);
const location = { latDeg: c.latDeg, lonDeg: c.lonDeg, timeZone: def.timeZone };
const profile = parseClimateProfile(climateJson);
const wp = parseWeatherParams(wxJson);
const snowP = parseSnowParams(snowJson);
const rp = parseRadiationParams(radiationJson);
const riding = parseRidingParams(snowJson);
const lp = parseLiftParams(liftsJson);
const pp = parsePisteParams(pistesJson);
const gp = parseGuestParams(guestsJson);
const smp = parseSnowmakingParams(snowmakingJson);
const sp = parseSummerParams(summerJson);
const ep = withSummer(withSnowmaking(parseEconomyParams(economyJson), smp), sp);

// Przeciętna zima (najbliżej mediany wielolecia) – ten sam rok gry co w raporcie ekonomii Pilska.
const table = parseWinterClasses(winterClassesJson);
const deps = { profile, weatherParams: wp, snowParams: snowP, radiationParams: rp, riding, location };
let best = { year: 2026, pct: 9, days: 0 };
for (let y = 2026; y < 2056; y++) {
  const d = winterSkiDays(settings.seed, y, table, deps);
  const p = winterPercentile(d, table);
  if (Math.abs(p - 0.5) < Math.abs(best.pct - 0.5)) best = { year: y, pct: p, days: d };
}
log(`Przeciętna zima ${best.year}/${(best.year + 1) % 100}: ${best.days} dni ze śniegiem (${WINTER_CLASS_NAMES[winterClass(best.days, table)]}); lato ${best.year}`);

// ------------------------------------------------------------------ układ Pilska z OSM
const osm = JSON.parse(readFileSync(new URL('../../data/maps/pilsko/osm-resort.json', import.meta.url), 'utf8')) as OsmResort;
const ctxJson = JSON.parse(readFileSync(new URL('../../data/maps/pilsko/osm-context.json', import.meta.url), 'utf8')) as { parkings?: { points: [number, number][] }[]; places: { name: string; kind: string; point: number[] }[]; buildings: { name: string; points: number[][] }[] };
const trailsJson = JSON.parse(readFileSync(new URL('../../data/maps/pilsko/osm-trails.json', import.meta.url), 'utf8')) as { trails: { colour: string; name: string; points: [number, number][] }[] };
const toLocal = (e: number, n: number) => grid.puwg92ToLocal(e, n);
const parkings = (ctxJson.parkings ?? [])
  .map((pk) => {
    const pts = pk.points.map(([e, n]) => toLocal(e, n)).filter((q): q is PointM => q !== null);
    return pts.length ? { xM: pts.reduce((a, q) => a + q.xM, 0) / pts.length, yM: pts.reduce((a, q) => a + q.yM, 0) / pts.length } : null;
  })
  .filter((q): q is PointM => q !== null);
const base = layoutFromOsm(osm, grid, lp, pp, toLocal, { snapToStationM: 150, parkings }, (id, t, name, b, top) => designLift(grid, lp, id, t, name, b, top));
for (const b of base.bases) if (!b.typeId) b.typeId = 'parking';
const g0 = base.bases[0];
base.buildings = [...(base.buildings ?? []), { id: `B${base.nextId++}`, typeId: 'garage', name: 'Garaż ratraków', xM: g0.xM + 40, yM: g0.yM }];
const onMap = (q: PointM) => !Number.isNaN(grid.sampleElevationM(q.xM, q.yM));
const walkLines = trailsJson.trails.map((t) => t.points.map(([e, n]) => toLocal(e, n)).filter((q): q is PointM => q !== null)).filter((l) => l.length >= 2);
const destinations = osmDestinations(ctxJson.places, ctxJson.buildings, toLocal, onMap, sp);

// Lato: najdłuższa kanapa – wieszaki na rowery, restauracja i punkt widokowy przy górnej stacji,
// plac zabaw przy najbliższym parkingu, tor saneczkowy i trasa rowerowa obok niej.
function summerLayout(): { layout: ResortLayout; notes: string[] } {
  const l = JSON.parse(JSON.stringify(base)) as ResortLayout;
  const notes: string[] = [];
  const chairs = l.lifts.filter((x) => liftTypeById(lp, x.typeId).kind === 'aerial');
  const len = (x: (typeof chairs)[number]) => Math.hypot(x.top.xM - x.bottom.xM, x.top.yM - x.bottom.yM);
  chairs.sort((a, b) => len(b) - len(a));
  const main = chairs[0];
  main.bikeRacks = true;
  // Latem kursuje tylko najdłuższa kanapa (pozostałe – summerOff), jak na większości ośrodków.
  for (const x of chairs.slice(1)) x.summerOff = true;
  notes.push(`Latem kursuje: ${main.name} (z wieszakami na rowery); pozostałe koleje stoją.`);
  const dx = (main.top.xM - main.bottom.xM) / len(main);
  const dy = (main.top.yM - main.bottom.yM) / len(main);
  const side = (p: PointM, along: number, off: number): PointM => ({ xM: p.xM + dx * along - dy * off, yM: p.yM + dy * along + dx * off });
  const id = () => `L${l.nextId++}`;
  l.buildings!.push({ id: id(), typeId: 'gastronomy', name: 'Restauracja przy górnej stacji', ...side(main.top, 30, 40) });
  l.buildings!.push({ id: id(), typeId: 'viewpoint', name: 'Punkt widokowy', ...side(main.top, 60, -40) });
  const nearPark = [...l.bases].sort((a, b) => Math.hypot(a.xM - main.bottom.xM, a.yM - main.bottom.yM) - Math.hypot(b.xM - main.bottom.xM, b.yM - main.bottom.yM))[0];
  l.buildings!.push({ id: id(), typeId: 'playground', name: 'Plac zabaw', xM: nearPark.xM + 30, yM: nearPark.yM + 30 });
  l.trails = [];
  // Tor saneczkowy: ok. 600 m w dół do dolnej stacji, z boku linii (pierwsza poprawna wersja).
  for (const off of [70, -70, 140, -140, 220, -220]) {
    for (const along of [600, 500, 400]) {
      const t: TrailDesign = { id: 'TOR', name: 'Tor saneczkowy', kind: 'toboggan', points: [side(main.bottom, along, off), side(main.bottom, along / 2, off * 1.1), side(main.bottom, 30, off)] };
      if (analyzeTrail(t, grid, sp).ok) {
        l.trails.push({ ...t, id: id() });
        break;
      }
    }
    if (l.trails.length) break;
  }
  if (!l.trails.length) notes.push('Toru saneczkowego nie udało się zmieścić przy dolnej stacji (nachylenie poza zakresem).');
  // Trasa rowerowa zakosami od górnej do dolnej stacji.
  const L = len(main);
  // Wariant z najłagodniejszym najbardziej stromym odcinkiem.
  let bestBike: TrailDesign | null = null;
  let bestMax = Infinity;
  for (const w of [150, 220, 300, 380]) {
    for (const sgn of [1, -1]) {
      const t: TrailDesign = { id: 'BIKE', name: 'Trasa rowerowa', kind: 'bike', points: [side(main.top, -20, 25 * sgn), side(main.bottom, L * 0.75, w * sgn), side(main.bottom, L * 0.5, -w * sgn), side(main.bottom, L * 0.25, w * sgn), side(main.bottom, 20, 40 * sgn)] };
      const a = analyzeTrail(t, grid, sp);
      if (a.ok && a.maxSlopePercent < bestMax) {
        bestMax = a.maxSlopePercent;
        bestBike = t;
      }
    }
  }
  if (bestBike) l.trails.push({ ...bestBike, id: id() });
  return { layout: l, notes };
}

log('Horyzont (cienie)…');
const horizon = computeHorizon(grid, dem, parseHorizonParams(radiationJson));

function newGame(withSummer: boolean): HeadlessGame {
  return new HeadlessGame({
    grid,
    horizon,
    forest: landCover!.forest,
    shrub: landCover!.shrub,
    profile,
    weatherParams: wp,
    radiationParams: rp,
    snowParams: snowP,
    guestParams: gp,
    liftParams: lp,
    pisteParams: pp,
    clearing: parseConstructionParams(constructionJson).clearing,
    ground: parseGroundParams(constructionJson),
    riding,
    economy: ep,
    seed: settings.seed,
    location,
    mode: 'sandbox',
    startDate: { year: best.year, month: 5, day: 1 },
    policy: (g) => {
      const d = g.state.date;
      if (g.state.summer) g.state.summer.open = withSummer && d.month >= sp.season.earliestOpenMonth && d.month <= sp.season.latestCloseMonth;
      const window = d.month === 12 || d.month <= 3 || (d.month === 4 && d.day <= 15);
      if (!window) {
        g.state.seasonOpen = false;
        return;
      }
      const s = g.context(d).snow.score;
      if (!g.state.seasonOpen && s >= 0.35) g.state.seasonOpen = true;
      else if (g.state.seasonOpen && s < 0.2) g.state.seasonOpen = false;
    },
    summerAgents: withSummer && AGENTS ? agentsDay : null,
  });
}

// Symulacja gości letnich: sieć liczona raz na zestaw działających obiektów.
let netCache: { key: string; net: SummerNet } | null = null;
const daySamples: { date: string; guests: number; byType: number[]; rating: number; queue: number; storm: boolean; up: number; down: number; tob: number; laps: number; meals: number; turned: number }[] = [];
function agentsDay(g: HeadlessGame, plan: SummerPlan, sf: SummerFacts): SummerOutcome {
  const key = JSON.stringify([sf.lifts.map((x) => x.operating), sf.bikeTrails.map((x) => x.id), sf.toboggan?.id ?? '', sf.foodTop, sf.foodBase, sf.playgrounds, sf.viewpoints]);
  if (!netCache || netCache.key !== key) {
    const an = (g as unknown as { analysis: { trails?: Map<string, { axis: PointM[]; ok: boolean }> } }).analysis;
    netCache = { key, net: summerNetFor(g.layout, an.trails ?? new Map(), sf, g.facts, (id) => !g.state.construction[id], { walkLines, destinations }, (x, y) => grid.sampleElevationM(x, y), sp) };
  }
  const day = new SummerDay(netCache.net, sp, { seed: settings.seed, date: plan.date, plan, personsPerCar: ep.demand.personsPerCar });
  day.advanceTo(22 * 3600, 3);
  const o = day.outcome(sf);
  daySamples.push({
    date: `${plan.date.year}-${String(plan.date.month).padStart(2, '0')}-${String(plan.date.day).padStart(2, '0')}`,
    guests: o.guests,
    byType: o.byType,
    rating: o.ratingCount ? o.ratingSum / o.ratingCount : 0,
    queue: o.meanQueueMin,
    storm: plan.weather.storm,
    up: o.liftUp.reduce((a, b) => a + b, 0),
    down: o.liftDown.reduce((a, b) => a + b, 0),
    tob: o.tobogganRides,
    laps: o.bikeLaps,
    meals: o.meals,
    turned: day.turnedAway,
  });
  return o;
}

function runYear(withSummer: boolean): { report: SeasonReport; invest: number; game: HeadlessGame; notes: string[] } {
  const g = newGame(withSummer);
  const { layout, notes } = withSummer ? summerLayout() : { layout: base, notes: [] };
  g.setLayout(layout);
  const costs = objectCosts(g.layout, (g as unknown as { analysis: Parameters<typeof objectCosts>[1] }).analysis, ep);
  markAllBuilt(g.state, costs);
  const inf = infraFacts(g.layout, (g as unknown as { analysis: Parameters<typeof infraFacts>[1] }).analysis, g.state, smp, grid);
  for (let i = 0; i < 3; i++) acquireGroomer(g.state, 'standard', false, inf.garageSlots, smp);
  ensureSummer(g.state, sp);
  g.runUntil({ year: best.year + 1, month: 5, day: 1 });
  return { report: g.state.history[g.state.history.length - 1], invest: costs.reduce((a, x) => a + x.costPln, 0), game: g, notes };
}

log('Rok bez lata…');
const A = runYear(false);
log(`Rok z latem (goście latem: ${AGENTS ? 'symulacja agentów' : 'model zgrubny'})…`);
const B = runYear(true);
log('Gotowe.');

// ------------------------------------------------------------------ HTML
const res = (f: Flows) => sumRevenue(f) - sumCosts(f);
const sfA = A.report.seasonFlows!;
const sfB = B.report.seasonFlows!;
const yearA = res(A.report.flows);
const yearB = res(B.report.flows);
const investSummer = B.invest - A.invest;
const summerOp = res(sfB.summer);
const commonExtra = res(sfB.common) - res(sfA.common);
const trailsB = (B.game as unknown as { analysis: { trails?: Map<string, ReturnType<typeof analyzeTrail>> } }).analysis.trails ?? new Map();
const attractions = (B.game.layout.trails ?? []).map((t) => {
  const a = trailsB.get(t.id)!;
  return `<tr><td>${esc(t.name)}</td><td>${t.kind === 'bike' ? `trasa ${BIKE_CLASS_NAMES[a.classIndex]}` : t.kind === 'toboggan' ? 'tor całoroczny' : 'ścieżka'}</td><td>${fmt(a.lengthM, 0)} m</td><td>${fmt(a.meanSlopePercent, 0)} % (maks. ${fmt(a.maxSlopePercent, 0)} %)</td><td>${fmtPln(a.costPln)}</td><td>${fmtPln(a.maintenancePlnPerYear)}/rok</td></tr>`;
});
for (const b of B.game.layout.buildings ?? []) {
  if (A.game.layout.buildings?.some((x) => x.id === b.id)) continue;
  const t = ep.buildings.find((x) => x.id === b.typeId);
  const st = sp.buildings.find((x) => x.id === b.typeId);
  attractions.push(`<tr><td>${esc(b.name)}</td><td>budynek</td><td></td><td></td><td>${fmtPln(t?.costPln ?? st?.costPln ?? 0)}</td><td>${st ? `${fmtPln(st.costPln * st.maintenanceRatePerYear)}/rok` : 'utrzymanie 1,5 %/rok'}</td></tr>`);
}
const flowRows = (keys: readonly (keyof Flows)[], cols: Flows[]) =>
  keys
    .filter((k) => cols.some((f) => Math.abs(f[k] ?? 0) >= 1))
    .map((k) => `<tr><td>${esc(FLOW_NAMES[k])}</td>${cols.map((f) => `<td>${fmtPln(f[k] ?? 0)}</td>`).join('')}</tr>`)
    .join('');
const cols = [sfB.winter, sfB.summer, sfB.off, sfB.common, B.report.flows];
const monthGuests = new Array(12).fill(0);
const monthRev = new Array(12).fill(0);
for (const d of B.report.days) {
  if (d.season !== 'summer') continue;
  const m = Number(d.date.slice(5, 7)) - 1;
  monthGuests[m] += d.guests;
  monthRev[m] += d.revenuePln;
}
const sm = [4, 5, 6, 7, 8, 9];
const stormDays = B.report.days.filter((d) => d.season === 'summer' && (d.stormH ?? 0) > 0).length;
const tot = (k: keyof (typeof daySamples)[number]) => daySamples.reduce((a, s) => a + (s[k] as number), 0);
const byType = [0, 1, 2, 3].map((i) => daySamples.reduce((a, s) => a + s.byType[i], 0));
const sat = daySamples.filter((s) => new Date(s.date).getUTCDay() === 6);
const best5 = [...daySamples].sort((a, b) => b.guests - a.guests).slice(0, 5);
const totalS = (performance.now() - t0) / 1000;

const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raport lata</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d2329;--muted:#5d6670;--grid:#e3e1db;--card:#ffffff;--c1:#2f9e44;--c2:#1f6fd1;--ok:#1e7d3c;--bad:#b3261e}
@media (prefers-color-scheme: dark){:root{--bg:#16191d;--fg:#e9ecef;--muted:#a3abb4;--grid:#2c3238;--card:#1e2227;--c1:#69db7c;--c2:#5aa0ff;--ok:#5cc87a;--bad:#ff8a80}}
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
<h1>Raport lata – ośrodek wielkości Pilska z sezonem letnim</h1>
<p class="muted">Rok gry ${best.year}/${(best.year + 1) % 100} (1 maja – 30 kwietnia), przeciętna zima (${best.days} dni ze śniegiem na ${table.elevationM} m, ${WINTER_CLASS_NAMES[winterClass(best.days, table)]}). Układ prawdziwego Pilska z OpenStreetMap: ${base.lifts.length} wyciągów, ${base.pistes.length} odcinków tras, ${base.bases.length} parkingi; piaskownica (obiekty gotowe), te same zasady otwierania zimy w obu wariantach. Lato: sezon otwarty od ${sp.season.earliestOpenMonth}. do ${sp.season.latestCloseMonth}. miesiąca, koleje ${sp.season.openH}:00–${sp.season.closeH}:00; goście latem – ${AGENTS ? 'symulacja agentów (każda grupa osobno)' : 'model zgrubny'}.</p>
<div class="kpis">
<div><span class="muted small">wynik roku bez lata</span><b class="${yearA >= 0 ? 'ok' : 'bad'}">${fmtPln(yearA)}</b></div>
<div><span class="muted small">wynik roku z latem</span><b class="${yearB >= 0 ? 'ok' : 'bad'}">${fmtPln(yearB)}</b></div>
<div><span class="muted small">lato zmienia wynik o</span><b class="${yearB - yearA >= 0 ? 'ok' : 'bad'}">${yearB - yearA >= 0 ? '+' : ''}${fmtPln(yearB - yearA)}</b></div>
<div><span class="muted small">inwestycja w atrakcje letnie</span><b>${fmtPln(investSummer)}</b></div>
<div><span class="muted small">dni lata otwarte</span><b>${B.report.summerOpenDays ?? 0}</b></div>
<div><span class="muted small">goście latem</span><b>${(B.report.summerGuests ?? 0).toLocaleString('pl-PL')}</b></div>
<div><span class="muted small">ocena lata</span><b>${B.report.summerRating !== null && B.report.summerRating !== undefined ? fmt(B.report.summerRating, 2) : '–'} ★</b></div>
<div><span class="muted small">prosty zwrot atrakcji</span><b>${yearB - yearA > 0 ? `${fmt(investSummer / (yearB - yearA), 0)} lat` : 'brak'}</b></div>
</div>
<p>${B.notes.map(esc).join(' ')} Wynik lata (przychody minus koszty działania w dniach letnich) ${fmtPln(summerOp)}; koszty wspólne rosną o ${fmtPln(-commonExtra)} (utrzymanie i ubezpieczenie nowych obiektów, utrzymanie tras letnich, koszenie). Zima w obu wariantach taka sama: ${A.report.openDays} dni otwarte, ${A.report.guests.toLocaleString('pl-PL')} gości.</p>

<h2>Wynik roku: zima, lato, koszty wspólne</h2>
<div class="table-wrap card"><table>
<tr><th>pozycja (wariant z latem)</th><th>zima</th><th>lato</th><th>poza sezonem</th><th>wspólne</th><th>rok</th></tr>
<tr><th colspan="6">przychody</th></tr>${flowRows(REVENUE_KEYS, cols)}
<tr><th colspan="6">koszty</th></tr>${flowRows(COST_KEYS, cols)}
<tr><td><b>wynik</b></td>${cols.map((f) => `<td><b class="${res(f) >= 0 ? 'ok' : 'bad'}">${fmtPln(res(f))}</b></td>`).join('')}</tr>
</table></div>
<p class="small muted">Bez lata: zima ${fmtPln(res(sfA.winter))}, poza sezonem ${fmtPln(res(sfA.off))}, wspólne ${fmtPln(res(sfA.common))}, rok ${fmtPln(yearA)}. „Wspólne” – stała załoga, ubezpieczenie, utrzymanie obiektów, przeglądy, odsetki, utrzymanie tras letnich i koszenie (nie zależą od tego, który sezon trwa).</p>

<h2>Lato miesiąc po miesiącu</h2>
<div class="grid2">
<div class="card">${categoryChart(sm.map((m) => MONTH_SHORT[m]), [{ name: 'goście', values: sm.map((m) => monthGuests[m]), color: 'var(--c1)', kind: 'bar' }], 'osób', { zeroBased: true })}<div class="legend"><span><i style="background:var(--c1)"></i>goście w miesiącu</span></div></div>
<div class="card">${categoryChart(sm.map((m) => MONTH_SHORT[m]), [{ name: 'przychód', values: sm.map((m) => monthRev[m] / 1000), color: 'var(--c2)', kind: 'bar' }], 'tys. zł', { zeroBased: true })}<div class="legend"><span><i style="background:var(--c2)"></i>przychód w miesiącu</span></div></div>
</div>
<p>Dni z burzą (kolej i tor stoją w czasie burzy): <b>${stormDays}</b>. ${AGENTS ? `Goście wg typu: turyści piesi ${byType[0].toLocaleString('pl-PL')}, rodziny ${byType[1].toLocaleString('pl-PL')}, rowerzyści ${byType[2].toLocaleString('pl-PL')}, wycieczki szkolne ${byType[3].toLocaleString('pl-PL')}. Wjazdy koleją w górę ${Math.round(tot('up')).toLocaleString('pl-PL')}, zjazdy w dół ${Math.round(tot('down')).toLocaleString('pl-PL')}, przejazdy torem ${Math.round(tot('tob')).toLocaleString('pl-PL')}, zjazdy rowerowe ${Math.round(tot('laps')).toLocaleString('pl-PL')}, posiłki w restauracji ${Math.round(tot('meals')).toLocaleString('pl-PL')}, odjechali bez miejsca na parkingu ${Math.round(tot('turned')).toLocaleString('pl-PL')}. Średnio w sobotę ${sat.length ? Math.round(sat.reduce((a, s) => a + s.guests, 0) / sat.length).toLocaleString('pl-PL') : '–'} gości, średnie czekanie w kolejkach ${fmt(daySamples.reduce((a, s) => a + s.queue, 0) / Math.max(1, daySamples.length), 1)} min.` : ''}</p>
${AGENTS ? `<div class="table-wrap card"><table><tr><th>najbardziej ruchliwe dni</th><th>goście</th><th>w górę</th><th>w dół</th><th>tor</th><th>posiłki</th><th>czekanie</th><th>ocena</th></tr>${best5.map((s) => `<tr><td>${s.date}${s.storm ? ' (burza)' : ''}</td><td>${s.guests.toLocaleString('pl-PL')}</td><td>${Math.round(s.up)}</td><td>${Math.round(s.down)}</td><td>${Math.round(s.tob)}</td><td>${Math.round(s.meals)}</td><td>${fmt(s.queue, 1)} min</td><td>${fmt(s.rating, 2)}</td></tr>`).join('')}</table></div>` : ''}

<h2>Atrakcje letnie w wariancie z latem</h2>
<div class="table-wrap card"><table><tr><th>obiekt</th><th>rodzaj</th><th>długość</th><th>nachylenie</th><th>budowa</th><th>utrzymanie</th></tr>${attractions.join('')}</table></div>
<p class="small muted">Szlaki turystyczne PTTK z OpenStreetMap (${walkLines.length} odcinków) – bez kosztów; cele wycieczek: ${destinations.map((d) => esc(d.name)).join(', ')}.</p>

<h2>Ceny i założenia (data/summer.json)</h2>
<div class="table-wrap card"><table>
<tr><th>cena / założenie</th><th>wartość</th><th>źródło</th></tr>
${(['liftUpPln', 'liftRoundTripPln', 'bikeDayPln', 'tobogganRidePln', 'bikeRentalDayPln'] as const).map((k) => `<tr><td>${{ liftUpPln: 'bilet w górę', liftRoundTripPln: 'bilet góra-dół', bikeDayPln: 'karnet rowerowy dzienny', tobogganRidePln: 'przejazd torem', bikeRentalDayPln: 'wypożyczenie roweru' }[k]}</td><td>${fmt(sp.prices[k], 0)} zł</td><td class="small" style="text-align:left">${esc((summerJson as unknown as { prices: Record<string, { source: string }> }).prices[k].source)}</td></tr>`).join('')}
<tr><td>pula gości w regionie (letnia sobota, wakacje)</td><td>${fmt(sp.demand.regionPoolPerDay, 0)}</td><td class="small" style="text-align:left">do kalibracji</td></tr>
<tr><td>burze</td><td>${fmt(sp.weather.stormPIfWet[6] * 100, 0)} % dni z opadem w lipcu</td><td class="small" style="text-align:left">IMGW Bielsko-Biała 2001–2025 (npm run import-storms)</td></tr>
</table></div>
<p class="small muted">Popyt, udziały typów gości i koszty atrakcji są „do kalibracji” – liczby pokazują rząd wielkości, nie prognozę. Raport: ${fmt(totalS, 0)} s.</p>
</main></body></html>`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
log(`Zapisano ${OUT}. Rok bez lata ${fmtPln(yearA)}, z latem ${fmtPln(yearB)} (różnica ${fmtPln(yearB - yearA)}); lato: ${B.report.summerOpenDays} dni, ${(B.report.summerGuests ?? 0).toLocaleString('pl-PL')} gości, wynik dni letnich ${fmtPln(summerOp)}, inwestycja ${fmtPln(investSummer)}`);
void zeroFlows;
