/**
 * Obsługa myszy i klawiatury: przeciąganie mapy, zoom kółkiem (wycentrowany na kursorze),
 * przesuwanie strzałkami lub WASD, zoom klawiszami + / −, cała mapa klawiszem 0 lub Home.
 */
import type { Camera } from './camera';
import type { ViewSettings } from './viewSettings';

/** Umowna wartość deltaY jednego ząbka kółka myszy w przeglądarkach [px]. */
const WHEEL_PIXELS_PER_NOTCH = 100;
/** Przeliczenie wierszy na piksele (Firefox podaje przewinięcie w wierszach). */
const WHEEL_PIXELS_PER_LINE = 16;
/** Gest „szczypania” na gładziku Maca przychodzi jako kółko z ctrlKey i małymi wartościami. */
const PINCH_SENSITIVITY_MULTIPLIER = 4;
/** Przesunięcie myszy [px], do którego naciśnięcie i puszczenie przycisku liczy się jako kliknięcie. */
const CLICK_MAX_MOVE_PX = 5;

const PAN_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};
const ZOOM_IN_KEYS = new Set(['Equal', 'NumpadAdd']);
const ZOOM_OUT_KEYS = new Set(['Minus', 'NumpadSubtract']);
const FIT_MAP_KEYS = new Set(['Home', 'Digit0', 'Numpad0']);

export class MapInput {
  /** Ostatnia pozycja kursora nad mapą (piksele ekranu) lub null, gdy kursor jest poza oknem. */
  cursor: { xPx: number; yPx: number } | null = null;

  private readonly pressedKeys = new Set<string>();
  private dragPointerId: number | null = null;
  private lastDragX = 0;
  private lastDragY = 0;
  private downX = 0;
  private downY = 0;

  /** Kliknięcie w mapę (bez przeciągania) – piksele ekranu. */
  onClick: ((xPx: number, yPx: number) => void) | null = null;
  /** Podwójne kliknięcie (np. koniec osi trasy). */
  onDoubleClick: ((xPx: number, yPx: number) => void) | null = null;
  /** Prawy przycisk (np. anuluj, usuń ostatni punkt). */
  onRightClick: ((xPx: number, yPx: number) => void) | null = null;
  /**
   * Narzędzie może przejąć przeciąganie (np. malowanie trasy pędzlem): onDragStart zwraca true,
   * wtedy mapa się nie przesuwa, a ruchy trafiają do onDragMove / onDragEnd.
   */
  onDragStart: ((xPx: number, yPx: number) => boolean) | null = null;
  onDragMove: ((xPx: number, yPx: number) => void) | null = null;
  onDragEnd: ((xPx: number, yPx: number) => void) | null = null;
  private toolDrag = false;
  /** Dodatkowe klawisze (np. nakładki, narzędzia). Zwraca true, jeśli klawisz obsłużono. */
  onKey: ((code: string) => boolean) | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: Camera,
    private readonly settings: ViewSettings,
  ) {
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('pointerleave', this.onPointerLeave);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = this.localPosition(e);
      this.onRightClick?.(p.xPx, p.yPx);
    });
    element.addEventListener('dblclick', (e) => {
      const p = this.localPosition(e);
      this.onDoubleClick?.(p.xPx, p.yPx);
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.pressedKeys.clear());
  }

  /** Wywoływane co klatkę: płynne przesuwanie mapy klawiszami. */
  update(deltaTimeS: number): void {
    let dx = 0;
    let dy = 0;
    for (const code of this.pressedKeys) {
      const dir = PAN_KEYS[code];
      if (dir) {
        dx += dir[0];
        dy += dir[1];
      }
    }
    if (dx === 0 && dy === 0) return;
    const length = Math.hypot(dx, dy);
    const stepPx = this.settings.keyboardPanSpeedPxPerS * deltaTimeS;
    // Klawisz „w prawo” pokazuje teren na wschodzie, więc mapa przesuwa się w lewo.
    this.camera.panByPixels((-dx / length) * stepPx, (-dy / length) * stepPx);
  }

  private localPosition(event: MouseEvent): { xPx: number; yPx: number } {
    const rect = this.element.getBoundingClientRect();
    return { xPx: event.clientX - rect.left, yPx: event.clientY - rect.top };
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return;
    this.dragPointerId = event.pointerId;
    this.lastDragX = event.clientX;
    this.lastDragY = event.clientY;
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.element.setPointerCapture(event.pointerId);
    const p = this.localPosition(event);
    this.toolDrag = event.button === 0 && (this.onDragStart?.(p.xPx, p.yPx) ?? false);
    if (!this.toolDrag) this.element.classList.add('dragging');
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.cursor = this.localPosition(event);
    if (event.pointerId !== this.dragPointerId) return;
    if (this.toolDrag) {
      this.onDragMove?.(this.cursor.xPx, this.cursor.yPx);
      return;
    }
    this.camera.panByPixels(event.clientX - this.lastDragX, event.clientY - this.lastDragY);
    this.lastDragX = event.clientX;
    this.lastDragY = event.clientY;
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    this.element.classList.remove('dragging');
    if (this.toolDrag) {
      this.toolDrag = false;
      const p = this.localPosition(event);
      this.onDragEnd?.(p.xPx, p.yPx);
      return;
    }
    if (event.type === 'pointerup' && Math.hypot(event.clientX - this.downX, event.clientY - this.downY) <= CLICK_MAX_MOVE_PX) {
      const p = this.localPosition(event);
      this.onClick?.(p.xPx, p.yPx);
    }
  };

  private onPointerLeave = (): void => {
    if (this.dragPointerId === null) this.cursor = null;
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    let deltaPx = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) deltaPx *= WHEEL_PIXELS_PER_LINE;
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) deltaPx *= this.camera.viewportHeightPx;
    if (event.ctrlKey) deltaPx *= PINCH_SENSITIVITY_MULTIPLIER;
    const notches = -deltaPx / WHEEL_PIXELS_PER_NOTCH;
    const position = this.localPosition(event);
    this.cursor = position;
    this.camera.zoomAt(position.xPx, position.yPx, this.settings.wheelZoomFactorPerNotch ** notches);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (this.onKey?.(event.code)) {
      event.preventDefault();
      return;
    }
    if (event.code in PAN_KEYS) {
      this.pressedKeys.add(event.code);
      event.preventDefault();
    } else if (ZOOM_IN_KEYS.has(event.code) || ZOOM_OUT_KEYS.has(event.code)) {
      const factor = this.settings.wheelZoomFactorPerNotch;
      const centerX = this.camera.viewportWidthPx / 2;
      const centerY = this.camera.viewportHeightPx / 2;
      this.camera.zoomAt(centerX, centerY, ZOOM_IN_KEYS.has(event.code) ? factor : 1 / factor);
      event.preventDefault();
    } else if (FIT_MAP_KEYS.has(event.code)) {
      this.camera.fitWholeMap();
      event.preventDefault();
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };
}
