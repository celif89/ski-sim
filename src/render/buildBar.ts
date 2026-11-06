/**
 * Dolny pasek budowy w stylu A: duże przyciski z ikonami – Wyciąg, Trasa, Wycinka, Naśnieżanie,
 * Budynki, Nakładki. „Nakładki” otwiera okienko z dotychczasowymi nakładkami danych (nachylenie,
 * ekspozycja, słońce, temperatura, śnieg), mapą topograficzną, siecią tras, prawdziwym ośrodkiem
 * i profilem terenu. Funkcje z przyszłych etapów są widoczne, ale wyszarzone (z podpowiedzią).
 *
 * W prawym dolnym rogu: róża kierunków (strzałka N – kliknięcie obraca mapę o 180°) i zoom.
 */
import type { BuildTool } from './buildPanel';

const ICONS: Record<string, string> = {
  lift: '<path d="M3 6 L21 3" /><path d="M8 5.2v5M16 3.9v5" /><rect x="5.5" y="10.2" width="5" height="4" rx="1" /><rect x="13.5" y="8.9" width="5" height="4" rx="1" /><path d="M4 21 L6 6.5M20 21 L18 3.6" />',
  piste: '<path d="M6 3c5 3 -3 7 3 10s-1 6 4 8" stroke-width="2.4" /><path d="M14 4c4 3 -2 6 3 9" />',
  clearing: '<path d="M7 20l3-9 3 9z" /><path d="M10 11V6" /><path d="M15 4l5 5-2.5 2.5-5-5z" /><path d="M16.3 9.7L11 15" />',
  snow: '<path d="M4 15h7l3-6h4l2 3" /><circle cx="7" cy="18" r="2" /><path d="M17 5l2-2M20 7l2-1M15 4l0-2" />',
  buildings: '<path d="M3 20V10l6-5 6 5v10z" /><path d="M15 20v-7l3-2.5 3 2.5v7" /><path d="M7.5 20v-4h3v4" />',
  layers: '<path d="M12 3l9 5-9 5-9-5z" /><path d="M3 12l9 5 9-5" /><path d="M3 16l9 5 9-5" />',
};

function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

export interface BuildBarHandlers {
  onTool(tool: BuildTool): void;
  /** Kliknięcie wyszarzonego przycisku – podpowiedź (np. „etap 7”). */
  onInfo(text: string): void;
}

type BarItem = { id: string; label: string; key?: string; tool?: BuildTool; disabled?: string; title: string };

const ITEMS: BarItem[] = [
  { id: 'lift', label: 'Wyciąg', key: 'L', tool: 'lift', title: 'Budowa wyciągu: kliknij dolną, potem górną stację' },
  { id: 'piste', label: 'Trasa', key: 'T', tool: 'pisteBrush', title: 'Budowa trasy pędzlem (przeciągnij w dół stoku); oś punktami – klawisz O' },
  {
    id: 'clearing',
    label: 'Wycinka',
    title: 'Wycinka lasu',
    disabled: 'Wycinka jest liczona sama pod wyciągami i trasami (przecinki widać na mapie). Ręczna wycinka – później.',
  },
  { id: 'snow', label: 'Naśnieżanie', key: 'H', tool: 'pipeline', title: 'Rurociąg z hydrantami (H) od pompowni wzdłuż trasy, potem armatki na hydrantach (J). Rura zasilająca od źródła wody do zbiornika (F). Ujęcie (tylko na potoku), studnia, wodociąg (tylko przy wsi), rowy, zbiornik, pompownia, przyłącze, garaż ratraków i kotwy – narzędzie „Budynki”' },
  { id: 'buildings', label: 'Budynki', key: 'B', tool: 'base', title: 'Budynki: parking (tu przyjeżdżają goście), gastronomia, wypożyczalnia, szkółka – typ wybierz w panelu budowy, kliknij na mapie' },
  { id: 'layers', label: 'Nakładki', title: 'Nakładki danych: nachylenie, ekspozycja, słońce, temperatura, śnieg; mapa topograficzna; sieć tras' },
];

export class BuildBar {
  /** Okienko „Nakładki” – tu main wkłada przyciski nakładek. */
  readonly layersPop: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly toast: HTMLElement;
  private toastTimer = 0;

