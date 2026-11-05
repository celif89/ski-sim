/**
 * TYMCZASOWY generator terenu (etap 0): jedna łagodna góra z dolinami rozchodzącymi się
 * promieniście od szczytu, plus drobne nierówności. Służy tylko temu, żeby było co oglądać.
 * W etapie 1 zastąpi go import Numerycznego Modelu Terenu (NMT) z Geoportalu.
 *
 * Budowa terenu:
 *  1. Kopuła góry: wysokość względna maleje z odległością r od szczytu jak exp(−(r/R)²).
 *  2. Doliny: N rynien o przekroju gaussowskim, biegnących od szczytu na zewnątrz.
 *     Głębokość rośnie płynnie od zera (blisko szczytu) do pełnej (u podnóża).
 *  3. Meandrowanie: współrzędne są lekko „wykrzywiane” szumem, więc doliny i grzbiety nie są proste.
 *  4. Drobne nierówności: szum wielowarstwowy.
 *  5. Przeskalowanie liniowe do zadanego zakresu wysokości (min–max z pliku danych).
 */
import { GradientNoise2D } from './noise';
import { readNumber, readSection } from './params';
import { Rng } from './rng';
import { TerrainGrid } from './terrainGrid';
import { parseGridSettings } from './settings';
import type { MapSettings } from './settings';

export interface TerrainGeneratorParams {
  /** Wymiary siatki generowanego terenu. */
  grid: MapSettings;
  minElevationM: number;
  maxElevationM: number;
  summitXFraction: number;
  summitYFraction: number;
  radiusM: number;
  reliefM: number;
  valleyCount: number;
  valleyDepthM: number;
  valleyHalfWidthM: number;
  valleyTopWidthFraction: number;
  valleyMinDepthFraction: number;
  valleyStartDistanceM: number;
  valleyFullDepthDistanceM: number;
  valleyAngleJitterFraction: number;
  warpAmplitudeM: number;
  warpWavelengthM: number;
  warpOctaves: number;
  detailAmplitudeM: number;
  detailWavelengthM: number;
  detailOctaves: number;
  detailPersistence: number;
  detailLacunarity: number;
}

const FILE = 'data/terrain-generator.json';

export function parseTerrainGeneratorParams(raw: unknown): TerrainGeneratorParams {
  const elev = readSection(raw, 'elevation', FILE);
  const mountain = readSection(raw, 'mountain', FILE);
  const valleys = readSection(raw, 'valleys', FILE);
  const noise = readSection(raw, 'noise', FILE);
  const params: TerrainGeneratorParams = {
    grid: parseGridSettings(readSection(raw, 'grid', FILE), FILE),
    minElevationM: readNumber(elev, 'minElevationM', FILE),
    maxElevationM: readNumber(elev, 'maxElevationM', FILE),
    summitXFraction: readNumber(mountain, 'summitXFraction', FILE, { min: 0, max: 1 }),
    summitYFraction: readNumber(mountain, 'summitYFraction', FILE, { min: 0, max: 1 }),
    radiusM: readNumber(mountain, 'radiusM', FILE, { min: 1 }),
    reliefM: readNumber(mountain, 'reliefM', FILE, { min: 1 }),
    valleyCount: readNumber(valleys, 'count', FILE, { integer: true, min: 0 }),
    valleyDepthM: readNumber(valleys, 'depthM', FILE, { min: 0 }),
    valleyHalfWidthM: readNumber(valleys, 'halfWidthM', FILE, { min: 1 }),
    valleyTopWidthFraction: readNumber(valleys, 'topWidthFraction', FILE, { min: 0.01, max: 1 }),
    valleyMinDepthFraction: readNumber(valleys, 'minDepthFraction', FILE, { min: 0, max: 1 }),
    valleyStartDistanceM: readNumber(valleys, 'startDistanceM', FILE, { min: 0 }),
    valleyFullDepthDistanceM: readNumber(valleys, 'fullDepthDistanceM', FILE, { min: 0 }),
    valleyAngleJitterFraction: readNumber(valleys, 'angleJitterFraction', FILE, { min: 0, max: 0.5 }),
    warpAmplitudeM: readNumber(noise, 'warpAmplitudeM', FILE, { min: 0 }),
    warpWavelengthM: readNumber(noise, 'warpWavelengthM', FILE, { min: 1 }),
    warpOctaves: readNumber(noise, 'warpOctaves', FILE, { integer: true, min: 1, max: 8 }),
    detailAmplitudeM: readNumber(noise, 'detailAmplitudeM', FILE, { min: 0 }),
    detailWavelengthM: readNumber(noise, 'detailWavelengthM', FILE, { min: 1 }),
    detailOctaves: readNumber(noise, 'detailOctaves', FILE, { integer: true, min: 1, max: 12 }),
    detailPersistence: readNumber(noise, 'detailPersistence', FILE, { min: 0, max: 1 }),
    detailLacunarity: readNumber(noise, 'detailLacunarity', FILE, { min: 1 }),
  };
  if (params.maxElevationM <= params.minElevationM) {
    throw new Error(`${FILE}: maxElevationM musi być większe od minElevationM`);
  }
  if (params.valleyFullDepthDistanceM <= params.valleyStartDistanceM) {
    throw new Error(`${FILE}: fullDepthDistanceM musi być większe od startDistanceM`);
  }
  return params;
}

