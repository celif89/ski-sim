/**
 * Model terenu okolicy (do liczenia cieni i horyzontu) – Copernicus DEM GLO-30.
 *
 * Uruchomienie:  npm run import-horizon-dem            (mapa domyślna: pilsko)
 *
 * Mapa gry kończy się na granicy państwa, ale kopuła Pilska (po stronie słowackiej) i okoliczne
 * grzbiety zacieniają stoki. Dlatego do liczenia horyzontu potrzebny jest grubszy model terenu
 * z szerszej okolicy, obejmujący też Słowację. Służy TYLKO do cieni, nie do gry.
 *
 * Źródło: Copernicus DEM GLO-30 (ESA / Airbus, © DLR e.V. 2010–2014 i © Airbus Defence and Space
 * GmbH 2014–2018), kafle 1° × 1° w siatce 1″ (ok. 30 m), dostępne publicznie w AWS Open Data.
 * To model POWIERZCHNI (DSM) – z lasem i budynkami; wysokości względem geoidy EGM2008.
 *
 * Co robi: pobiera potrzebny kafel do .cache/copernicus, przelicza na siatkę w PUWG 1992
 * (interpolacja dwuliniowa) i zapisuje data/maps/<mapa>/horizon-dem.f32 + opis w map.json.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromFile } from 'geotiff';
import { puwg92ToLatLon } from '../sim/geo';
import { parseMapDefinition } from '../sim/mapFile';
import { readNumber, readSection } from '../sim/params';

const CACHE_DIR = '.cache/copernicus';
/** Rozdzielczość kafli GLO-30 [°] (1 sekunda łuku). */
const TILE_RESOLUTION_DEG = 1 / 3600;

function tileName(latDeg: number, lonDeg: number): string {
  const lat = Math.floor(latDeg);
  const lon = Math.floor(lonDeg);
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `Copernicus_DSM_COG_10_${ns}${String(Math.abs(lat)).padStart(2, '0')}_00_${ew}${String(Math.abs(lon)).padStart(3, '0')}_00_DEM`;
}

function log(message: string): void {
  console.log(`[import-horizon-dem] ${message}`);
}

