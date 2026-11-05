/** Wygląd mapy: odczyt data/map-style.json. */
import { readNumber, readSection } from '../sim/params';
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
}

const FILE = 'data/map-style.json';

export function parseMapStyle(raw: unknown): MapStyle {
  const hs = readSection(raw, 'hillshade', FILE);
  const ct = readSection(raw, 'contours', FILE);
  const tx = readSection(raw, 'texture', FILE);
  const asp = readSection(raw, 'aspect', FILE);
  const tint = readSection(raw, 'elevationTint', FILE);
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
  };
  if (style.contours.majorIntervalM % style.contours.intervalM !== 0) {
    throw new Error(`${FILE}: majorIntervalM musi być wielokrotnością intervalM`);
  }
  return style;
}
