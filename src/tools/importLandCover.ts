/**
 * Pokrycie terenu (las / kosodrzewina / zabudowa / teren otwarty) – ESA WorldCover 10 m (2021, v200).
 *
 * Uruchomienie:  npm run import-landcover            (mapa domyślna: pilsko)
 *
 * Źródło: ESA WorldCover 10 m 2021 v200 (Zanaga i in. 2022), licencja CC BY 4.0, publicznie
 * w AWS Open Data. Klasy: 10 – las (drzewa), 20 – zarośla (tu: kosodrzewina), 50 – zabudowa,
 * 80 – wody, pozostałe – teren otwarty (łąki, hale, pola).
 * BDOT10k (GUGiK) byłby dokładniejszy, ale udostępniany jest w paczkach na cały powiat; WorldCover
 * wystarcza do modelu śniegu (las w siatce 10 m).
 *
 * Wynik: data/maps/<mapa>/landcover.u8 – trzy warstwy po jednym bajcie na komórkę (wiersze od
 * północy): udział lasu [%], udział kosodrzewiny [%], udział zabudowy [%]; opis w map.json.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromFile } from 'geotiff';
import { puwg92ToLatLon } from '../sim/geo';
import { parseMapDefinition } from '../sim/mapFile';

const CACHE_DIR = '.cache/worldcover';
const TILE_DEG = 3;
/** Liczba punktów próbkowania w komórce gry w każdym kierunku (4 × 4 = 16 punktów co 2,5 m). */
const SUBSAMPLES = 4;
const CLASS_TREES = 10;
const CLASS_SHRUB = 20;
const CLASS_BUILT = 50;

function log(m: string): void {
  console.log(`[import-landcover] ${m}`);
}

function tileName(latDeg: number, lonDeg: number): string {
  const lat = Math.floor(latDeg / TILE_DEG) * TILE_DEG;
  const lon = Math.floor(lonDeg / TILE_DEG) * TILE_DEG;
  return `ESA_WorldCover_10m_2021_v200_N${String(lat).padStart(2, '0')}E${String(lon).padStart(3, '0')}_Map`;
}

async function main(): Promise<void> {
  const mapName = process.argv[2] ?? 'pilsko';
  const mapJsonPath = join('data', 'maps', mapName, 'map.json');
  const mapJson = JSON.parse(await readFile(mapJsonPath, 'utf8')) as Record<string, unknown>;
  const def = parseMapDefinition(mapJson);
  const corner = puwg92ToLatLon(def.westEastingM, def.northNorthingM);
  const name = tileName(corner.latDeg - 0.01, corner.lonDeg);
  const file = join(CACHE_DIR, `${name}.tif`);
  if (!existsSync(file)) {
    const url = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${name}.tif`;
    log(`Pobieram ${url} (ok. 100 MB)…`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} dla ${url}`);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  const image = await (await fromFile(file)).getImage();
  const [lon0, , , lat1] = image.getBoundingBox();
  const [resX, resY] = image.getResolution();
  // Okno pikseli obejmujące mapę (z zapasem).
  const pts = [
    puwg92ToLatLon(def.westEastingM, def.northNorthingM),
    puwg92ToLatLon(def.westEastingM + def.widthCells * def.cellSizeM, def.northNorthingM),
    puwg92ToLatLon(def.westEastingM, def.northNorthingM - def.heightCells * def.cellSizeM),
    puwg92ToLatLon(def.westEastingM + def.widthCells * def.cellSizeM, def.northNorthingM - def.heightCells * def.cellSizeM),
  ];
  const col = (lon: number) => (lon - lon0) / resX;
  const row = (lat: number) => (lat - lat1) / resY; // resY < 0
  const c0 = Math.floor(Math.min(...pts.map((p) => col(p.lonDeg)))) - 2;
  const c1 = Math.ceil(Math.max(...pts.map((p) => col(p.lonDeg)))) + 2;
  const r0 = Math.floor(Math.min(...pts.map((p) => row(p.latDeg)))) - 2;
  const r1 = Math.ceil(Math.max(...pts.map((p) => row(p.latDeg)))) + 2;
  const w = c1 - c0;
  const raster = (await image.readRasters({ window: [c0, r0, c1, r1] }))[0] as Uint8Array;

  const n = def.widthCells * def.heightCells;
  const out = new Uint8Array(3 * n);
  const totals = { forest: 0, shrub: 0, built: 0 };
  for (let j = 0; j < def.heightCells; j++) {
    for (let i = 0; i < def.widthCells; i++) {
      let trees = 0;
      let shrub = 0;
      let built = 0;
      for (let sj = 0; sj < SUBSAMPLES; sj++) {
        for (let si = 0; si < SUBSAMPLES; si++) {
          const e = def.westEastingM + (i + (si + 0.5) / SUBSAMPLES) * def.cellSizeM;
          const nn = def.northNorthingM - (j + (sj + 0.5) / SUBSAMPLES) * def.cellSizeM;
          const ll = puwg92ToLatLon(e, nn);
          const cls = raster[(Math.floor(row(ll.latDeg)) - r0) * w + (Math.floor(col(ll.lonDeg)) - c0)];
          if (cls === CLASS_TREES) trees++;
          else if (cls === CLASS_SHRUB) shrub++;
          else if (cls === CLASS_BUILT) built++;
        }
      }
      const k = j * def.widthCells + i;
      const s = SUBSAMPLES * SUBSAMPLES;
      out[k] = Math.round((100 * trees) / s);
      out[n + k] = Math.round((100 * shrub) / s);
      out[2 * n + k] = Math.round((100 * built) / s);
      totals.forest += trees / s;
      totals.shrub += shrub / s;
      totals.built += built / s;
    }
  }
  const outFile = 'landcover.u8';
  await writeFile(join('data', 'maps', mapName, outFile), out);
  const pct = (x: number) => Math.round((1000 * x) / n) / 10;
  mapJson.landCover = {
    _opis: 'Pokrycie terenu – wypełnia src/tools/importLandCover.ts (npm run import-landcover).',
    file: outFile,
    encoding: 'trzy warstwy Uint8 po kolei (każda: wiersze od północy, kolumny od zachodu): udział lasu [%], udział kosodrzewiny/zarośli [%], udział zabudowy [%]',
    source: `ESA WorldCover 10 m 2021 v200, kafel ${name}; ${SUBSAMPLES * SUBSAMPLES} punktów próbkowania na komórkę`,
    license: 'ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium; CC BY 4.0',
    date: new Date().toISOString().slice(0, 10),
    forestPercentOfMap: { value: pct(totals.forest), unit: '%', source: 'policzone przy imporcie' },
    shrubPercentOfMap: { value: pct(totals.shrub), unit: '%', source: 'policzone przy imporcie' },
    builtPercentOfMap: { value: pct(totals.built), unit: '%', source: 'policzone przy imporcie' },
  };
  await writeFile(mapJsonPath, JSON.stringify(mapJson, null, 2) + '\n');
  log(`Zapisano ${outFile}: las ${pct(totals.forest)} %, kosodrzewina ${pct(totals.shrub)} %, zabudowa ${pct(totals.built)} % mapy.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
