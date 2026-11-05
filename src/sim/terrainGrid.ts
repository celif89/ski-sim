/**
 * Siatka terenu – wspólny stan świata gry.
 *
 * Układ współrzędnych lokalnych (w metrach):
 *   x – na wschód, od zachodniej (lewej) krawędzi mapy,
 *   y – na południe, od północnej (górnej) krawędzi mapy.
 * Komórka (i, j) to kolumna i (oś x) i wiersz j (oś y). Wartość komórki odnosi się
 * do jej środka: x = (i + 0,5) · rozmiar komórki, y = (j + 0,5) · rozmiar komórki.
 *
 * Jeśli siatka ma georeferencję (mapa z NMT), lokalne x, y przelicza się na PUWG 1992:
 *   E = westEastingM + x,   N = northNorthingM − y.
 *
 * Komórki „poza mapą” (np. po stronie słowackiej) mają wysokość NaN – nie ma tam danych
 * i nie wolno tam budować.
 *
 * Warstwy trzymane są w tablicach typowanych (jedna liczba na komórkę, wiersz po wierszu).
 */
export interface GeoReference {
  crs: 'EPSG:2180';
  /** Współrzędna E zachodniej krawędzi mapy [m]. */
  westEastingM: number;
  /** Współrzędna N północnej krawędzi mapy [m]. */
  northNorthingM: number;
}

export class TerrainGrid {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellSizeM: number;
  /** Wysokość terenu w środku komórki [m n.p.m.]; NaN = poza mapą. */
  readonly elevationM: Float32Array;
  /** Nachylenie [%] (100 % = 45°); NaN = poza mapą. Wypełnia computeSlopeAndAspect(). */
  readonly slopePercent: Float32Array;
  /** Ekspozycja – kierunek, w którym opada stok, azymut [°] 0 = N, 90 = E; NaN = płasko lub poza mapą. */
  readonly aspectDeg: Float32Array;
  readonly georef: GeoReference | null;

  constructor(
    widthCells: number,
    heightCells: number,
    cellSizeM: number,
    elevationM?: Float32Array,
    georef: GeoReference | null = null,
  ) {
    if (!Number.isInteger(widthCells) || !Number.isInteger(heightCells) || widthCells < 2 || heightCells < 2) {
      throw new Error(`Nieprawidłowe wymiary siatki: ${widthCells} × ${heightCells}`);
    }
    if (!(cellSizeM > 0)) throw new Error(`Nieprawidłowy rozmiar komórki: ${cellSizeM} m`);
    this.widthCells = widthCells;
    this.heightCells = heightCells;
    this.cellSizeM = cellSizeM;
    const cellCount = widthCells * heightCells;
    if (elevationM && elevationM.length !== cellCount) {
      throw new Error(`Warstwa wysokości ma ${elevationM.length} wartości, oczekiwano ${cellCount}`);
    }
    this.elevationM = elevationM ?? new Float32Array(cellCount);
    this.slopePercent = new Float32Array(cellCount).fill(Number.NaN);
    this.aspectDeg = new Float32Array(cellCount).fill(Number.NaN);
    this.georef = georef;
  }

  get cellCount(): number {
    return this.widthCells * this.heightCells;
  }

  /** Szerokość mapy (wschód–zachód) [m]. */
  get widthM(): number {
    return this.widthCells * this.cellSizeM;
  }

  /** Wysokość mapy (północ–południe) [m]. */
  get heightM(): number {
    return this.heightCells * this.cellSizeM;
  }

  /** Indeks komórki w tablicach warstw. */
  index(i: number, j: number): number {
    return j * this.widthCells + i;
  }

  getElevationM(i: number, j: number): number {
    return this.elevationM[this.index(i, j)];
  }

  /** Czy komórka należy do mapy (ma dane, nie leży np. na Słowacji). */
  isCellValid(i: number, j: number): boolean {
    return !Number.isNaN(this.elevationM[this.index(i, j)]);
  }

  /** Czy punkt (w metrach) leży w prostokącie mapy. */
  containsPointM(xM: number, yM: number): boolean {
    return xM >= 0 && yM >= 0 && xM <= this.widthM && yM <= this.heightM;
  }

  /** Komórka zawierająca punkt [m] (lub null poza prostokątem mapy). */
  cellAt(xM: number, yM: number): { i: number; j: number } | null {
    if (!this.containsPointM(xM, yM)) return null;
    return {
      i: Math.min(Math.floor(xM / this.cellSizeM), this.widthCells - 1),
      j: Math.min(Math.floor(yM / this.cellSizeM), this.heightCells - 1),
    };
  }

  /**
   * Wysokość terenu w dowolnym punkcie mapy [m n.p.m.], interpolowana dwuliniowo między
   * środkami czterech najbliższych komórek. Jeśli któraś z nich jest poza mapą – wartość
   * komórki zawierającej punkt (lub NaN). Poza prostokątem mapy: NaN.
   */
  sampleElevationM(xM: number, yM: number): number {
    return this.sampleLayer(this.elevationM, xM, yM);
  }

  /** Interpolacja dwuliniowa dowolnej warstwy (jak sampleElevationM). */
  sampleLayer(layer: Float32Array, xM: number, yM: number): number {
    if (!this.containsPointM(xM, yM)) return Number.NaN;
    const maxI = this.widthCells - 1;
    const maxJ = this.heightCells - 1;
    const fx = Math.min(Math.max(xM / this.cellSizeM - 0.5, 0), maxI);
    const fy = Math.min(Math.max(yM / this.cellSizeM - 0.5, 0), maxJ);
    const i0 = Math.min(Math.floor(fx), maxI - 1);
    const j0 = Math.min(Math.floor(fy), maxJ - 1);
    const tx = fx - i0;
    const ty = fy - j0;
    const w = this.widthCells;
    const v00 = layer[j0 * w + i0];
    const v10 = layer[j0 * w + i0 + 1];
    const v01 = layer[(j0 + 1) * w + i0];
    const v11 = layer[(j0 + 1) * w + i0 + 1];
    if (Number.isNaN(v00) || Number.isNaN(v10) || Number.isNaN(v01) || Number.isNaN(v11)) {
      const cell = this.cellAt(xM, yM)!;
      return layer[this.index(cell.i, cell.j)];
    }
    const top = v00 * (1 - tx) + v10 * tx;
    const bottom = v01 * (1 - tx) + v11 * tx;
    return top * (1 - ty) + bottom * ty;
  }

  /** Najniższa i najwyższa wysokość na mapie [m n.p.m.] (pomija komórki poza mapą). */
  elevationRangeM(): { minM: number; maxM: number } {
    let minM = Infinity;
    let maxM = -Infinity;
    for (const h of this.elevationM) {
      if (h < minM) minM = h;
      if (h > maxM) maxM = h;
    }
    return { minM, maxM };
  }

  /** Lokalne [m] → PUWG 1992 [m]. Wymaga georeferencji. */
  localToPuwg92(xM: number, yM: number): { eastingM: number; northingM: number } | null {
    if (!this.georef) return null;
    return { eastingM: this.georef.westEastingM + xM, northingM: this.georef.northNorthingM - yM };
  }

  /** PUWG 1992 [m] → lokalne [m]. Wymaga georeferencji. */
  puwg92ToLocal(eastingM: number, northingM: number): { xM: number; yM: number } | null {
    if (!this.georef) return null;
    return { xM: eastingM - this.georef.westEastingM, yM: this.georef.northNorthingM - northingM };
  }
}
