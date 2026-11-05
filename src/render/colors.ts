/** Kolory mapy: skala hipsometryczna, ekspozycja, pomocnicze przeliczenia. */

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToCss([r, g, b]: Rgb, alpha = 1): string {
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface Stop {
  t: number;
  color: Rgb;
}

function sampleStops(stops: Stop[], t: number, out: Rgb): Rgb {
  if (Number.isNaN(t)) t = 0;
  if (t <= stops[0].t) {
    out[0] = stops[0].color[0];
    out[1] = stops[0].color[1];
    out[2] = stops[0].color[2];
    return out;
  }
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k].t) {
      const a = stops[k - 1];
      const b = stops[k];
      const u = (t - a.t) / (b.t - a.t);
      out[0] = a.color[0] + (b.color[0] - a.color[0]) * u;
      out[1] = a.color[1] + (b.color[1] - a.color[1]) * u;
      out[2] = a.color[2] + (b.color[2] - a.color[2]) * u;
      return out;
    }
  }
  const last = stops[stops.length - 1].color;
  out[0] = last[0];
  out[1] = last[1];
  out[2] = last[2];
  return out;
}

/**
 * Barwy hipsometryczne w stylu map topograficznych: jasna zieleń w dolinach, przez beż,
 * do jasnego brązu i bieli na grzbietach. t = 0 (nisko) … 1 (wysoko).
 */
const TINT_STOPS: Stop[] = [
  { t: 0, color: [196, 219, 170] },
  { t: 0.3, color: [222, 230, 184] },
  { t: 0.6, color: [236, 224, 190] },
  { t: 0.85, color: [232, 214, 186] },
  { t: 1, color: [246, 240, 232] },
];

export function elevationTint(t: number, out: Rgb): Rgb {
  return sampleStops(TINT_STOPS, t, out);
}

/**
 * Kolory ekspozycji: stoki północne zimne (niebieskie), południowe ciepłe (czerwono-pomarańczowe),
 * wschodnie zielonkawo-żółte, zachodnie fioletowe – żeby dało się je odróżnić.
 */
export const ASPECT_STOPS_DEG: { deg: number; color: Rgb; label: string }[] = [
  { deg: 0, color: [38, 99, 196], label: 'N' },
  { deg: 45, color: [42, 163, 184], label: 'NE' },
  { deg: 90, color: [139, 196, 92], label: 'E' },
  { deg: 135, color: [240, 200, 60], label: 'SE' },
  { deg: 180, color: [230, 85, 40], label: 'S' },
  { deg: 225, color: [232, 130, 70], label: 'SW' },
  { deg: 270, color: [176, 120, 200], label: 'W' },
  { deg: 315, color: [92, 96, 200], label: 'NW' },
  { deg: 360, color: [38, 99, 196], label: 'N' },
];
const ASPECT_STOPS: Stop[] = ASPECT_STOPS_DEG.map((s) => ({ t: s.deg, color: s.color }));

export function aspectColor(aspectDeg: number, out: Rgb): Rgb {
  return sampleStops(ASPECT_STOPS, ((aspectDeg % 360) + 360) % 360, out);
}

export const FLAT_COLOR: Rgb = [200, 200, 200];
export const OUTSIDE_COLOR: Rgb = [176, 178, 182];
export const OUTSIDE_HATCH_COLOR: Rgb = [150, 152, 158];
export const CONTOUR_MINOR_CSS = 'rgba(150, 95, 45, 0.55)';
export const CONTOUR_MAJOR_CSS = 'rgba(125, 70, 25, 0.9)';
export const CONTOUR_LABEL_CSS = 'rgb(115, 62, 20)';
export const BORDER_CSS = 'rgba(200, 30, 60, 0.95)';

/** Nazwa kierunku (8 kierunków) dla azymutu [°]. */
export function compassName(aspectDeg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((aspectDeg % 360) + 360) % 360) / 45) % 8];
}

/** Kolor ze skali (t = 0…1, poza zakresem – kolor skrajny). */
export function sampleColorStops(stops: Stop[], t: number, out: Rgb): Rgb {
  return sampleStops(stops, t, out);
}

/** Skala promieniowania (suma dobowa i chwilowe): ciemny fiolet → czerwień → pomarańcz → jasna żółć. */
export const RADIATION_SUM_STOPS: Stop[] = [
  { t: 0, color: [26, 16, 60] },
  { t: 0.2, color: [86, 30, 110] },
  { t: 0.4, color: [158, 42, 99] },
  { t: 0.6, color: [221, 81, 58] },
  { t: 0.8, color: [250, 155, 40] },
  { t: 1, color: [252, 236, 140] },
];

/**
 * Skala temperatury (rozbieżna): poniżej 0 °C odcienie niebieskiego, powyżej – pomarańczu i czerwieni.
 * Na 0 °C kolor zmienia się skokowo, więc linia zera (śnieg/deszcz) jest dobrze widoczna.
 */
export const TEMPERATURE_STOPS: Stop[] = [
  { t: 0, color: [35, 55, 150] },
  { t: 0.3, color: [70, 130, 215] },
  { t: 0.4999, color: [170, 210, 245] },
  { t: 0.5001, color: [252, 205, 150] },
  { t: 0.7, color: [240, 140, 80] },
  { t: 1, color: [175, 40, 40] },
];

/** Las na mapie bazowej – ciemna zieleń mieszana z barwą terenu. */
export const FOREST_COLOR: Rgb = [92, 128, 82];

/** Grubość śniegu: od cienkiej (jasnoszary błękit) przez biel do głębokiego niebieskiego i fioletu. */
export const SNOW_DEPTH_STOPS: Stop[] = [
  { t: 0, color: [214, 205, 186] },
  { t: 0.1, color: [236, 240, 245] },
  { t: 0.3, color: [168, 206, 240] },
  { t: 0.55, color: [86, 148, 220] },
  { t: 0.8, color: [52, 82, 180] },
  { t: 1, color: [88, 40, 140] },
];

/** Kolory stanów śniegu (kolejność jak SNOW_QUALITY_CODES: brak, puch, przewiany, osiadły, firn, breja, zlodzony, przetarty). */
export const SNOW_QUALITY_COLORS: Rgb[] = [
  [0, 0, 0],
  [250, 252, 255],
  [150, 190, 230],
  [196, 206, 220],
  [240, 205, 120],
  [110, 160, 150],
  [60, 120, 210],
  [176, 150, 110],
];
