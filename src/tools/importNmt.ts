/**
 * Konwerter NMT: pobiera Numeryczny Model Terenu z usług Geoportalu (GUGiK) i zapisuje mapę gry.
 *
 * Uruchomienie:  npm run import-nmt            (mapa domyślna: pilsko)
 *                npm run import-nmt -- pilsko
 *
 * Co robi:
 *  1. Czyta granice mapy i rozmiar komórki z data/maps/<mapa>/map.json.
 *  2. Pobiera NMT w siatce 1 m (usługa WCS, układ wysokości PL-EVRF2007-NH – ten sam, który pokazuje
 *     Geoportal) kaflami 1 × 1 km. Kafle są zapamiętywane w .cache/nmt (poza repozytorium).
 *  3. Uśrednia 1-metrowe piksele do komórek gry (np. 10 × 10 m = 100 pikseli na komórkę).
 *  4. Pobiera granicę państwa z PRG (usługa WFS) i oznacza komórki po stronie słowackiej
 *     jako „poza mapą” (NaN).
 *  5. Odczytuje wysokości punktów kontrolnych z usługi GUGiK „wysokość w punkcie”.
 *  6. Zapisuje data/maps/<mapa>/elevation.f32 oraz uzupełnia map.json (data, źródła, granica,
 *     statystyki, punkty kontrolne).
 *
 * Duże pliki źródłowe NIE trafiają do repozytorium – tylko gotowa siatka i jej opis.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { puwg92ToLatLon } from '../sim/geo';
import { parseMapDefinition } from '../sim/mapFile';
import { parseAsciiGrid } from './asciiGrid';

const WCS_URL = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModel';
const WCS_COVERAGE_ID = 'DTM_PL-EVRF2007-NH';
const WFS_URL = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries';
const WFS_BORDER_TYPENAME = 'ms:A00_Granice_panstwa';
const POINT_HEIGHT_URL = 'https://services.gugik.gov.pl/nmt/';

/** Rozmiar pobieranego kafla [m] (= pikseli przy siatce 1 m). Większe kafle serwer oddaje bardzo wolno. */
const TILE_SIZE_M = 1000;
/** Rozdzielczość pobieranego NMT [m]. */
const SOURCE_RESOLUTION_M = 1;
/** Komórka gry jest ważna, jeśli ma dane w co najmniej takiej części pikseli źródłowych. */
const MIN_VALID_FRACTION = 0.5;
/** Ile kafli pobierać naraz. */
const PARALLEL_DOWNLOADS = 3;
const RETRIES = 3;
const CACHE_DIR = '.cache/nmt';

interface Tile {
  westM: number;
  northM: number;
  widthPx: number;
  heightPx: number;
}

function log(message: string): void {
  console.log(`[import-nmt] ${message}`);
}

async function fetchWithRetry(url: string, what: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      log(`  ${what}: próba ${attempt}/${RETRIES} nieudana (${String(error)})`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`Nie udało się pobrać: ${what}. Ostatni błąd: ${String(lastError)}`);
}

async function loadTile(tile: Tile): Promise<Float32Array> {
  const cacheFile = join(
    CACHE_DIR,
    `${WCS_COVERAGE_ID}_${tile.westM}_${tile.northM}_${tile.widthPx}x${tile.heightPx}.f32`,
  );
  if (existsSync(cacheFile)) {
    const buf = await readFile(cacheFile);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
  }
  const east = tile.westM + tile.widthPx * SOURCE_RESOLUTION_M;
  const south = tile.northM - tile.heightPx * SOURCE_RESOLUTION_M;
  // W tej usłudze oś „x” to E (wschód), „y” to N (północ).
  const url =
    `${WCS_URL}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=${WCS_COVERAGE_ID}` +
    `&FORMAT=image/x-aaigrid&SUBSET=x(${tile.westM},${east})&SUBSET=y(${south},${tile.northM})`;
  const response = await fetchWithRetry(url, `kafel NMT E ${tile.westM}, N ${tile.northM}`);
  const grid = parseAsciiGrid(await response.text());
  if (grid.ncols !== tile.widthPx || grid.nrows !== tile.heightPx) {
    throw new Error(`Kafel ma ${grid.ncols} × ${grid.nrows} px, oczekiwano ${tile.widthPx} × ${tile.heightPx}`);
  }
  if (grid.nodata !== null) {
    for (let k = 0; k < grid.values.length; k++) if (grid.values[k] === grid.nodata) grid.values[k] = Number.NaN;
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, Buffer.from(grid.values.buffer));
  return grid.values;
}

