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
 * Wynik: data/maps/<mapa>/osm-resort.json – linie w PUWG 1992 [E, N]; osm-context.json – otoczenie
 * (budynki, drogi, parkingi, nazwy); osm-water.json – cieki (waterway=stream/river, etap 6b).
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
/** Drogi rysowane na mapie (bez ścieżek i szlaków). */
const ROAD_KINDS = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'track', 'living_street']);

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
interface OsmNamedNode {
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

function parseOsmXml(xml: string, nodes: Map<number, [number, number]>, ways: Map<number, OsmWay>, named?: Map<number, OsmNamedNode>): void {
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(Number(m[1]), [Number(m[2]), Number(m[3])]);
  if (named) {
    for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/node>/g)) {
      const tags: Record<string, string> = {};
      for (const t of m[4].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[decodeEntities(t[1])] = decodeEntities(t[2]);
      if (tags.name) named.set(Number(m[1]), { id: Number(m[1]), lat: Number(m[2]), lon: Number(m[3]), tags });
    }
  }
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
  const named = new Map<number, OsmNamedNode>();
  let tiles = 0;
  for (let lat = minLat; lat < maxLat; lat += TILE_LAT_DEG) {
    for (let lon = minLon; lon < maxLon; lon += TILE_LON_DEG) {
      const xml = await fetchTile(lon, lat, Math.min(lon + TILE_LON_DEG, maxLon), Math.min(lat + TILE_LAT_DEG, maxLat));
      parseOsmXml(xml, nodes, ways, named);
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

  // Otoczenie do oprawy graficznej: budynki, drogi, parkingi, nazwy miejsc.
  const buildings: { name: string; kind: string; points: number[][] }[] = [];
  const roads: { kind: string; name: string; points: number[][] }[] = [];
  const parkings: { points: number[][] }[] = [];
  for (const w of [...ways.values()].sort((a, b) => a.id - b.id)) {
    const pts = toPuwg(w);
    if (pts.length < 2 || !inside(pts)) continue;
    const t = w.tags;
    const closed = w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];
    if (t.building && closed) buildings.push({ name: t.name ?? '', kind: t.building, points: pts });
    else if (t.amenity === 'parking' && closed) parkings.push({ points: pts });
    else if (t.highway && ROAD_KINDS.has(t.highway)) roads.push({ kind: t.highway, name: t.name ?? '', points: pts });
  }
  const places = [...named.values()]
    .filter((n) => n.tags.place || n.tags.natural === 'peak' || n.tags.natural === 'saddle' || n.tags.tourism === 'alpine_hut' || n.tags.amenity === 'shelter')
    .map((n) => {
      const p = latLonToPuwg92(n.lat, n.lon);
      return { name: n.tags.name, kind: n.tags.place ?? n.tags.natural ?? n.tags.tourism ?? n.tags.amenity ?? '', ele: n.tags.ele ?? '', point: [Math.round(p.eastingM), Math.round(p.northingM)] };
    })
    .filter((p) => p.point[0] >= def.westEastingM - 1500 && p.point[0] <= eastM + 1500 && p.point[1] >= southM - 1500 && p.point[1] <= def.northNorthingM + 1500);
  log(`Otoczenie: budynki ${buildings.length}, drogi ${roads.length}, parkingi ${parkings.length}, nazwy ${places.length}`);
  await writeFile(
    join(dir, 'osm-context.json'),
    JSON.stringify(
      {
        _opis: 'Otoczenie z OpenStreetMap do oprawy graficznej (budynki, drogi, parkingi, nazwy miejsc). Wynik npm run import-osm-resort – nie edytować ręcznie.',
        source: out.source,
        downloaded: out.downloaded,
        units: 'punkty: [E, N] w PUWG 1992 [m]',
        buildings,
        roads,
        parkings,
        places,
      },
      null,
      0,
    ) + '\n',
  );
  log(`Zapisano ${join(dir, 'osm-context.json')}.`);

  // Cieki wodne (etap 6b): potoki i rzeki – do modelu wody do naśnieżania i na mapę.
  const water: { osmId: number; kind: string; name: string; points: number[][] }[] = [];
  for (const w of [...ways.values()].sort((a, b) => a.id - b.id)) {
    const pts = toPuwg(w);
    if (pts.length < 2 || !inside(pts)) continue;
    const k = w.tags.waterway;
    if (k !== 'stream' && k !== 'river' && k !== 'brook') continue;
    // Tylko fragmenty w obszarze mapy (linie z OSM ciągną się daleko poza nią).
    let run: number[][] = [];
    const flush = () => {
      if (run.length >= 2) water.push({ osmId: w.id, kind: k, name: w.tags.name ?? '', points: run });
      run = [];
    };
    for (const pt of pts) {
      if (inside([pt])) run.push(pt);
      else flush();
    }
    flush();
  }
  log(`Cieki: ${water.length} (z nazwą: ${water.filter((x) => x.name).length})`);
  await writeFile(
    join(dir, 'osm-water.json'),
    JSON.stringify(
      {
        _opis: 'Cieki wodne z OpenStreetMap (waterway=stream/river/brook) w obszarze mapy – model wody do naśnieżania (etap 6b). Wynik npm run import-osm-resort – nie edytować ręcznie.',
        source: out.source,
        downloaded: out.downloaded,
        units: 'punkty: [E, N] w PUWG 1992 [m]',
        streams: water,
      },
      null,
      0,
    ) + '\n',
  );
  log(`Zapisano ${join(dir, 'osm-water.json')}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