async function main(): Promise<void> {
  const mapName = process.argv[2] ?? 'pilsko';
  const mapJsonPath = join('data', 'maps', mapName, 'map.json');
  const mapJson = JSON.parse(await readFile(mapJsonPath, 'utf8')) as Record<string, unknown>;
  const def = parseMapDefinition(mapJson);
  const request = readSection(mapJson, 'horizonDemRequest', mapJsonPath);
  const sizeM = readNumber(request, 'sizeM', mapJsonPath, { min: 1000 });
  const cellSizeM = readNumber(request, 'cellSizeM', mapJsonPath, { min: 10 });
  const cells = Math.round(sizeM / cellSizeM);
  // Kwadrat wyśrodkowany na mapie gry, wyrównany do siatki co cellSizeM.
  const centerE = def.westEastingM + (def.widthCells * def.cellSizeM) / 2;
  const centerN = def.northNorthingM - (def.heightCells * def.cellSizeM) / 2;
  const west = Math.round((centerE - sizeM / 2) / cellSizeM) * cellSizeM;
  const north = Math.round((centerN + sizeM / 2) / cellSizeM) * cellSizeM;
  log(`Obszar: E ${west}–${west + cells * cellSizeM}, N ${north - cells * cellSizeM}–${north}, siatka ${cellSizeM} m (${cells} × ${cells})`);

  // Zakres współrzędnych geograficznych (narożniki).
  const corners = [
    puwg92ToLatLon(west, north),
    puwg92ToLatLon(west + sizeM, north),
    puwg92ToLatLon(west, north - sizeM),
    puwg92ToLatLon(west + sizeM, north - sizeM),
  ];
  const tiles = new Set(corners.map((c) => tileName(c.latDeg, c.lonDeg)));
  if (tiles.size !== 1) throw new Error(`Obszar obejmuje kilka kafli Copernicus (${[...tiles].join(', ')}) – to jeszcze nieobsługiwane`);
  const name = [...tiles][0];
  const tileLat = Math.floor(corners[0].latDeg);
  const tileLon = Math.floor(corners[0].lonDeg);
  const url = `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
  const file = join(CACHE_DIR, `${name}.tif`);
  if (!existsSync(file)) {
    log(`Pobieram kafel ${name} (ok. 40 MB)…`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Nie udało się pobrać ${url}: HTTP ${response.status}`);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  const tiff = await fromFile(file);
  const image = await tiff.getImage();
  const widthPx = image.getWidth();
  const heightPx = image.getHeight();
  // Kafle Copernicus: środki pikseli na pełnych stopniach (PixelIsPoint) – piksel (0, 0) to
  // (lon = tileLon, lat = tileLat + 1).
  const lon0 = tileLon;
  const lat0 = tileLat + 1;
  const colOf = (lon: number) => (lon - lon0) / TILE_RESOLUTION_DEG;
  const rowOf = (lat: number) => (lat0 - lat) / TILE_RESOLUTION_DEG;
  const minCol = Math.max(0, Math.floor(Math.min(...corners.map((c) => colOf(c.lonDeg)))) - 2);
  const maxCol = Math.min(widthPx - 1, Math.ceil(Math.max(...corners.map((c) => colOf(c.lonDeg)))) + 2);
  const minRow = Math.max(0, Math.floor(Math.min(...corners.map((c) => rowOf(c.latDeg)))) - 2);
  const maxRow = Math.min(heightPx - 1, Math.ceil(Math.max(...corners.map((c) => rowOf(c.latDeg)))) + 2);
  const winW = maxCol - minCol + 1;
  const rasters = await image.readRasters({ window: [minCol, minRow, maxCol + 1, maxRow + 1] });
  const src = rasters[0] as Float32Array;

  const out = new Float32Array(cells * cells);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const { latDeg, lonDeg } = puwg92ToLatLon(west + (i + 0.5) * cellSizeM, north - (j + 0.5) * cellSizeM);
      const fx = colOf(lonDeg) - minCol;
      const fy = rowOf(latDeg) - minRow;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const v = (xx: number, yy: number) => src[yy * winW + xx];
      const h =
        (v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty;
      out[j * cells + i] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  const outFile = 'horizon-dem.f32';
  await writeFile(join('data', 'maps', mapName, outFile), Buffer.from(out.buffer));
  const round1 = (x: number) => Math.round(x * 10) / 10;
  mapJson.horizonDem = {
    _opis: 'Model terenu okolicy (także Słowacja) – TYLKO do liczenia horyzontu i cieni. Wypełnia src/tools/importHorizonDem.ts.',
    file: outFile,
    encoding: 'Float32 little-endian; wiersze od północy, kolumny od zachodu; wysokość środka komórki [m n.p.m.]',
    westEastingM: { value: west, unit: 'm, PUWG 1992 E', source: 'kwadrat wyśrodkowany na mapie gry' },
    northNorthingM: { value: north, unit: 'm, PUWG 1992 N', source: 'kwadrat wyśrodkowany na mapie gry' },
    cellSizeM: { value: cellSizeM, unit: 'm', source: 'horizonDemRequest.cellSizeM' },
    widthCells: { value: cells, unit: 'komórki', source: 'sizeM / cellSizeM' },
    heightCells: { value: cells, unit: 'komórki', source: 'sizeM / cellSizeM' },
    minElevationM: { value: round1(minH), unit: 'm n.p.m.', source: 'policzone przy imporcie' },
    maxElevationM: { value: round1(maxH), unit: 'm n.p.m.', source: 'policzone przy imporcie' },
    source: `Copernicus DEM GLO-30 (DSM, geoida EGM2008), kafel ${name}, ${url}; interpolacja dwuliniowa do PUWG 1992`,
    license: 'Copernicus DEM: © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved',
    date: new Date().toISOString().slice(0, 10),
  };
  await writeFile(mapJsonPath, JSON.stringify(mapJson, null, 2) + '\n');
  log(`Zapisano ${outFile}: wysokości ${round1(minH)}–${round1(maxH)} m n.p.m.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
