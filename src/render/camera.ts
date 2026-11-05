/**
 * Kamera mapy: przeliczanie pikseli ekranu na metry terenu i odwrotnie, przesuwanie i zoom.
 *
 * Czysta matematyka – bez PixiJS i bez przeglądarki, dzięki czemu da się ją sprawdzić testami.
 *
 * Stan kamery:
 *  - środek widoku w metrach (centerXM, centerYM), w układzie mapy (x na wschód, y na południe),
 *  - skala: ile metrów terenu przypada na jeden piksel ekranu (metersPerPixel),
 *  - rozmiar okna w pikselach.
 *
 * Obrót: mapa może być obrócona o 180° (rotated = true – widok od Korbielowa: szczyt u góry,
 * północ na dole). Wtedy kierunki ekranu są odwrócone względem osi mapy.
 *
 * Ograniczenia:
 *  - największe oddalenie: cała mapa mieści się na ekranie,
 *  - największe przybliżenie: minMetersPerPixel (z data/settings.json, ok. 2 m/px),
 *  - mapy nie da się „zgubić”: przy przybliżeniu krawędź mapy nie odjeżdża w głąb ekranu,
 *    a gdy mapa jest mniejsza niż okno, cała pozostaje na ekranie.
 */
export interface ScreenPoint {
  xPx: number;
  yPx: number;
}

export interface WorldPoint {
  xM: number;
  yM: number;
}

export class Camera {
  readonly mapWidthM: number;
  readonly mapHeightM: number;
  readonly minMetersPerPixel: number;

  private _centerXM: number;
  private _centerYM: number;
  private _metersPerPixel: number;
  private _viewportWidthPx: number;
  private _viewportHeightPx: number;
  /** Mapa obrócona o 180° (północ na dole ekranu). */
  rotated = false;

  constructor(
    mapWidthM: number,
    mapHeightM: number,
    minMetersPerPixel: number,
    viewportWidthPx: number,
    viewportHeightPx: number,
  ) {
    if (!(mapWidthM > 0 && mapHeightM > 0)) throw new Error('Mapa musi mieć dodatni rozmiar');
    if (!(minMetersPerPixel > 0)) throw new Error('minMetersPerPixel musi być dodatnie');
    this.mapWidthM = mapWidthM;
    this.mapHeightM = mapHeightM;
    this.minMetersPerPixel = minMetersPerPixel;
    this._viewportWidthPx = Math.max(1, viewportWidthPx);
    this._viewportHeightPx = Math.max(1, viewportHeightPx);
    this._centerXM = mapWidthM / 2;
    this._centerYM = mapHeightM / 2;
    this._metersPerPixel = this.maxMetersPerPixel;
  }

  get centerXM(): number {
    return this._centerXM;
  }
  get centerYM(): number {
    return this._centerYM;
  }
  get metersPerPixel(): number {
    return this._metersPerPixel;
  }
  /** Ile pikseli ekranu przypada na metr terenu (odwrotność metersPerPixel). */
  get pixelsPerMeter(): number {
    return 1 / this._metersPerPixel;
  }
  get viewportWidthPx(): number {
    return this._viewportWidthPx;
  }
  get viewportHeightPx(): number {
    return this._viewportHeightPx;
  }

  /** Największe oddalenie: cała mapa widoczna na ekranie. */
  get maxMetersPerPixel(): number {
    const fit = Math.max(this.mapWidthM / this._viewportWidthPx, this.mapHeightM / this._viewportHeightPx);
    return Math.max(fit, this.minMetersPerPixel);
  }

  setViewport(widthPx: number, heightPx: number): void {
    this._viewportWidthPx = Math.max(1, widthPx);
    this._viewportHeightPx = Math.max(1, heightPx);
    this.setMetersPerPixel(this._metersPerPixel);
    this.clampCenter();
  }

