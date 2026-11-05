/**
 * Siatka terenu – wspólny stan świata gry.
 *
 * Układ współrzędnych (lokalny, w metrach):
 *   x – na wschód, od zachodniej (lewej) krawędzi mapy,
 *   y – na południe, od północnej (górnej) krawędzi mapy.
 * Komórka (i, j) to kolumna i (oś x) i wiersz j (oś y). Wartość komórki odnosi się
 * do jej środka: x = (i + 0,5) · rozmiar komórki, y = (j + 0,5) · rozmiar komórki.
 *
 * Warstwy trzymane są w tablicach typowanych (jedna liczba na komórkę, wiersz po wierszu).
 * W kolejnych etapach dojdą tu warstwy: nachylenie, ekspozycja, pokrycie, śnieg, mikroklimat.
 */
export class TerrainGrid {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellSizeM: number;
  /** Wysokość terenu w środku komórki [m n.p.m.]. */
  readonly elevationM: Float32Array;

  constructor(widthCells: number, heightCells: number, cellSizeM: number, elevationM?: Float32Array) {
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

  /** Czy punkt (w metrach) leży na mapie. */
  containsPointM(xM: number, yM: number): boolean {
    return xM >= 0 && yM >= 0 && xM <= this.widthM && yM <= this.heightM;
  }

  /**
   * Wysokość terenu w dowolnym punkcie mapy [m n.p.m.], interpolowana dwuliniowo między
   * środkami czterech najbliższych komórek. Poza mapą zwraca NaN.
   */
  sampleElevationM(xM: number, yM: number): number {
    if (!this.containsPointM(xM, yM)) return Number.NaN;
    const maxI = this.widthCells - 1;
    const maxJ = this.heightCells - 1;
    const fx = Math.min(Math.max(xM / this.cellSizeM - 0.5, 0), maxI);
    const fy = Math.min(Math.max(yM / this.cellSizeM - 0.5, 0), maxJ);
    const i0 = Math.min(Math.floor(fx), maxI - 1);
    const j0 = Math.min(Math.floor(fy), maxJ - 1);
    const tx = fx - i0;
    const ty = fy - j0;
    const e = this.elevationM;
    const w = this.widthCells;
    const top = e[j0 * w + i0] * (1 - tx) + e[j0 * w + i0 + 1] * tx;
    const bottom = e[(j0 + 1) * w + i0] * (1 - tx) + e[(j0 + 1) * w + i0 + 1] * tx;
    return top * (1 - ty) + bottom * ty;
  }

  /** Najniższa i najwyższa wysokość na mapie [m n.p.m.]. */
  elevationRangeM(): { minM: number; maxM: number } {
    let minM = Infinity;
    let maxM = -Infinity;
    for (const h of this.elevationM) {
      if (h < minM) minM = h;
      if (h > maxM) maxM = h;
    }
    return { minM, maxM };
  }
}
