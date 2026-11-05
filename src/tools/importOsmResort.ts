/**
 * Prawdziwy ośrodek z OpenStreetMap: wyciągi (aerialway) i trasy zjazdowe (piste:type=downhill)
 * w obszarze mapy – do przełączanej nakładki „rzeczywistość” i do sprawdzenia klasyfikacji tras.
 *
 * Uruchomienie:  npm run import-osm-resort          (mapa domyślna: pilsko)
 *
 * Źródło: API OpenStreetMap (api.openstreetmap.org/api/0.6/map) – obszar dzielony na kafle, bo
 * jedno zapytanie zwraca najwyżej 50 tys. punktów. Surowe kafle w .cache/osm (poza repozytorium).
 * Licencja danych: ODbL, © współtwórcy OpenStreetMap.
 *
 * Wynik: data/maps/<mapa>/osm-resort.json – linie w PUWG 1992 [E, N].
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { latLonToPuwg92, puwg92ToLatLon } from '../sim/geo';
import { parseMapDefinition } from '../sim/mapFile';

const CACHE_DIR = '.cache/osm';
const TILE_LON_DEG = 0.02;
const TILE_LAT_DEG = 0.015;
/** Rodzaje aerialway, które nie są liniami wyciągów (stacje, podpory). */
const NOT_LIFTS = new Set(['station', 'pylon', 'goods']);

function log(m: string): void {
  console.log(`[import-osm-resort] ${m}`);
}

interface OsmWay {
  id: number;
  nodes: number[];
  tags: Record<string, string>;
}

const decodeEntities = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Prosty odczyt XML z API OSM (węzły, drogi i ich znaczniki). */
function parseOsmXml(xml: string, nodes: Map<number, [number, number]>, ways: Map<number, OsmWay>): void {
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(Number(m[1]), [Number(m[2]), Number(m[3])]);
  for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = m[2];
    const nd = [...body.matchAll(/<nd ref="(\d+)"/g)].map((x) => Number(x[1]));
    const tags: Record<string, string> = {};
    for (const t of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[decodeEntities(t[1])] = decodeEntities(t[2]);
    ways.set(Number(m[1]), { id: Number(m[1]), nodes: nd, tags });
  }
}

async function fetchTile(minLon: number, minLat: number, maxLon: number, maxLat: number): Promise<string> {
  const name = `map_${minLon.toFixed(3)}_${minLat.toFixed(3)}_${maxLon.toFixed(3)}_${maxLat.toFixed(3)}.xml`;
  const path = join(CACHE_DIR, name);
  if (existsSync(path)) return readFile(path, 'utf8');
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${minLon},${minLat},${maxLon},${maxLat}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'ski-sim (symulator osrodka narciarskiego)' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(path, text);
      return text;
    } catch (e) {
      if (attempt >= 4) throw new Error(`Nie udało się pobrać ${url}: ${String(e)}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

async function main(): Promise<void> {
  const mapName = process.argv[2] ?? 'pilsko';
  const dir = join('data', 'maps', mapName);
  const def = parseMapDefinition(JSON.parse(await readFile(join(dir, 'map.json'), 'utf8')));
  const eastM = def.westEastingM + def.widthCells * def.cellSizeM;
  const southM = def.northNorthingM - def.heightCells * def.cellSizeM;
  const corners = [
    puwg92ToLatLon(def.westEastingM, def.northNorthingM),
    puwg92ToLatLon(eastM, def.northNorthingM),
    puwg92ToLatLon(def.westEastingM, southM),
    puwg92ToLatLon(eastM, southM),
  ];
  const minLat = Math.min(...corners.map((c) => c.latDeg)) - 0.002;
  const maxLat = Math.max(...corners.map((c) => c.latDeg)) + 0.002;
  const minLon = Math.min(...corners.map((c) => c.lonDeg)) - 0.002;
  const maxLon = Math.max(...corners.map((c) => c.lonDeg)) + 0.002;
  const nodes = new Map<number, [number, number]>();
  const ways = new Map<number, OsmWay>();
  let tiles = 0;
  for (let lat = minLat; lat < maxLat; lat += TILE_LAT_DEG) {
    for (let lon = minLon; lon < maxLon; lon += TILE_LON_DEG) {
      const xml = await fetchTile(lon, lat, Math.min(lon + TILE_LON_DEG, maxLon), Math.min(lat + TILE_LAT_DEG, maxLat));
      parseOsmXml(xml, nodes, ways);
      tiles++;
    }
  }
  log(`Kafli: ${tiles}, dróg: ${ways.size}, punktów: ${nodes.size}`);
  const toPuwg = (w: OsmWay) =>
    w.nodes
      .map((id) => nodes.get(id))
      .filter((p): p is [number, number] => p !== undefined)
      .map(([lat, lon]) => {
        const p = latLonToPuwg92(lat, lon);
        return [Math.round(p.eastingM * 10) / 10, Math.round(p.northingM * 10) / 10];
      });
  const inside = (pts: number[][]) => pts.some(([e, n]) => e >= def.westEastingM && e <= eastM && n >= southM && n <= def.northNorthingM);
  const lifts = [];
  const pistes = [];
  for (const w of [...ways.values()].sort((a, b) => a.id - b.id)) {
    const pts = toPuwg(w);
    if (pts.length < 2 || !inside(pts)) continue;
    const t = w.tags;
    if (t.aerialway && !NOT_LIFTS.has(t.aerialway)) {
      lifts.push({ osmId: w.id, name: t.name ?? '', ref: t.ref ?? '', aerialway: t.aerialway, capacityPerHour: t['aerialway:capacity'] ? Number(t['aerialway:capacity']) : null, points: pts });
    } else if (t['piste:type'] === 'downhill') {
      const closed = w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];
      pistes.push({
        osmId: w.id,
        name: t['piste:name'] ?? t.name ?? '',
        ref: t['piste:ref'] ?? t.ref ?? '',
        difficulty: t['piste:difficulty'] ?? '',
        area: closed || t.area === 'yes',
        points: pts,
      });
    }
  }
  log(`Wyciągi: ${lifts.length}, trasy: ${pistes.length} (w tym obszary: ${pistes.filter((p) => p.area).length})`);
  const out = {
    _opis: 'Prawdziwy ośrodek z OpenStreetMap (wyciągi i trasy zjazdowe) w obszarze mapy – nakładka „rzeczywistość” i sprawdzenie klasyfikacji tras. Wynik npm run import-osm-resort – nie edytować ręcznie.',
    source: 'OpenStreetMap, API 0.6 (api.openstreetmap.org); © współtwórcy OpenStreetMap, licencja ODbL',
    downloaded: new Date().toISOString().slice(0, 10),
    units: 'punkty: [E, N] w PUWG 1992 [m]; capacityPerHour – os./h (znacznik aerialway:capacity)',
    difficultyInfo: 'piste:difficulty wg OSM: novice – zielona, easy – niebieska, intermediate – czerwona, advanced/expert – czarna',
    lifts,
    pistes,
  };
  await writeFile(join(dir, 'osm-resort.json'), JSON.stringify(out, null, 1) + '\n');
  log(`Zapisano ${join(dir, 'osm-resort.json')}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