  /** Znak kierunku: 1 – zwykle, −1 – mapa obrócona o 180°. */
  get sign(): number {
    return this.rotated ? -1 : 1;
  }

  /** Piksel ekranu → punkt terenu [m]. */
  screenToWorld(xPx: number, yPx: number): WorldPoint {
    const s = this.sign;
    return {
      xM: this._centerXM + s * (xPx - this._viewportWidthPx / 2) * this._metersPerPixel,
      yM: this._centerYM + s * (yPx - this._viewportHeightPx / 2) * this._metersPerPixel,
    };
  }

  /** Punkt terenu [m] → piksel ekranu. */
  worldToScreen(xM: number, yM: number): ScreenPoint {
    const s = this.sign;
    return {
      xPx: (s * (xM - this._centerXM)) / this._metersPerPixel + this._viewportWidthPx / 2,
      yPx: (s * (yM - this._centerYM)) / this._metersPerPixel + this._viewportHeightPx / 2,
    };
  }

  /** Przesunięcie mapy o zadaną liczbę pikseli (jak przy przeciąganiu: mapa jedzie za myszą). */
  panByPixels(dxPx: number, dyPx: number): void {
    const s = this.sign;
    this._centerXM -= s * dxPx * this._metersPerPixel;
    this._centerYM -= s * dyPx * this._metersPerPixel;
    this.clampCenter();
  }

  /** Obrót mapy o 180° wokół środka widoku. */
  toggleRotation(): void {
    this.rotated = !this.rotated;
  }

  /** Ustawia środek widoku na punkt terenu [m]. */
  centerOn(xM: number, yM: number): void {
    this._centerXM = xM;
    this._centerYM = yM;
    this.clampCenter();
  }

  /**
   * Zoom wycentrowany na kursorze: punkt terenu pod pikselem (xPx, yPx) zostaje pod tym samym
   * pikselem. zoomFactor > 1 przybliża, < 1 oddala.
   */
  zoomAt(xPx: number, yPx: number, zoomFactor: number): void {
    if (!(zoomFactor > 0)) return;
    const anchor = this.screenToWorld(xPx, yPx);
    this.setMetersPerPixel(this._metersPerPixel / zoomFactor);
    const s = this.sign;
    this._centerXM = anchor.xM - s * (xPx - this._viewportWidthPx / 2) * this._metersPerPixel;
    this._centerYM = anchor.yM - s * (yPx - this._viewportHeightPx / 2) * this._metersPerPixel;
    this.clampCenter();
  }

  /** Pokazuje całą mapę. */
  fitWholeMap(): void {
    this._metersPerPixel = this.maxMetersPerPixel;
    this._centerXM = this.mapWidthM / 2;
    this._centerYM = this.mapHeightM / 2;
  }

  private setMetersPerPixel(value: number): void {
    this._metersPerPixel = Math.min(Math.max(value, this.minMetersPerPixel), this.maxMetersPerPixel);
  }

  private clampCenter(): void {
    this._centerXM = clampAxis(this._centerXM, this.mapWidthM, this._viewportWidthPx * this._metersPerPixel);
    this._centerYM = clampAxis(this._centerYM, this.mapHeightM, this._viewportHeightPx * this._metersPerPixel);
  }
}

/**
 * Ograniczenie środka widoku w jednej osi:
 *  - widok węższy niż mapa – krawędź mapy nie może wejść w głąb ekranu,
 *  - widok szerszy niż mapa – mapa nie może wyjechać poza ekran (cała pozostaje widoczna).
 * Dzięki temu zoom zawsze trzyma punkt pod kursorem, a mapy nie da się „zgubić”.
 */
function clampAxis(centerM: number, mapSizeM: number, viewSizeM: number): number {
  const half = viewSizeM / 2;
  const low = Math.min(half, mapSizeM - half);
  const high = Math.max(half, mapSizeM - half);
  return Math.min(Math.max(centerM, low), high);
}
