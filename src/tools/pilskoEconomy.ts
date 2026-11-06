/**
 * Ekonomia ośrodka wielkości prawdziwego Pilska (etap 6b): układ z OpenStreetMap (wyciągi, trasy,
 * parkingi) na pełnej mapie, jeden sezon w przeciętnej zimie (najbliżej mediany rozkładu
 * z data/winter-classes.json), bez naśnieżania i z naśnieżaniem na trasach przy dolnych stacjach.
 * Wypisuje strukturę przychodów i kosztów sezonu (rok gry 1 V – 30 IV).
 *
 * Uruchomienie: npm run pilsko-economy
 */
import { readFileSync } from 'node:fs';
import climateJson from '../../data/climate/pilsko.json';
import constructionJson from '../../data/construction.json';
import economyJson from '../../data/economy.json';
import guestsJson from '../../data/guests.json';
import liftsJson from '../../data/lifts.json';
import pistesJson from '../../data/pistes.json';
import radiationJson from '../../data/radiation.json';
import settingsJson from '../../data/settings.json';
import snowJson from '../../data/snow.json';
import winterClassesJson from '../../data/winter-classes.json';
import wxJson from '../../data/weather-generator.json';
import { parseClimateProfile } from '../sim/climate';
import type { Flows, SeasonReport } from '../sim/economy';
import { COST_KEYS, FLOW_NAMES, REVENUE_KEYS, fmtPln, markAllBuilt, objectCosts, sumCosts, sumRevenue } from '../sim/economy';
import { parseEconomyParams, withSnowmaking } from '../sim/economyParams';
import snowmakingJson from '../../data/snowmaking.json';
import { parseSnowmakingParams } from '../sim/snowmakingParams';
import { acquireGroomer, infraFacts } from '../sim/operations';
import { puwg92ToLatLon } from '../sim/geo';
import { parseGroundParams } from '../sim/ground';
import { parseGuestParams } from '../sim/guestParams';
import { HeadlessGame } from '../sim/headlessGame';
import { computeHorizon, parseHorizonParams } from '../sim/horizon';
import { designLift, parseLiftParams } from '../sim/lifts';
import { parsePisteParams } from '../sim/pistes';
import { parseRadiationParams } from '../sim/radiation';
import type { OsmResort } from '../sim/resort';
import { layoutFromOsm, parseConstructionParams } from '../sim/resort';
import { parseSimSettings } from '../sim/settings';
import { parseSnowParams } from '../sim/snow';
import { parseRidingParams } from '../sim/snowRiding';
import { parseWeatherParams } from '../sim/weather';
import { WINTER_CLASS_NAMES, parseWinterClasses, winterClass, winterPercentile, winterSkiDays } from '../sim/winterClass';
import { loadMapFromDisk } from './loadMapFromDisk';

