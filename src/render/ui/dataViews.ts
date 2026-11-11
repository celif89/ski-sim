/**
 * Etap 7c: lewy pionowy pasek widoków danych (dotychczasowe nakładki 1–9, G, K, M) – ikony
 * z podpowiedzią i skrótem; aktywny widok z legendą obok (makieta ui-1-mapa: „Kolejki do wyciągów”).
 * Widoki podobne są zgrupowane – w legendzie zakładki (np. Śnieg: grubość / stan / podłoże).
 * Pod kreską: profil terenu (P) i dymek przy kursorze (I).
 */
import type { SlopeClass } from '../../sim';
import type { OverlayKind } from '../overlays';
import { Legend } from '../panels';
import { icon } from './icons';
import { tipAttrs } from './shell';

interface ViewGroup {
  id: string;
  icon: string;
  label: string;
  views: { kind: OverlayKind; key: string; label: string }[];
}

export const VIEW_GROUPS: ViewGroup[] = [
  { id: 'terrain', icon: 'terrain', label: 'Teren i mapa', views: [{ kind: 'none', key: '3', label: 'Mapa' }] },
  { id: 'slope', icon: 'slope', label: 'Nachylenie i ekspozycja', views: [{ kind: 'slope', key: '1', label: 'Nachylenie' }, { kind: 'aspect', key: '2', label: 'Ekspozycja' }] },
  { id: 'snow', icon: 'snow', label: 'Śnieg', views: [{ kind: 'snowDepth', key: '7', label: 'Grubość' }, { kind: 'snowQuality', key: '8', label: 'Stan' }, { kind: 'ground', key: 'G', label: 'Podłoże' }] },
  { id: 'sun', icon: 'sun', label: 'Nasłonecznienie', views: [{ kind: 'insolation', key: '4', label: 'Teraz' }, { kind: 'radiationSum', key: '5', label: 'Suma doby' }] },
  { id: 'temp', icon: 'thermo', label: 'Temperatura i naśnieżanie', views: [{ kind: 'temperature', key: '6', label: 'Powietrze' }, { kind: 'wetBulb', key: 'M', label: 'Naśnieżanie teraz' }] },
  { id: 'traffic', icon: 'people', label: 'Ruch na trasach', views: [{ kind: 'traffic', key: '9', label: 'Przejazdy na godzinę' }] },
  { id: 'queue', icon: 'clock', label: 'Kolejki do wyciągów', views: [{ kind: 'liftWait', key: 'K', label: 'Kolejki' }] },
];

export interface DataViewHandlers {
  onOverlay(kind: OverlayKind): void;
  onProfile(): void;
  onTip(): void;
  onTopo(on: boolean): void;
  onNetwork(): void;
  onReality(): void;
  /** Etap 7e: kreski spadku i warstwice na mapie (włącz / wyłącz). */
  onReliefLayers(layers: { hachures: boolean; contours: boolean }): void;
  /** Etap 7g: widok „Działki” (granice, ceny, kupno). */
  onParcels?(): void;
}

export class DataViews {
  readonly legend: Legend;
  private readonly nav: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly extras: HTMLElement;
  private kind: OverlayKind = 'none';
  private terrainOpen = false;
  private topo = false;
  /** Etap 7e: kreski spadku i warstwice (stan zapamiętany w przeglądarce). */
  private relief = { hachures: true, contours: true };
  /** Zmiana widoczności legendy – powiadomienia przesuwają się w prawo. */
  onLegendVisible: (visible: boolean) => void = () => {};