  constructor(parent: HTMLElement, h: BuildBarHandlers) {
    const bar = document.createElement('div');
    bar.className = 'a-build-bar a-card';
    for (const it of ITEMS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'a-bar-btn' + (it.disabled ? ' soon' : '');
      b.innerHTML = `${icon(it.id)}<span>${it.label}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}`;
      b.title = it.title + (it.key ? ` (klawisz ${it.key})` : '') + (it.disabled ? ` – ${it.disabled}` : '');
      b.addEventListener('click', () => {
        if (it.disabled) h.onInfo(it.disabled);
        else if (it.id === 'layers') this.toggleLayers();
        else if (it.tool) h.onTool(b.classList.contains('active') ? 'select' : it.tool);
      });
      bar.appendChild(b);
      this.buttons.set(it.id, b);
    }
    parent.appendChild(bar);
    this.layersPop = document.createElement('div');
    this.layersPop.className = 'a-card a-layers-pop hidden';
    parent.appendChild(this.layersPop);
    this.toast = document.createElement('div');
    this.toast.className = 'a-toast hidden';
    parent.appendChild(this.toast);
    this.layersPop.addEventListener('keydown', (e) => e.stopPropagation());
  }

  toggleLayers(open?: boolean): void {
    const show = open ?? this.layersPop.classList.contains('hidden');
    this.layersPop.classList.toggle('hidden', !show);
    this.buttons.get('layers')!.classList.toggle('active', show);
  }

  /** Podświetlenie przycisku aktywnego narzędzia. */
  setTool(tool: BuildTool): void {
    this.buttons.get('lift')!.classList.toggle('active', tool === 'lift');
    this.buttons.get('piste')!.classList.toggle('active', tool === 'pisteBrush' || tool === 'pisteAxis');
    this.buttons.get('buildings')!.classList.toggle('active', tool === 'base');
    this.buttons.get('snow')!.classList.toggle('active', tool === 'pipeline' || tool === 'supply' || tool === 'gun');
  }

  /** Krótka podpowiedź nad paskiem (znika po kilku sekundach). */
  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), 4500);
  }
}

export interface MapNavHandlers {
  onRotate(): void;
  onZoom(factor: number): void;
}

/** Róża kierunków (strzałka północy, obrót o 180°) i przyciski zoomu. */
export class MapNav {
  private readonly arrow: SVGElement;
  private readonly letter: SVGElement;

  constructor(parent: HTMLElement, h: MapNavHandlers) {
    const el = document.createElement('div');
    el.className = 'a-map-nav';
    el.innerHTML = `
      <button type="button" class="a-card a-compass" title="Północ. Kliknij – obróć mapę o 180° (widok od Korbielowa ↔ od Słowacji)">
        <svg viewBox="0 0 40 40" width="52" height="52"><g class="a-compass-arrow"><path d="M20 11 L25 21 L20 19 L15 21 Z" fill="#d6336c"/><path d="M20 31 L25 21 L20 23 L15 21 Z" fill="#94a3b8"/></g><text class="a-compass-n" x="20" y="9" text-anchor="middle" font-size="9" font-weight="700" fill="#1f2a37">N</text></svg>
        <span class="a-compass-rot">↻ 180°</span>
      </button>
      <div class="a-card a-zoom">
        <button type="button" data-z="in" title="Przybliż (kółko myszy, klawisz +)">+</button>
        <button type="button" data-z="out" title="Oddal (kółko myszy, klawisz −)">−</button>
      </div>`;
    parent.appendChild(el);
    this.arrow = el.querySelector('.a-compass-arrow')!;
    this.letter = el.querySelector('.a-compass-n')!;
    el.querySelector('.a-compass')!.addEventListener('click', () => h.onRotate());
    el.querySelector('[data-z="in"]')!.addEventListener('click', () => h.onZoom(1.6));
    el.querySelector('[data-z="out"]')!.addEventListener('click', () => h.onZoom(1 / 1.6));
  }

  /** Strzałka N: w górę ekranu (mapa nieobrócona) lub w dół (widok od Korbielowa). */
  setRotated(rotated: boolean): void {
    this.arrow.setAttribute('transform', rotated ? 'rotate(180 20 21)' : '');
    this.letter.setAttribute('y', rotated ? '39' : '9');
  }
}