const t0 = performance.now();
const log = (s: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)} s] ${s}`);
const { grid, dem, landCover, def } = loadMapFromDisk();
const settings = parseSimSettings(settingsJson);
const c = puwg92ToLatLon(grid.georef!.westEastingM + grid.widthM / 2, grid.georef!.northNorthingM - grid.heightM / 2);
const location = { latDeg: c.latDeg, lonDeg: c.lonDeg, timeZone: def.timeZone };
const profile = parseClimateProfile(climateJson);
const wp = parseWeatherParams(wxJson);
const sp = parseSnowParams(snowJson);
const rp = parseRadiationParams(radiationJson);
const riding = parseRidingParams(snowJson);
const lp = parseLiftParams(liftsJson);
const pp = parsePisteParams(pistesJson);
const gp = parseGuestParams(guestsJson);
const smp = parseSnowmakingParams(snowmakingJson);
const ep = withSnowmaking(parseEconomyParams(economyJson), smp);

// Przeciętna zima: najbliżej mediany rozkładu wielolecia.
const table = parseWinterClasses(winterClassesJson);
const deps = { profile, weatherParams: wp, snowParams: sp, radiationParams: rp, riding, location };
let best = { year: 2026, pct: 9, days: 0 };
for (let y = 2026; y < 2056; y++) {
  const d = winterSkiDays(settings.seed, y, table, deps);
  const p = winterPercentile(d, table);
  if (Math.abs(p - 0.5) < Math.abs(best.pct - 0.5)) best = { year: y, pct: p, days: d };
}
log(`Przeciętna zima: ${best.year}/${(best.year + 1) % 100} – ${best.days} dni ze śniegiem na ${table.elevationM} m (${(best.pct * 100).toFixed(0)}. percentyl, ${WINTER_CLASS_NAMES[winterClass(best.days, table)]})`);

// Układ prawdziwego Pilska z OSM.
const osm = JSON.parse(readFileSync(new URL('../../data/maps/pilsko/osm-resort.json', import.meta.url), 'utf8')) as OsmResort;
const ctx = JSON.parse(readFileSync(new URL('../../data/maps/pilsko/osm-context.json', import.meta.url), 'utf8')) as { parkings?: { points: [number, number][] }[] };
const parkings = (ctx.parkings ?? [])
  .map((pk) => {
    const pts = pk.points.map(([e, n]) => grid.puwg92ToLocal(e, n)).filter((q): q is { xM: number; yM: number } => q !== null);
    return pts.length ? { xM: pts.reduce((a, q) => a + q.xM, 0) / pts.length, yM: pts.reduce((a, q) => a + q.yM, 0) / pts.length } : null;
  })
  .filter((q): q is { xM: number; yM: number } => q !== null);
const layout = layoutFromOsm(osm, grid, lp, pp, (e, n) => grid.puwg92ToLocal(e, n), { snapToStationM: 150, parkings }, (id, t, name, b, top) => designLift(grid, lp, id, t, name, b, top));
// Parkingi z OSM jako parkingi gry (pojemność z danych budynku „parking”).
for (const b of layout.bases) if (!b.typeId) b.typeId = 'parking';
// Garaż ratraków przy pierwszym parkingu (flota: 3 ratraki standardowe – trasy ratrakowane co noc).
const g0 = layout.bases[0];
layout.buildings = [...(layout.buildings ?? []), { id: `B${layout.nextId++}`, typeId: 'garage', name: 'Garaż ratraków', xM: g0.xM + 40, yM: g0.yM }];

log('Horyzont (cienie)…');
const horizon = computeHorizon(grid, dem, parseHorizonParams(radiationJson));
const game = new HeadlessGame({
  grid,
  horizon,
  forest: landCover!.forest,
  shrub: landCover!.shrub,
  profile,
  weatherParams: wp,
  radiationParams: rp,
  snowParams: sp,
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
    const window = d.month === 12 || d.month <= 3 || (d.month === 4 && d.day <= 15);
    if (!window) {
      g.state.seasonOpen = false;
      return;
    }
    const s = g.context(d).snow.score;
    if (!g.state.seasonOpen && s >= 0.35) g.state.seasonOpen = true;
    else if (g.state.seasonOpen && s < 0.2) g.state.seasonOpen = false;
  },
});
game.setLayout(layout);
// Majątek wyceniony jak po budowie (ubezpieczenie, utrzymanie) – w piaskownicy budowa jest darmowa.
const costs = objectCosts(game.layout, (game as unknown as { analysis: Parameters<typeof objectCosts>[1] }).analysis, ep);
markAllBuilt(game.state, costs);
{
  const inf = infraFacts(game.layout, (game as unknown as { analysis: Parameters<typeof infraFacts>[1] }).analysis, game.state, smp, grid);
  for (let i = 0; i < 3; i++) acquireGroomer(game.state, 'standard', false, inf.garageSlots, smp);
}
const km = costs.filter((x) => x.kind === 'piste').length;
log(`Układ: ${layout.lifts.length} wyciągów, ${km} odcinków tras, ${layout.bases.length} parkingów; wartość obiektów ${fmtPln(costs.reduce((a, x) => a + x.costPln, 0))}`);
game.runUntil({ year: best.year + 1, month: 5, day: 1 });
const r: SeasonReport = game.state.history[game.state.history.length - 1];
const f: Flows = r.flows;
const rev = sumRevenue(f);
const cost = sumCosts(f);
log(`Sezon ${r.startYear}/${(r.startYear + 1) % 100}: ${r.openDays} dni otwartych, ${r.guests.toLocaleString('pl-PL')} gości, kilometry tras otwartych ${game.facts.kmOpen.toFixed(1)} km`);
console.log('\nPRZYCHODY');
for (const k of REVENUE_KEYS) if (f[k]) console.log(`  ${FLOW_NAMES[k].padEnd(40)} ${fmtPln(f[k]).padStart(14)}  ${((100 * f[k]) / rev).toFixed(0)} %`);
console.log(`  ${'razem'.padEnd(40)} ${fmtPln(rev).padStart(14)}`);
console.log('KOSZTY');
for (const k of COST_KEYS) if (f[k]) console.log(`  ${FLOW_NAMES[k].padEnd(40)} ${fmtPln(f[k]).padStart(14)}  ${((100 * f[k]) / cost).toFixed(0)} %`);
console.log(`  ${'razem'.padEnd(40)} ${fmtPln(cost).padStart(14)}`);
console.log(`WYNIK DZIAŁALNOŚCI ${fmtPln(rev - cost)}; przychód na gościa ${(rev / Math.max(1, r.guests)).toFixed(0)} zł, koszt na dzień otwarty ${fmtPln(cost / Math.max(1, r.openDays))}`);
