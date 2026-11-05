/** Wygląd mapy: odczyt data/map-style.json. */
import { readNumber, readSection } from '../sim/params';
import type { IllustrationStyle } from './terrainRenderer';
import type { ContourParams, HillshadeParams } from '../sim';

export interface MapStyle {
  hillshade: HillshadeParams & { strength: number };
  contours: ContourParams & {
    minorWidthM: number;
    majorWidthM: number;
    labelSpacingM: number;
    labelMinLineLengthM: number;
    labelFontSizeM: number;
  };
  baseMetersPerPixel: number;
  overlayMetersPerPixel: number;
  overlayOpacity: number;
  flatSlopePercent: number;
  tintLowM: number;
  tintHighM: number;
  insolationMaxWm2: number;
  radiationSumMaxKwhM2: number;
  temperatureRangeC: number;
  snowDepthMaxCm: number;
  forestTintStrength: number;
  illustrated: IllustrationStyle;
}

const FILE = 'data/map-style.json';

export function parseMapStyle(raw: unknown): MapStyle {
  const hs = readSection(raw, 'hillshade', FILE);
  const ct = readSection(raw, 'contours', FILE);
  const tx = readSection(raw, 'texture', FILE);
  const asp = readSection(raw, 'aspect', FILE);
  const tint = readSection(raw, 'elevationTint', FILE);
  const scales = readSection(raw, 'overlayScales', FILE);
  const style: MapStyle = {
    hillshade: {
      lightAzimuthDeg: readNumber(hs, 'lightAzimuthDeg', FILE, { min: 0, max: 360 }),
      lightAltitudeDeg: readNumber(hs, 'lightAltitudeDeg', FILE, { min: 1, max: 90 }),
      zFactor: readNumber(hs, 'zFactor', FILE, { min: 0.1, max: 10 }),
      strength: readNumber(hs, 'strength', FILE, { min: 0, max: 1 }),
    },
    contours: {
      intervalM: readNumber(ct, 'intervalM', FILE, { min: 0.5 }),
      majorIntervalM: readNumber(ct, 'majorIntervalM', FILE, { min: 0.5 }),
      minorWidthM: readNumber(ct, 'minorWidthM', FILE, { min: 0 }),
      majorWidthM: readNumber(ct, 'majorWidthM', FILE, { min: 0 }),
      labelSpacingM: readNumber(ct, 'labelSpacingM', FILE, { min: 10 }),
      labelMinLineLengthM: readNumber(ct, 'labelMinLineLengthM', FILE, { min: 0 }),
      labelFontSizeM: readNumber(ct, 'labelFontSizeM', FILE, { min: 1 }),
    },
    baseMetersPerPixel: readNumber(tx, 'baseMetersPerPixel', FILE, { min: 0.5 }),
    overlayMetersPerPixel: readNumber(tx, 'overlayMetersPerPixel', FILE, { min: 0.5 }),
    overlayOpacity: readNumber(tx, 'overlayOpacity', FILE, { min: 0, max: 1 }),
    flatSlopePercent: readNumber(asp, 'flatSlopePercent', FILE, { min: 0 }),
    tintLowM: readNumber(tint, 'lowElevationM', FILE),
    tintHighM: readNumber(tint, 'highElevationM', FILE),
    insolationMaxWm2: readNumber(scales, 'insolationMaxWm2', FILE, { min: 1 }),
    radiationSumMaxKwhM2: readNumber(scales, 'radiationSumMaxKwhM2', FILE, { min: 0.1 }),
    temperatureRangeC: readNumber(scales, 'temperatureRangeC', FILE, { min: 1 }),
    snowDepthMaxCm: readNumber(scales, 'snowDepthMaxCm', FILE, { min: 1 }),
    forestTintStrength: readNumber(readSection(raw, 'forest', FILE), 'tintStrength', FILE, { min: 0, max: 1 }),
    illustrated: parseIllustration(readSection(raw, 'illustrated', FILE)),
  };
  if (style.contours.majorIntervalM % style.contours.intervalM !== 0) {
    throw new Error(`${FILE}: majorIntervalM musi być wielokrotnością intervalM`);
  }
  return style;
}

function parseIllustration(sec: Record<string, unknown>): IllustrationStyle {
  const n = (o: Record<string, unknown>, k: string, opt: { min?: number; max?: number } = {}) => readNumber(o, k, FILE, opt);
  const sub = (k: string) => readSection(sec, k, FILE);
  const lod = sub('lod');
  const ti = sub('treeIcons');
  const tr = sub('trees');
  const sh = sub('shrub');
  const su = sub('surface');
  const out: IllustrationStyle = {
    lod: { level1AboveMpp: n(lod, 'level1AboveMpp', { min: 0.01 }), level3BelowMpp: n(lod, 'level3BelowMpp', { min: 0.01 }), blendOctaves: n(lod, 'blendOctaves', { min: 0.01, max: 2 }) },
    treeIcons: { spacingM: n(ti, 'spacingM', { min: 1 }), heightM: n(ti, 'heightM', { min: 1 }), widthRatio: n(ti, 'widthRatio', { min: 0.1, max: 2 }) },
    trees: { spacingM: n(tr, 'spacingM', { min: 1 }), heightM: n(tr, 'heightM', { min: 1 }), widthRatio: n(tr, 'widthRatio', { min: 0.1, max: 2 }) },
    shrub: { spacingM: n(sh, 'spacingM', { min: 0.5 }), radius: n(sh, 'radius', { min: 0.05, max: 1 }), iconSpacingM: n(sh, 'iconSpacingM', { min: 0.5 }), iconRadius: n(sh, 'iconRadius', { min: 0.05, max: 1 }) },
    maskMetersPerPixel: n(sec, 'maskMetersPerPixel', { min: 0.25 }),
    surface: { groomedMin: n(su, 'groomedMin', { min: 0, max: 1 }), skiedMin: n(su, 'skiedMin', { min: 0, max: 1 }), mogulsMin: n(su, 'mogulsMin', { min: 0, max: 1 }) },
    tracksHalfLifeS: n(sec, 'tracksHalfLifeS', { min: 1 }),
    tracksSnowfallFactor: n(sec, 'tracksSnowfallFactor', { min: 0 }),
    reliefZFactor: n(sec, 'reliefZFactor', { min: 0.1, max: 10 }),
    tiles: (() => {
      const t = sub('tiles');
      return {
        tilePx: n(t, 'tilePx', { min: 32, max: 2048 }),
        coarsestMpp: n(t, 'coarsestMpp', { min: 0.1 }),
        levels: n(t, 'levels', { min: 1, max: 12 }),
        bakeBudgetMs: n(t, 'bakeBudgetMs', { min: 1 }),
        maxTiles: n(t, 'maxTiles', { min: 16 }),
        fadeInS: n(t, 'fadeInS', { min: 0 }),
      };
    })(),
  };
  if (out.lod.level3BelowMpp >= out.lod.level1AboveMpp) throw new Error(`${FILE}: level3BelowMpp musi być mniejsze niż level1AboveMpp`);
  return out;
}