/** Płynne przejście 0 → 1 między a i b (funkcja „smoothstep”). */
function smoothStep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Kąt sprowadzony do zakresu (−π, π]. */
function wrapAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  let a = angle % twoPi;
  if (a <= -Math.PI) a += twoPi;
  if (a > Math.PI) a -= twoPi;
  return a;
}

/**
 * Tworzy siatkę terenu z ziarna. Ten sam seed i te same parametry dają zawsze identyczny teren.
 */
export function generateTerrain(map: MapSettings, params: TerrainGeneratorParams, seed: number): TerrainGrid {
  const grid = new TerrainGrid(map.widthCells, map.heightCells, map.cellSizeM);
  const rng = new Rng(seed).fork('teren-tymczasowy');

  const warpNoiseX = new GradientNoise2D(rng.fork('meandry-x'));
  const warpNoiseY = new GradientNoise2D(rng.fork('meandry-y'));
  const detailNoise = new GradientNoise2D(rng.fork('nierownosci'));

  const valleyRng = rng.fork('doliny');
  const baseAngle = valleyRng.range(0, 2 * Math.PI);
  const spacing = (2 * Math.PI) / Math.max(params.valleyCount, 1);
  const valleyAngles: number[] = [];
  for (let k = 0; k < params.valleyCount; k++) {
    const jitter = valleyRng.range(-1, 1) * params.valleyAngleJitterFraction * spacing;
    valleyAngles.push(baseAngle + k * spacing + jitter);
  }
  // Każda dolina ma nieco inną głębokość (od minDepthFraction do 100% wartości z pliku danych).
  const valleyDepthScale = valleyAngles.map(() => valleyRng.range(params.valleyMinDepthFraction, 1));

  const summitXM = params.summitXFraction * grid.widthM;
  const summitYM = params.summitYFraction * grid.heightM;
  const radiusSq = params.radiusM * params.radiusM;

  const raw = new Float64Array(grid.cellCount);
  for (let j = 0; j < grid.heightCells; j++) {
    for (let i = 0; i < grid.widthCells; i++) {
      const xM = (i + 0.5) * grid.cellSizeM;
      const yM = (j + 0.5) * grid.cellSizeM;

      // 3. Meandrowanie – przesunięcie punktu o pole szumu.
      const wx = xM / params.warpWavelengthM;
      const wy = yM / params.warpWavelengthM;
      const xw = xM + params.warpAmplitudeM * warpNoiseX.fractal(wx, wy, params.warpOctaves, params.detailPersistence, params.detailLacunarity);
      const yw = yM + params.warpAmplitudeM * warpNoiseY.fractal(wx, wy, params.warpOctaves, params.detailPersistence, params.detailLacunarity);

      const dx = xw - summitXM;
      const dy = yw - summitYM;
      const rSq = dx * dx + dy * dy;
      const r = Math.sqrt(rSq);

      // 1. Kopuła góry.
      let h = params.reliefM * Math.exp(-rSq / radiusSq);

      // 2. Doliny.
      if (params.valleyCount > 0 && r > 0) {
        const angle = Math.atan2(dy, dx);
        const depthRamp = smoothStep(params.valleyStartDistanceM, params.valleyFullDepthDistanceM, r);
        // Dolina rozszerza się w dół: od topWidthFraction szerokości przy szczycie do 100% u podnóża.
        const topFraction = params.valleyTopWidthFraction;
        const halfWidthM = params.valleyHalfWidthM * (topFraction + (1 - topFraction) * depthRamp);
        let valleyCut = 0;
        for (let k = 0; k < valleyAngles.length; k++) {
          const dAngle = wrapAngle(angle - valleyAngles[k]);
          if (Math.abs(dAngle) >= Math.PI / 2) continue;
          const distanceFromAxisM = r * Math.sin(Math.abs(dAngle));
          const profile = Math.exp(-(distanceFromAxisM * distanceFromAxisM) / (halfWidthM * halfWidthM));
          valleyCut = Math.max(valleyCut, valleyDepthScale[k] * profile);
        }
        h -= params.valleyDepthM * depthRamp * valleyCut;
      }

      // 4. Drobne nierówności.
      h +=
        params.detailAmplitudeM *
        detailNoise.fractal(
          xM / params.detailWavelengthM,
          yM / params.detailWavelengthM,
          params.detailOctaves,
          params.detailPersistence,
          params.detailLacunarity,
        );

      raw[grid.index(i, j)] = h;
    }
  }

  // 5. Przeskalowanie do zakresu min–max.
  let rawMin = Infinity;
  let rawMax = -Infinity;
  for (const h of raw) {
    if (h < rawMin) rawMin = h;
    if (h > rawMax) rawMax = h;
  }
  const scale = (params.maxElevationM - params.minElevationM) / (rawMax - rawMin || 1);
  for (let k = 0; k < raw.length; k++) {
    const h = params.minElevationM + (raw[k] - rawMin) * scale;
    // Zabezpieczenie przed błędem zaokrąglenia do liczby 32-bitowej na krańcach zakresu.
    grid.elevationM[k] = Math.min(Math.max(h, params.minElevationM), params.maxElevationM);
  }
  return grid;
}
