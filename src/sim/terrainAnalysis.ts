/**
 * Analiza terenu: nachylenie, ekspozycja i cieniowanie rzeźby.
 *
 * Pochodne liczone metodą Horna (B.K.P. Horn, „Hill shading and the reflectance map”, 1981) –
 * tą samą co w GDAL i ArcGIS. Dla komórki e i jej sąsiadów:
 *
 *        a b c          dz/dx = ((c + 2f + i) − (a + 2d + g)) / (8 · Δ)      (x – na wschód)
 *        d e f          dz/dy = ((g + 2h + i) − (a + 2b + c)) / (8 · Δ)      (y – na południe)
 *        g h i
 *
 * Nachylenie [%] = 100 · √((dz/dx)² + (dz/dy)²);  [°] = atan(nachylenie / 100).
 * Ekspozycja = azymut kierunku spadku (0° = stok opada na północ, 90° = na wschód, 180° = na południe).
 *
 * Brzegi mapy i komórki sąsiadujące z obszarem „poza mapą”: brakującego sąsiada zastępuje się
 * ekstrapolacją liniową z sąsiada po przeciwnej stronie – na płaszczyźnie wynik jest wtedy
 * dokładny także na brzegu.
 */
import type { TerrainGrid } from './terrainGrid';

const RAD_TO_DEG = 180 / Math.PI;

/** Przeliczenie nachylenia z procentów na stopnie. */
export function slopePercentToDeg(slopePercent: number): number {
  return Math.atan(slopePercent / 100) * RAD_TO_DEG;
}

/** Przeliczenie nachylenia ze stopni na procenty. */
export function slopeDegToPercent(slopeDeg: number): number {
  return Math.tan(slopeDeg / RAD_TO_DEG) * 100;
}

/** Spadki terenu w komórce metodą Horna: dz/dx (na wschód) i dz/dy (na południe), bezwymiarowe. */
export function hornGradient(grid: TerrainGrid, i: number, j: number): { dzdx: number; dzdy: number } {
  const e = grid.elevationM;
  const w = grid.widthCells;
  const center = e[j * w + i];
  const raw = (di: number, dj: number): number => {
    const ii = i + di;
    const jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= w || jj >= grid.heightCells) return Number.NaN;
    return e[jj * w + ii];
  };
  // Brakujący sąsiad (brzeg mapy, obszar poza mapą): ekstrapolacja liniowa z sąsiada po
  // przeciwnej stronie (2·środek − przeciwny). Dla narożnika bez przeciwnego sąsiada –
  // z dwóch sąsiadów osiowych (płaszczyzna przez nie i środek). Gdy brak danych – wartość środka.
  const axis = (di: number, dj: number): number => {
    const v = raw(di, dj);
    if (!Number.isNaN(v)) return v;
    const opposite = raw(-di, -dj);
    return Number.isNaN(opposite) ? center : 2 * center - opposite;
  };
  const at = (di: number, dj: number): number => {
    if (di === 0 || dj === 0) return axis(di, dj);
    const v = raw(di, dj);
    if (!Number.isNaN(v)) return v;
    const opposite = raw(-di, -dj);
    if (!Number.isNaN(opposite)) return 2 * center - opposite;
    return axis(di, 0) + axis(0, dj) - center;
  };
  const a = at(-1, -1);
  const b = at(0, -1);
  const c = at(1, -1);
  const d = at(-1, 0);
  const f = at(1, 0);
  const g = at(-1, 1);
  const h = at(0, 1);
  const k = at(1, 1);
  const eightDelta = 8 * grid.cellSizeM;
  return {
    dzdx: (c + 2 * f + k - (a + 2 * d + g)) / eightDelta,
    dzdy: (g + 2 * h + k - (a + 2 * b + c)) / eightDelta,
  };
}

/**
 * Azymut kierunku spadku [°] (0 = N, 90 = E, 180 = S, 270 = W) ze spadków dz/dx (wschód)
 * i dz/dy (południe). Dla terenu idealnie płaskiego: NaN.
 */
export function aspectFromGradient(dzdx: number, dzdy: number): number {
  if (dzdx === 0 && dzdy === 0) return Number.NaN;
  // Kierunek spadku = −gradient. Składowa wschodnia: −dz/dx; północna: −dz/dN = +dz/dy (y na południe).
  const azimuth = Math.atan2(-dzdx, dzdy) * RAD_TO_DEG;
  // „+ 0” zamienia ewentualne −0 na 0.
  return azimuth < 0 ? azimuth + 360 : azimuth + 0;
}

/** Wypełnia warstwy nachylenia [%] i ekspozycji [°] siatki. */
export function computeSlopeAndAspect(grid: TerrainGrid): void {
  for (let j = 0; j < grid.heightCells; j++) {
    for (let i = 0; i < grid.widthCells; i++) {
      const k = grid.index(i, j);
      if (Number.isNaN(grid.elevationM[k])) {
        grid.slopePercent[k] = Number.NaN;
        grid.aspectDeg[k] = Number.NaN;
        continue;
      }
      const { dzdx, dzdy } = hornGradient(grid, i, j);
      grid.slopePercent[k] = 100 * Math.hypot(dzdx, dzdy);
      grid.aspectDeg[k] = aspectFromGradient(dzdx, dzdy);
    }
  }
}

export interface HillshadeParams {
  /** Azymut, z którego pada światło [°] (315 = z północnego zachodu, jak na mapach topograficznych). */
  lightAzimuthDeg: number;
  /** Wysokość światła nad horyzontem [°]. */
  lightAltitudeDeg: number;
  /** Przewyższenie pionowe (1 = bez przewyższenia). */
  zFactor: number;
}

/**
 * Cieniowanie rzeźby: jasność 0–1 każdej komórki = cosinus kąta między normalną do terenu
 * a kierunkiem światła (oświetlenie lambertowskie). NaN poza mapą.
 */
export function computeHillshade(grid: TerrainGrid, params: HillshadeParams): Float32Array {
  const out = new Float32Array(grid.cellCount);
  const az = params.lightAzimuthDeg / RAD_TO_DEG;
  const alt = params.lightAltitudeDeg / RAD_TO_DEG;
  // Wektor w stronę źródła światła: (wschód, północ, góra).
  const lightE = Math.sin(az) * Math.cos(alt);
  const lightN = Math.cos(az) * Math.cos(alt);
  const lightUp = Math.sin(alt);
  for (let j = 0; j < grid.heightCells; j++) {
    for (let i = 0; i < grid.widthCells; i++) {
      const k = grid.index(i, j);
      if (Number.isNaN(grid.elevationM[k])) {
        out[k] = Number.NaN;
        continue;
      }
      const { dzdx, dzdy } = hornGradient(grid, i, j);
      // Normalna do powierzchni z = f(E, N): (−dz/dE, −dz/dN, 1); dz/dN = −dz/dy.
      const nE = -dzdx * params.zFactor;
      const nN = dzdy * params.zFactor;
      const norm = Math.sqrt(nE * nE + nN * nN + 1);
      out[k] = Math.max(0, (nE * lightE + nN * lightN + lightUp) / norm);
    }
  }
  return out;
}
