/**
 * Dymek przy kursorze (etap 6b): po chwili bez ruchu myszy pokazuje teren (wysokość, nachylenie,
 * ekspozycja), śnieg (grubość, baza ubita, stan), temperaturę powietrza na tej wysokości i obiekt pod
 * kursorem (trasa, wyciąg, budynek, potok…). Włączany i wyłączany w „Nakładkach” (zapamiętane
 * w przeglądarce).
 */

const STORAGE_KEY = 'ski-sim:dymek';
/** Opóźnienie pokazania dymku po zatrzymaniu kursora [ms] i ruch, który go chowa [px]. */
const DELAY_MS = 450;
const MOVE_HIDE_PX = 4;

export interface TipContent {
  title?: string;
  lines: string[];
  /** Dodatkowe sekcje (np. obiekt pod kursorem). */
  sections?: { title: string; lines: string[] }[];
}

export class CursorTip {
  private readonly el: HTMLDivElement;
  private enabledValue: boolean;
  private restSince = 0;
  private last: { x: number; y: number } | null = null;
  private shownAt: { x: number; y: number } | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'cursor-tip hidden';
    parent.appendChild(this.el);
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* brak pamięci przeglądarki */
    }
    this.enabledValue = stored !== '0';
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  setEnabled(v: boolean): void {
    this.enabledValue = v;
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    } catch {
      /* brak pamięci przeglądarki */
    }
    if (!v) this.hide();
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.shownAt = null;
  }

  /**
   * Co klatkę: kursor (null – poza mapą) i funkcja budująca treść (wołana tylko, gdy dymek ma się
   * pokazać lub odświeżyć – raz na ok. 0,5 s).
   */
  update(cursor: { xPx: number; yPx: number } | null, nowMs: number, content: () => TipContent | null): void {
    if (!this.enabledValue || !cursor) {
      this.hide();
      this.last = null;
      return;
    }
    const moved = !this.last || Math.hypot(cursor.xPx - this.last.x, cursor.yPx - this.last.y) > MOVE_HIDE_PX;
    if (moved) {
      this.last = { x: cursor.xPx, y: cursor.yPx };
      this.restSince = nowMs;
      if (this.shownAt) this.hide();
      return;
    }
    if (nowMs - this.restSince < DELAY_MS) return;
    if (this.shownAt && nowMs - this.restSince < DELAY_MS + 500) return;
    this.restSince = nowMs - DELAY_MS; // odświeżanie co 0,5 s, gdy kursor stoi
    const c = content();
    if (!c) {
      this.hide();
      return;
    }
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const block = (title: string | undefined, lines: string[]) =>
      `${title ? `<div class="ct-title">${esc(title)}</div>` : ''}${lines.filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('')}`;
    this.el.innerHTML = block(c.title, c.lines) + (c.sections ?? []).map((s) => `<div class="ct-sec">${block(s.title, s.lines)}</div>`).join('');
    this.el.classList.remove('hidden');
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = cursor.xPx + 16 + w > vw ? cursor.xPx - 12 - w : cursor.xPx + 16;
    const y = cursor.yPx + 16 + h > vh ? cursor.yPx - 12 - h : cursor.yPx + 16;
    this.el.style.left = `${Math.max(4, x)}px`;
    this.el.style.top = `${Math.max(4, y)}px`;
    this.shownAt = { x: cursor.xPx, y: cursor.yPx };
  }
}