  constructor(parent: HTMLElement, slopeClasses: SlopeClass[], flatSlopePercent: number, pisteClasses: { name: string; color: string }[], h: DataViewHandlers) {
    this.nav = document.createElement('nav');
    this.nav.className = 'u-panel u-nav';
    this.nav.setAttribute('aria-label', 'Widoki danych');
    const btn = (id: string, ic: string, tip: string, key: string) => `<button type="button" class="u-nav-btn" data-g="${id}" ${tipAttrs(tip, key)}>${icon(ic, 24)}</button>`;
    this.nav.innerHTML =
      VIEW_GROUPS.map((g) => btn(g.id, g.icon, g.label, g.views.map((v) => v.key).join(' / '))).join('') +
      '<div class="u-nav-sep"></div>' +
      btn('parcels', 'layers', 'Działki: granice, ceny, kupno i dzierżawa – kliknij działkę na mapie', '') +
      btn('profile', 'ruler', 'Profil terenu: kliknij punkt A i punkt B na mapie; Esc – zamknij', 'P') +
      btn('tip', 'info', 'Dymek przy kursorze: wysokość, nachylenie, śnieg, temperatura i obiekt pod kursorem', 'I');
    parent.appendChild(this.nav);
    this.panel = document.createElement('section');
    this.panel.className = 'u-panel u-legend hidden';
    this.panel.setAttribute('aria-label', 'Legenda widoku danych');
    this.panel.innerHTML = `<button type="button" class="u-x u-legend-close" ${tipAttrs('Zamknij legendę (widok zostaje)')}>${icon('close', 14, 2)}</button><div class="u-tabs-mini"></div><div class="u-legend-body"></div><div class="u-legend-extras"></div>`;
    parent.appendChild(this.panel);
    this.tabs = this.panel.querySelector('.u-tabs-mini')!;
    this.extras = this.panel.querySelector('.u-legend-extras')!;
    this.legend = new Legend(this.panel.querySelector('.u-legend-body')!, slopeClasses, flatSlopePercent, pisteClasses);
    this.nav.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-g]');
      if (!b) return;
      const g = b.dataset.g!;
      if (g === 'profile') return h.onProfile();
      if (g === 'parcels') return h.onParcels?.();
      if (g === 'tip') return h.onTip();
      const group = VIEW_GROUPS.find((x) => x.id === g)!;
      if (g === 'terrain') {
        this.terrainOpen = !(this.kind === 'none' && this.terrainOpen);
        h.onOverlay('none');
        return;
      }
      const active = group.views.some((v) => v.kind === this.kind);
      h.onOverlay(active ? 'none' : group.views[0].kind);
    });
    this.tabs.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as OverlayKind | undefined;
      if (k) h.onOverlay(k);
    });
    this.panel.querySelector('.u-legend-close')!.addEventListener('click', () => {
      this.terrainOpen = false;
      if (this.kind === 'none') this.render();
      else h.onOverlay('none');
    });
    this.extras.addEventListener('click', (e) => {
      const x = (e.target as HTMLElement).closest<HTMLElement>('[data-x]')?.dataset.x;
      if (x === 'topo') {
        this.topo = !this.topo;
        h.onTopo(this.topo);
      } else if (x === 'hach' || x === 'cont') {
        if (x === 'hach') this.relief.hachures = !this.relief.hachures;
        else this.relief.contours = !this.relief.contours;
        try {
          localStorage.setItem('ski-sim:rzezba', JSON.stringify(this.relief));
        } catch {
          /* brak pamięci przeglądarki */
        }
        h.onReliefLayers({ ...this.relief });
      } else if (x === 'net') h.onNetwork();
      else if (x === 'real') h.onReality();
      this.render();
    });
  }

  /** Etap 7e: zapamiętany stan kresek i warstwic (wołane raz przy starcie). */
  loadReliefLayers(): { hachures: boolean; contours: boolean } {
    try {
      const v = JSON.parse(localStorage.getItem('ski-sim:rzezba') ?? 'null') as { hachures?: unknown; contours?: unknown } | null;
      if (v) this.relief = { hachures: v.hachures !== false, contours: v.contours !== false };
    } catch {
      /* brak pamięci przeglądarki */
    }
    return { ...this.relief };
  }

  /** Aktywna nakładka (wołane z main przy każdej zmianie). */
  setOverlay(kind: OverlayKind): void {
    if (kind !== 'none') this.terrainOpen = false;
    this.kind = kind;
    this.legend.show(kind);
    this.render();
  }

  setParcelsActive(on: boolean): void {
    this.nav.querySelector('[data-g="parcels"]')!.classList.toggle('active', on);
  }

  setProfileActive(on: boolean): void {
    this.nav.querySelector('[data-g="profile"]')!.classList.toggle('active', on);
  }

  setTipActive(on: boolean): void {
    this.nav.querySelector('[data-g="tip"]')!.classList.toggle('active', on);
  }

  private netOn = false;
  private realOn = false;
  setLayerState(network: boolean, reality: boolean): void {
    if (network === this.netOn && reality === this.realOn) return;
    this.netOn = network;
    this.realOn = reality;
    if (this.kind === 'none') this.render();
  }

  private render(): void {
    const group = VIEW_GROUPS.find((g) => g.views.some((v) => v.kind === this.kind)) ?? VIEW_GROUPS[0];
    for (const b of this.nav.querySelectorAll<HTMLElement>('[data-g]')) {
      if (b.dataset.g === 'profile' || b.dataset.g === 'tip') continue;
      const on = b.dataset.g === group.id && (this.kind !== 'none' || this.terrainOpen);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const visible = this.kind !== 'none' || this.terrainOpen;
    this.panel.classList.toggle('hidden', !visible);
    this.onLegendVisible(visible);
    if (!visible) return;
    this.tabs.innerHTML =
      group.views.length > 1
        ? group.views.map((v) => `<button type="button" data-k="${v.kind}" class="${v.kind === this.kind ? 'active' : ''}" ${tipAttrs(v.label, v.key)}>${v.label}</button>`).join('')
        : '';
    this.tabs.classList.toggle('hidden', group.views.length <= 1);
    this.extras.innerHTML =
      this.kind === 'none'
        ? `<button type="button" data-x="hach" class="${this.relief.hachures ? 'active' : ''}" ${tipAttrs('Kreski spadku: krótkie kreski w dół stoku, gęstsze i grubsze na stromiznach (od ok. 15–20 %); tylko teren otwarty i trasy')}>Kreski spadku</button>
           <button type="button" data-x="cont" class="${this.relief.contours ? 'active' : ''}" ${tipAttrs('Warstwice: co 50 m z daleka, co 10 m z bliska, grubsze co 100 m z opisem wysokości')}>Warstwice</button>
           <button type="button" data-x="topo" class="${this.topo ? 'active' : ''}" ${tipAttrs('Dawna mapa topograficzna: warstwice co 10 m, barwy wysokości, opisy')}>Mapa topograficzna</button>
           <button type="button" data-x="net" class="${this.netOn ? 'active' : ''}" ${tipAttrs('Strzałki kierunku zjazdu, numery, połączenia', 'N')}>Sieć tras</button>
           <button type="button" data-x="real" class="${this.realOn ? 'active' : ''}" ${tipAttrs('Prawdziwe wyciągi i trasy Pilska z OpenStreetMap', 'R')}>Prawdziwy ośrodek</button>`
        : '';
    // Legenda na wysokości aktywnego przycisku.
    const b = this.nav.querySelector<HTMLElement>(`[data-g="${group.id}"]`)!;
    this.panel.style.top = `${Math.max(88, this.nav.offsetTop + b.offsetTop - 8)}px`;
  }
}
