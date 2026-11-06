/**
 * Panele interfejsu (HTML nad mapą): przyciski nakładek i narzędzi oraz legenda aktywnej nakładki.
 */
import type { SlopeClass } from '../sim';
import { ASPECT_STOPS_DEG, FLAT_COLOR, GROUND_COLORS, SNOW_QUALITY_COLORS, rgbToCss } from './colors';
import { GROUND_NAMES } from '../sim/ground';
import { SNOW_QUALITY_CODES, SNOW_QUALITY_NAMES } from '../sim/snow';
import type { FieldScale } from './fieldOverlay';
import { scaleGradientCss } from './fieldOverlay';
import type { OverlayKind } from './overlays';

export interface ToolbarHandlers {
  onOverlay(kind: OverlayKind): void;
  onProfileTool(): void;
  /** Etap 6b: dymek przy kursorze – włącz/wyłącz. */
  onTip?(): void;
}

/** Nakładki w kolejności klawiszy 1–7 (7 = bez nakładki). */
export const OVERLAY_KEYS: { kind: OverlayKind; key: string; label: string; title: string }[] = [
  { kind: 'slope', key: '1', label: 'Nachylenie', title: 'Nachylenie w kolorach tras' },
  { kind: 'aspect', key: '2', label: 'Ekspozycja', title: 'Ekspozycja stoków' },
  { kind: 'none', key: '3', label: 'Bez nakładki', title: 'Sama mapa' },
  { kind: 'insolation', key: '4', label: 'Słońce teraz', title: 'Nasłonecznienie chwilowe [W/m²] – z cieniami terenu i zachmurzeniem' },
  { kind: 'radiationSum', key: '5', label: 'Słońce – doba', title: 'Suma dobowa promieniowania [kWh/m²]' },
  { kind: 'temperature', key: '6', label: 'Temperatura', title: 'Temperatura powietrza w tej chwili (zależna od wysokości)' },
  { kind: 'snowDepth', key: '7', label: 'Śnieg – grubość', title: 'Grubość pokrywy śnieżnej [cm] na koniec wybranego dnia' },
  { kind: 'snowQuality', key: '8', label: 'Śnieg – stan', title: 'Stan śniegu: puch, przewiany, osiadły, firn, breja, zlodzony, przetarty' },
  { kind: 'traffic', key: '9', label: 'Ruch na trasach', title: 'Natężenie ruchu gości: przejazdy na godzinę (ostatnie pół godziny)' },
  { kind: 'ground', key: 'G', label: 'Podłoże', title: 'Podłoże terenu: łąka wyrównana, łąka naturalna, kamienie / skała, przecinka z pniakami, las – od niego zależy, ile śniegu trzeba do jazdy' },
  { kind: 'wetBulb', key: 'M', label: 'Naśnieżanie teraz', title: 'Gdzie można teraz naśnieżać: temperatura termometru mokrego (powietrze + wilgotność) – przy inwersji zimniej na dole niż na górze' },
  { kind: 'liftWait', key: 'K', label: 'Kolejki', title: 'Czas oczekiwania i długość kolejki przy dolnych stacjach' },
];

/** Nakładka „Naśnieżanie teraz”: kody 1–4 (0 – poza mapą). */
export const WET_BULB_COLORS: [number, number, number][] = [
  [0, 0, 0],
  [214, 92, 74],
  [245, 190, 70],
  [120, 180, 235],
  [40, 80, 190],
];
export const WET_BULB_NAMES = ['za ciepło – armatki nie robią śniegu', 'tylko armatki śmigłowe, słabo', 'armatki i lance', 'pełna wydajność, suchy śnieg'];

