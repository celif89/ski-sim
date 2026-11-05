/**
 * Panele interfejsu (HTML nad mapą): przyciski nakładek i narzędzi oraz legenda aktywnej nakładki.
 */
import type { SlopeClass } from '../sim';
import { ASPECT_STOPS_DEG, FLAT_COLOR, rgbToCss } from './colors';
import type { OverlayKind } from './overlays';

export interface ToolbarHandlers {
  onOverlay(kind: OverlayKind): void;
  onProfileTool(): void;
}

export class Toolbar {
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(parent: HTMLElement, handlers: ToolbarHandlers) {
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    const add = (id: string, label: string, key: string, title: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<kbd>${key}</kbd> ${label}`;
      b.title = title;
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      this.buttons.set(id, b);
    };
    add('slope', 'Nachylenie', '1', 'Nakładka nachylenia w kolorach tras (klawisz 1)', () => handlers.onOverlay('slope'));
    add('aspect', 'Ekspozycja', '2', 'Nakładka ekspozycji stoków (klawisz 2)', () => handlers.onOverlay('aspect'));
    add('none', 'Bez nakładki', '3', 'Sama mapa (klawisz 3)', () => handlers.onOverlay('none'));
    const sep = document.createElement('span');
    sep.className = 'toolbar-sep';
    bar.appendChild(sep);
    add('profile', 'Profil terenu', 'P', 'Kliknij punkt A i punkt B na mapie (klawisz P, Esc – zamknij)', () =>
      handlers.onProfileTool(),
    );
    parent.appendChild(bar);
  }

  setOverlay(kind: OverlayKind): void {
    for (const k of ['slope', 'aspect', 'none']) this.buttons.get(k)!.classList.toggle('active', k === kind);
  }

  setProfileActive(active: boolean): void {
    this.buttons.get('profile')!.classList.toggle('active', active);
  }
}

export class Legend {
  private readonly element: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly slopeClasses: SlopeClass[],
    private readonly flatSlopePercent: number,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'legend';
    parent.appendChild(this.element);
  }

  show(kind: OverlayKind): void {
    if (kind === 'none') {
      this.element.innerHTML = `
        <div class="legend-title">Mapa</div>
        <div class="legend-row"><span class="legend-line major"></span>warstwica co 50 m (z opisem)</div>
        <div class="legend-row"><span class="legend-line minor"></span>warstwica co 10 m</div>
        <div class="legend-row"><span class="legend-line border"></span>granica państwa</div>
        <div class="legend-row"><span class="legend-swatch outside"></span>poza mapą (Słowacja)</div>`;
      return;
    }
    if (kind === 'slope') {
      const rows = this.slopeClasses
        .map((c) => `<div class="legend-row"><span class="legend-swatch" style="background:${c.color}"></span>${c.name}</div>`)
        .join('');
      this.element.innerHTML = `<div class="legend-title">Nachylenie terenu</div>${rows}
        <div class="legend-note">100 % = 45°; 25 % ≈ 14°; 40 % ≈ 22°</div>`;
      return;
    }
    const rows = ASPECT_STOPS_DEG.slice(0, 8)
      .map((s) => `<div class="legend-cell"><span class="legend-swatch" style="background:${rgbToCss(s.color)}"></span>${s.label}</div>`)
      .join('');
    this.element.innerHTML = `<div class="legend-title">Ekspozycja (w którą stronę opada stok)</div>
      <div class="legend-grid">${rows}</div>
      <div class="legend-row"><span class="legend-swatch" style="background:${rgbToCss(FLAT_COLOR)}"></span>płasko (poniżej ${this.flatSlopePercent} %)</div>
      <div class="legend-note">S – ciepłe barwy, N – zimne</div>`;
  }
}
