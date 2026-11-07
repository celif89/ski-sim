/**
 * Etap 7c: warstwa interfejsu nad mapą.
 *  – jeden kontener #ui ze skalą (CSS zoom) – ustawienie „Skala interfejsu” dla ekranów od 1366 do
 *    2560 px (automatycznie wg szerokości okna albo wybrana w menu, zapamiętana w przeglądarce),
 *  – podpowiedzi (atrybut data-tip, skrót klawiszowy w data-key) – po najechaniu myszą i po
 *    przejściu klawiszem Tab (fokus z widocznym obramowaniem),
 *  – klawisze wciśnięte w panelach nie przesuwają mapy.
 */
import { readNumber, readNumberArray, readSection } from '../../sim/params';

export interface ScaleParams {
  options: number[];
  referenceWidthPx: number;
  autoMin: number;
  autoMax: number;
}

const FILE = 'data/ui.json';
const SCALE_KEY = 'ski-sim:skala-interfejsu';

export function parseScaleParams(json: unknown): ScaleParams {
  const s = readSection(json as Record<string, unknown>, 'scale', FILE);
  return {
    options: readNumberArray(s, 'options', FILE, { min: 0.5, max: 2 }),
    referenceWidthPx: readNumber(s, 'referenceWidthPx', FILE, { min: 320 }),
    autoMin: readNumber(s, 'autoMin', FILE, { min: 0.5, max: 2 }),
    autoMax: readNumber(s, 'autoMax', FILE, { min: 0.5, max: 2 }),
  };
}

/** Skala automatyczna: szerokość okna / szerokość makiety, w granicach autoMin–autoMax. */
export function autoScale(widthPx: number, heightPx: number, p: ScaleParams): number {
  const byW = widthPx / p.referenceWidthPx;
  const byH = heightPx / (p.referenceWidthPx * (9 / 16));
  return Math.round(Math.max(p.autoMin, Math.min(p.autoMax, Math.min(byW, byH * 1.1))) * 100) / 100;
}

export class UiShell {
  readonly root: HTMLElement;
  private readonly tip: HTMLElement;
  private tipTarget: HTMLElement | null = null;
  private choice: number | 'auto' = 'auto';

  constructor(private readonly sp: ScaleParams) {
    this.root = document.createElement('div');
    this.root.id = 'ui';
    document.body.appendChild(this.root);
    this.tip = document.createElement('div');
    this.tip.className = 'u-tip hidden';
    this.tip.setAttribute('role', 'tooltip');
    this.root.appendChild(this.tip);
    try {
      const saved = localStorage.getItem(SCALE_KEY);
      if (saved && saved !== 'auto' && Number.isFinite(Number(saved))) this.choice = Number(saved);
    } catch {
      /* bez pamięci przeglądarki */
    }
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());
    // Podpowiedzi: mysz i klawiatura.
    this.root.addEventListener('pointerover', (e) => this.showTipFor(e.target as HTMLElement));
    this.root.addEventListener('pointerout', (e) => {
      const to = (e as PointerEvent).relatedTarget as HTMLElement | null;
      if (!to || !this.tipTarget?.contains(to)) this.hideTip();
    });
    this.root.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement;
      if (t.matches(':focus-visible')) this.showTipFor(t);
    });
    this.root.addEventListener('focusout', () => this.hideTip());
    this.root.addEventListener('pointerdown', () => this.hideTip());
    // Klawisze w polach i panelach nie sterują mapą.
    this.root.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.matches('input, select, textarea')) e.stopPropagation();
      if (e.key === 'Escape') this.hideTip();
    });
  }

  get scale(): number {
    return this.choice === 'auto' ? autoScale(window.innerWidth, window.innerHeight, this.sp) : this.choice;
  }

  get scaleChoice(): number | 'auto' {
    return this.choice;
  }

  get scaleOptions(): number[] {
    return this.sp.options;
  }

  setScale(choice: number | 'auto'): void {
    this.choice = choice;
    try {
      localStorage.setItem(SCALE_KEY, String(choice));
    } catch {
      /* bez pamięci przeglądarki */
    }
    this.applyScale();
  }

  private applyScale(): void {
    document.documentElement.style.setProperty('--ui-scale', String(this.scale));
  }

  private showTipFor(el: HTMLElement | null): void {
    const t = el?.closest<HTMLElement>('[data-tip]') ?? null;
    if (!t || !this.root.contains(t)) return;
    if (t === this.tipTarget && !this.tip.classList.contains('hidden')) return;
    this.tipTarget = t;
    const key = t.dataset.key;
    this.tip.innerHTML = `<span>${t.dataset.tip}</span>${key ? `<kbd>${key}</kbd>` : ''}`;
    this.tip.classList.remove('hidden');
    const z = this.scale;
    const r = t.getBoundingClientRect();
    const tw = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    const side = t.dataset.tipSide ?? 'auto';
    let x: number;
    let y: number;
    if (side === 'right' || (side === 'auto' && r.left / z < 120)) {
      x = r.right / z + 10;
      y = (r.top + r.bottom) / 2 / z - th / 2;
    } else if (side === 'top' || (side === 'auto' && r.bottom / z > vh - 140)) {
      x = (r.left + r.right) / 2 / z - tw / 2;
      y = r.top / z - th - 8;
    } else {
      x = (r.left + r.right) / 2 / z - tw / 2;
      y = r.bottom / z + 8;
    }
    this.tip.style.left = `${Math.max(8, Math.min(vw - tw - 8, x))}px`;
    this.tip.style.top = `${Math.max(8, Math.min(vh - th - 8, y))}px`;
  }

  hideTip(): void {
    this.tipTarget = null;
    this.tip.classList.add('hidden');
  }
}

/** Atrybuty podpowiedzi do wstawienia w HTML przycisku. */
export function tipAttrs(text: string, key?: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `data-tip="${esc(text)}"${key ? ` data-key="${esc(key)}"` : ''} aria-label="${esc(text)}${key ? ` (klawisz ${esc(key)})` : ''}"`;
}