export class Toolbar {
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(parent: HTMLElement, handlers: ToolbarHandlers) {
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    const add = (id: string, label: string, key: string, title: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<kbd>${key}</kbd> ${label}`;
      b.title = `${title} (klawisz ${key})`;
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      this.buttons.set(id, b);
    };
    for (const o of OVERLAY_KEYS) add(o.kind, o.label, o.key, o.title, () => handlers.onOverlay(o.kind));
    const sep = document.createElement('span');
    sep.className = 'toolbar-sep';
    bar.appendChild(sep);
    add('profile', 'Profil terenu', 'P', 'Kliknij punkt A i punkt B na mapie, Esc – zamknij', () => handlers.onProfileTool());
    if (handlers.onTip) add('tip', 'Dymek przy kursorze', 'I', 'Po chwili bez ruchu myszy: wysokość, nachylenie, śnieg, temperatura i obiekt pod kursorem', () => handlers.onTip!());
    parent.appendChild(bar);
  }

  setOverlay(kind: OverlayKind): void {
    for (const o of OVERLAY_KEYS) this.buttons.get(o.kind)!.classList.toggle('active', o.kind === kind);
  }

  setTipActive(active: boolean): void {
    this.buttons.get('tip')?.classList.toggle('active', active);
  }

  setProfileActive(active: boolean): void {
    this.buttons.get('profile')!.classList.toggle('active', active);
  }
}

const formatNum = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 1 });

export class Legend {
  private readonly element: HTMLElement;
  private kind: OverlayKind = 'none';
  private fieldInfo = '';
  private fieldScaleValue: FieldScale | null = null;

  constructor(
    parent: HTMLElement,
    private readonly slopeClasses: SlopeClass[],
    private readonly flatSlopePercent: number,
    /** Klasy tras (kolory) – legenda mapy w stylu A. */
    private readonly pisteClasses: { name: string; color: string }[] = [],
  ) {
    this.element = document.createElement('div');
    this.element.className = 'legend';
    parent.appendChild(this.element);
  }

  /** Dodatkowy opis i skala nakładek słońca/temperatury (np. data, zachmurzenie). */
  setFieldInfo(scale: FieldScale | null, info: string): void {
    this.fieldScaleValue = scale;
    this.fieldInfo = info;
    if (this.kind !== 'none' && this.kind !== 'slope' && this.kind !== 'aspect') this.show(this.kind);
  }

  show(kind: OverlayKind): void {
    this.kind = kind;
    if (kind === 'none') {
      const pistes = this.pisteClasses
        .map((c) => `<div class="legend-cell"><span class="legend-piste" style="--c:${c.color}"></span>${c.name}</div>`)
        .join('');
      this.element.innerHTML = `
        <div class="legend-title">Mapa</div>
        ${pistes ? `<div class="legend-grid legend-grid-2">${pistes}</div>` : ''}
        <div class="legend-row"><span class="legend-lift"></span>wyciąg (podpory, stacje)</div>
        <div class="legend-row"><span class="legend-line border"></span>granica państwa</div>
        <div class="legend-row"><span class="legend-swatch outside"></span>poza mapą (Słowacja)</div>
        <div class="legend-note">Warstwice i barwy wysokości: Nakładki → Mapa topograficzna</div>`;
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
    if (kind === 'aspect') {
      const rows = ASPECT_STOPS_DEG.slice(0, 8)
        .map((s) => `<div class="legend-cell"><span class="legend-swatch" style="background:${rgbToCss(s.color)}"></span>${s.label}</div>`)
        .join('');
      this.element.innerHTML = `<div class="legend-title">Ekspozycja (w którą stronę opada stok)</div>
        <div class="legend-grid">${rows}</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${rgbToCss(FLAT_COLOR)}"></span>płasko (poniżej ${this.flatSlopePercent} %)</div>
        <div class="legend-note">S – ciepłe barwy, N – zimne</div>`;
      return;
    }
    if (kind === 'snowQuality') {
      const rows = SNOW_QUALITY_CODES.slice(1)
        .map((q, i) => `<div class="legend-row"><span class="legend-swatch" style="background:${rgbToCss(SNOW_QUALITY_COLORS[i + 1])}"></span>${SNOW_QUALITY_NAMES[q]}</div>`)
        .join('');
      this.element.innerHTML = `<div class="legend-title">Stan śniegu (powierzchnia)</div>${rows}<div class="legend-note">${this.fieldInfo}</div>`;
      return;
    }
    if (kind === 'ground') {
      const rows = GROUND_NAMES.map((n, i) => `<div class="legend-row"><span class="legend-swatch" style="background:${rgbToCss(GROUND_COLORS[i + 1])}"></span>${n}</div>`).join('');
      this.element.innerHTML = `<div class="legend-title">Podłoże terenu</div>${rows}<div class="legend-note">${this.fieldInfo}</div>`;
      return;
    }
    if (kind === 'wetBulb') {
      const rows = WET_BULB_NAMES.map((n, i) => `<div class="legend-row"><span class="legend-swatch" style="background:${rgbToCss(WET_BULB_COLORS[i + 1])}"></span>${n}</div>`).join('');
      this.element.innerHTML = `<div class="legend-title">Naśnieżanie teraz (temperatura mokra)</div>${rows}<div class="legend-note">${this.fieldInfo}</div>`;
      return;
    }
    if (kind === 'liftWait') {
      const rows = [
        ['#2f9e44', 'do 5 min'],
        ['#f59f00', '5–15 min'],
        ['#e8590c', '15–30 min'],
        ['#d92b2b', 'ponad 30 min'],
        ['#64748b', 'wyciąg stoi (wiatr, zamknięty)'],
      ]
        .map(([c, t]) => `<div class="legend-row"><span class="legend-swatch" style="background:${c}"></span>${t}</div>`)
        .join('');
      this.element.innerHTML = `<div class="legend-title">Kolejki: czas oczekiwania · liczba osób</div>${rows}<div class="legend-note">przy dolnych stacjach; szczegóły w panelu „Goście”</div>`;
      return;
    }
    const titles: Record<string, [string, string]> = {
      traffic: ['Ruch na trasach', 'przejazdów/h'],
      snowDepth: ['Grubość śniegu', 'cm'],
      insolation: ['Nasłonecznienie teraz', 'W/m²'],
      radiationSum: ['Suma dobowa promieniowania', 'kWh/m²'],
      temperature: ['Temperatura powietrza', '°C'],
    };
    const [title, unit] = titles[kind];
    const s = this.fieldScaleValue;
    const bar = s
      ? `<div class="legend-scale" style="background:${scaleGradientCss(s)}"></div>
         <div class="legend-scale-labels"><span>${formatNum(s.min)}</span><span>${formatNum((s.min + s.max) / 2)}</span><span>${formatNum(s.max)} ${unit}</span></div>`
      : '<div class="legend-note">liczę…</div>';
    this.element.innerHTML = `<div class="legend-title">${title}</div>${bar}<div class="legend-note">${this.fieldInfo}</div>`;
  }
}
