/** Ustawienia widoku odczytywane z sekcji „view” pliku data/settings.json. */
import { readNumber, readSection } from '../sim/params';

export interface ViewSettings {
  minMetersPerPixel: number;
  wheelZoomFactorPerNotch: number;
  keyboardPanSpeedPxPerS: number;
  scaleBarMaxWidthPx: number;
  /** Widok od Korbielowa (mapa obrócona o 180°). */
  rotatedByDefault: boolean;
}

const FILE = 'data/settings.json';

export function parseViewSettings(raw: unknown): ViewSettings {
  const view = readSection(raw, 'view', FILE);
  return {
    minMetersPerPixel: readNumber(view, 'minMetersPerPixel', FILE, { min: 0.01 }),
    wheelZoomFactorPerNotch: readNumber(view, 'wheelZoomFactorPerNotch', FILE, { min: 1.001, max: 4 }),
    keyboardPanSpeedPxPerS: readNumber(view, 'keyboardPanSpeedPxPerS', FILE, { min: 1 }),
    scaleBarMaxWidthPx: readNumber(view, 'scaleBarMaxWidthPx', FILE, { min: 20 }),
    rotatedByDefault: readNumber(view, 'rotatedByDefault', FILE, { min: 0, max: 1, integer: true }) === 1,
  };
}