/** Czy wartość z NMT jest prawdziwą wysokością (usługa zwraca 0 tam, gdzie nie ma danych). */
function isValidSourceElevation(v: number): boolean {
  return Number.isFinite(v) && v !== 0 && v > -100;
}

/** Pobiera granicę państwa (PRG) i zwraca jej odcinki leżące w pobliżu prostokąta mapy. */
async function loadBorder(bbox: { west: number; east: number; south: number; north: number }, marginM: number) {
  const url =
    `${WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${WFS_BORDER_TYPENAME}` +
    `&BBOX=${bbox.south - marginM},${bbox.west - marginM},${bbox.north + marginM},${bbox.east + marginM},urn:ogc:def:crs:EPSG::2180`;
  const response = await fetchWithRetry(url, 'granica państwa (PRG)');
  const gml = await response.text();
  const rings = [...gml.matchAll(/<gml:posList[^>]*>([^<]+)<\/gml:posList>/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
  if (rings.length === 0) throw new Error('Odpowiedź WFS nie zawiera geometrii granicy');
  const inBox = (e: number, n: number) =>
    e >= bbox.west - marginM && e <= bbox.east + marginM && n >= bbox.south - marginM && n <= bbox.north + marginM;
  // Linie granicy (ciągi punktów [E, N]) w pobliżu mapy. W GML dla EPSG:2180 kolejność to N, E.
  const lines: number[][][] = [];
  for (const ring of rings) {
    let current: number[][] = [];
    for (let k = 0; k + 1 < ring.length; k += 2) {
      const n = ring[k];
      const e = ring[k + 1];
      if (inBox(e, n)) {
        current.push([e, n]);
      } else if (current.length > 0) {
        current.push([e, n]); // punkt tuż za ramką – żeby linia dochodziła do krawędzi
        lines.push(current);
        current = [];
      } else if (k + 3 < ring.length && inBox(ring[k + 3], ring[k + 2])) {
        current.push([e, n]); // punkt tuż przed ramką
      }
    }
    if (current.length > 0) lines.push(current);
  }
  return lines;
}

/** Czy odcinki P1–P2 i Q1–Q2 się przecinają (właściwe przecięcie). */
function segmentsIntersect(
  p1x: number, p1y: number, p2x: number, p2y: number,
  q1x: number, q1y: number, q2x: number, q2y: number,
): boolean {
  const d1 = (q2x - q1x) * (p1y - q1y) - (q2y - q1y) * (p1x - q1x);
  const d2 = (q2x - q1x) * (p2y - q1y) - (q2y - q1y) * (p2x - q1x);
  const d3 = (p2x - p1x) * (q1y - p1y) - (p2y - p1y) * (q1x - p1x);
  const d4 = (p2x - p1x) * (q2y - p1y) - (p2y - p1y) * (q2x - p1x);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

async function queryPointHeight(eastingM: number, northingM: number): Promise<number> {
  // Usługa GUGiK: x = N (geodezyjne X), y = E (geodezyjne Y).
  const url = `${POINT_HEIGHT_URL}?request=GetHbyXY&x=${northingM}&y=${eastingM}`;
  const text = (await (await fetchWithRetry(url, 'wysokość w punkcie')).text()).trim();
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Usługa wysokości zwróciła: ${text}`);
  return value;
}

async function main(): Promise<void> {
  const mapName = process.argv[2] ?? 'pilsko';
  const mapDir = join('data', 'maps', mapName);
  const mapJsonPath = join(mapDir, 'map.json');
  const mapJson = JSON.parse(await readFile(mapJsonPath, 'utf8')) as Record<string, unknown>;
  const def = parseMapDefinition(mapJson);
  const { westEastingM: west, northNorthingM: north, cellSizeM } = def;
  const east = west + def.widthCells * cellSizeM;
  const south = north - def.heightCells * cellSizeM;
  log(`Mapa „${def.name}”: E ${west}–${east}, N ${south}–${north} (${def.widthCells} × ${def.heightCells} komórek po ${cellSizeM} m)`);

  const pxPerCell = cellSizeM / SOURCE_RESOLUTION_M;
  if (!Number.isInteger(pxPerCell)) throw new Error('Rozmiar komórki musi być wielokrotnością 1 m');

  // 1–3. Kafle NMT i uśrednianie.
  const tiles: Tile[] = [];
  for (let tn = north; tn > south; tn -= TILE_SIZE_M) {
    for (let tw = west; tw < east; tw += TILE_SIZE_M) {
      tiles.push({
        westM: tw,
        northM: tn,
        widthPx: Math.min(TILE_SIZE_M, east - tw) / SOURCE_RESOLUTION_M,
        heightPx: Math.min(TILE_SIZE_M, tn - south) / SOURCE_RESOLUTION_M,
      });
    }
  }
  const cellCount = def.widthCells * def.heightCells;
  const sum = new Float64Array(cellCount);
  const count = new Uint16Array(cellCount);
  let done = 0;
  const queue = [...tiles];
  async function worker(): Promise<void> {
    for (let tile = queue.shift(); tile; tile = queue.shift()) {
      const values = await loadTile(tile);
      const col0 = (tile.westM - west) / SOURCE_RESOLUTION_M;
      const row0 = (north - tile.northM) / SOURCE_RESOLUTION_M;
      for (let r = 0; r < tile.heightPx; r++) {
        const j = Math.floor((row0 + r) / pxPerCell);
        for (let c = 0; c < tile.widthPx; c++) {
          const v = values[r * tile.widthPx + c];
          if (!isValidSourceElevation(v)) continue;
          const k = j * def.widthCells + Math.floor((col0 + c) / pxPerCell);
          sum[k] += v;
          count[k]++;
        }
      }
      done++;
      log(`  kafel ${done}/${tiles.length} (E ${tile.westM}, N ${tile.northM}) gotowy`);
    }
  }
  log(`Pobieram NMT: ${tiles.length} kafli po ${TILE_SIZE_M} m (pierwsze pobranie trwa kilka–kilkanaście minut)…`);
  await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, () => worker()));

  const elevation = new Float32Array(cellCount);
  const minCount = MIN_VALID_FRACTION * pxPerCell * pxPerCell;
  for (let k = 0; k < cellCount; k++) elevation[k] = count[k] >= minCount ? sum[k] / count[k] : Number.NaN;

  // 4. Granica państwa.
  log('Pobieram granicę państwa z PRG…');
  const borderMarginM = 200;
  const borderLines = await loadBorder({ west, east, south, north }, borderMarginM);
  // Punkt odniesienia na pewno w Polsce: środek północnej krawędzi mapy (Korbielów).
  const refE = (west + east) / 2;
  const refN = north - cellSizeM / 2;
  let outsideCells = 0;
  let noDataInPolandCells = 0;
  for (let j = 0; j < def.heightCells; j++) {
    const n = north - (j + 0.5) * cellSizeM;
    for (let i = 0; i < def.widthCells; i++) {
      const e = west + (i + 0.5) * cellSizeM;
      let crossings = 0;
      for (const line of borderLines) {
        for (let s = 0; s + 1 < line.length; s++) {
          if (segmentsIntersect(e, n, refE, refN, line[s][0], line[s][1], line[s + 1][0], line[s + 1][1])) crossings++;
        }
      }
      const k = j * def.widthCells + i;
      if (crossings % 2 === 1) {
        outsideCells++;
        elevation[k] = Number.NaN;
      } else if (Number.isNaN(elevation[k])) {
        noDataInPolandCells++;
      }
    }
  }
  log(`  komórki po stronie słowackiej: ${outsideCells}; komórki bez danych NMT po stronie polskiej: ${noDataInPolandCells}`);
  if (noDataInPolandCells > 0) log('  UWAGA: po polskiej stronie są dziury w danych – sprawdź mapę.');

  // Statystyki.
  let minE = Infinity;
  let maxE = -Infinity;
  let minK = -1;
  let maxK = -1;
  let validCells = 0;
  for (let k = 0; k < cellCount; k++) {
    const h = elevation[k];
    if (Number.isNaN(h)) continue;
    validCells++;
    if (h < minE) { minE = h; minK = k; }
    if (h > maxE) { maxE = h; maxK = k; }
  }
  const cellCenter = (k: number) => ({
    eastingM: west + ((k % def.widthCells) + 0.5) * cellSizeM,
    northingM: north - (Math.floor(k / def.widthCells) + 0.5) * cellSizeM,
  });

  // 5. Punkty kontrolne.
  log('Odczytuję wysokości punktów kontrolnych z usługi GUGiK…');
  const controlPoints = [];
  for (const p of def.controlPoints) {
    const geoportalElevationM = await queryPointHeight(p.eastingM, p.northingM);
    const { latDeg, lonDeg } = puwg92ToLatLon(p.eastingM, p.northingM);
    controlPoints.push({
      name: p.name,
      eastingM: p.eastingM,
      northingM: p.northingM,
      latDeg: Number(latDeg.toFixed(6)),
      lonDeg: Number(lonDeg.toFixed(6)),
      geoportalElevationM,
    });
    log(`  ${p.name}: ${geoportalElevationM} m n.p.m.`);
  }

  // 6. Zapis.
  await writeFile(join(mapDir, def.elevationFile), Buffer.from(elevation.buffer));
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const today = new Date().toISOString().slice(0, 10);
  mapJson.import = {
    _opis: 'Wypełnia narzędzie src/tools/importNmt.ts – nie edytować ręcznie.',
    date: today,
    elevationSource: `GUGiK, Numeryczny Model Terenu (siatka ${SOURCE_RESOLUTION_M} m), usługa WCS ${WCS_URL}, pokrycie ${WCS_COVERAGE_ID}`,
    verticalDatum: 'PL-EVRF2007-NH (ten sam układ wysokości co w Geoportalu)',
    resampling: `średnia arytmetyczna ${pxPerCell} × ${pxPerCell} pikseli 1 m na komórkę; komórka bez danych, gdy ważnych pikseli < ${MIN_VALID_FRACTION * 100}%`,
    borderSource: `GUGiK, Państwowy Rejestr Granic, usługa WFS ${WFS_URL}, warstwa ${WFS_BORDER_TYPENAME}`,
    validCells: { value: validCells, unit: 'komórki', source: 'policzone przy imporcie' },
    outsideCells: { value: outsideCells, unit: 'komórki', source: 'policzone przy imporcie: komórki po stronie słowackiej' },
    noDataInPolandCells: { value: noDataInPolandCells, unit: 'komórki', source: 'policzone przy imporcie: dziury w NMT po stronie polskiej (powinno być 0)' },
    minElevationM: { value: round1(minE), unit: 'm n.p.m.', source: `policzone przy imporcie; komórka E ${cellCenter(minK).eastingM}, N ${cellCenter(minK).northingM}` },
    maxElevationM: { value: round1(maxE), unit: 'm n.p.m.', source: `policzone przy imporcie; komórka E ${cellCenter(maxK).eastingM}, N ${cellCenter(maxK).northingM}` },
  };
  mapJson.controlPoints = controlPoints;
  mapJson.controlPointsInfo =
    'Punkty do sprawdzenia mapy z Geoportalem. eastingM/northingM – PUWG 1992 [m] (E = geodezyjne Y, N = geodezyjne X); latDeg/lonDeg – stopnie; geoportalElevationM – wysokość z usługi GUGiK „wysokość w punkcie” [m n.p.m., EVRF2007] z dnia importu.';
  mapJson.border = {
    _opis: 'Granica państwa w pobliżu mapy, do rysowania. Punkty [E, N] w PUWG 1992 [m].',
    source: `GUGiK, PRG, warstwa ${WFS_BORDER_TYPENAME}, pobrano ${today}`,
    lines: borderLines.map((line) => line.map(([e, n]) => [round1(e), round1(n)])),
  };
  await writeFile(mapJsonPath, JSON.stringify(mapJson, null, 2) + '\n');
  log(`Zapisano ${join(mapDir, def.elevationFile)} i ${mapJsonPath}.`);
  log(`Wysokości: ${round1(minE)}–${round1(maxE)} m n.p.m.; ważnych komórek: ${validCells} z ${cellCount}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
