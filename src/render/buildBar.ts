/**
 * Dolne menu budowy (etap 7c, makieta docs/ui/ui-1-mapa.html): kategorie (Wyciągi, Trasy,
 * Naśnieżanie, Drogi, Budynki, Lato, Wycinka | Rozbiórka, Raporty) i nad nimi paleta kart:
 * rysunek, nazwa, kluczowy parametr, cena; zablokowane – szare z powodem (np. „reputacja 4,5”).
 * Pod paletą (w tym samym oknie): sposób rysowania linii (ręką / klikaniem punktów), szerokość
 * trasy, wyrównanie terenu, cofnij / ponów. Nad paletą – krótkie komunikaty budowy.
 */
import type { BuildTool } from './buildPanel';
import { artSvg, icon } from './ui/icons';
import { tipAttrs } from './ui/shell';

export interface PaletteCard {
  id: string;
  art: string;
  name: string;
  param: string;
  price: string;
  tool?: BuildTool;
  /** Typ wybierany w narzędziu (wyciąg, budynek, armatka). */
  sub?: { kind: 'lift' | 'building' | 'gun'; id: string };
  key?: string;
  tip?: string;
  /** Akcja spoza budowy (raporty, okna). */
  action?: string;
  /** Zawsze nieaktywna (np. ręczna wycinka). */
  disabled?: string;
  /** Powód blokady (null – dostępna) – pytany przy każdym otwarciu palety. */
  lockKey?: string;
}

export interface BuildCategory {
  id: string;
  label: string;
  icon: string;
  key?: string;
  tip: string;
  cards: PaletteCard[];
  /** Kreska przed kategorią. */
  sep?: boolean;
  /** Pasek opcji pod kartami: linie (sposób rysowania, gładkość), szerokość trasy. */
  options?: ('draw' | 'width' | 'grade')[];
}

export interface BuildBarHandlers {
  onCard(card: PaletteCard): void;
  /** Zamknięcie palety (narzędzie „wybierz”). */
  onClose(): void;
  onAction(action: string): void;
  onDrawMode(mode: 'hand' | 'click'): void;
  onWidth(widthM: number): void;
  onGradeNew(on: boolean): void;
  onUndo(): void;
  onRedo(): void;
  lockReason(lockKey: string): string | null;
}

export interface BuildBarState {
  tool: BuildTool;
  liftTypeId: string;
  buildingTypeId: string;
  gunTypeId: string;
  drawMode: 'hand' | 'click';
  widthM: number;
  minWidthM: number;
  maxWidthM: number;
  gradeNew: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export class BuildBar {
  private readonly nav: HTMLElement;
  private readonly palette: HTMLElement;
  private readonly toast: HTMLElement;
  private toastTimer = 0;
  private open: string | null = null;
  private state: BuildBarState | null = null;
  private lastRender = '';

  constructor(parent: HTMLElement, private readonly cats: BuildCategory[], private readonly h: BuildBarHandlers) {
    this.palette = document.createElement('section');
    this.palette.className = 'u-panel u-palette hidden';
    parent.appendChild(this.palette);
    this.nav = document.createElement('nav');
    this.nav.className = 'u-panel u-build';
    this.nav.setAttribute('aria-label', 'Budowa');
    this.nav.innerHTML = cats
      .map((c) => `${c.sep ? '<div class="u-build-sep"></div>' : ''}<button type="button" class="u-build-btn" data-c="${c.id}" ${tipAttrs(c.tip, c.key)} data-tip-side="top">${icon(c.icon, 22)}<span>${c.label}</span></button>`)
      .join('');
    parent.appendChild(this.nav);
    this.toast = document.createElement('div');
    this.toast.className = 'u-toast hidden';
    this.toast.setAttribute('role', 'status');
    parent.appendChild(this.toast);
    this.nav.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c;
      if (id) this.toggleCategory(id);
    });
    this.palette.addEventListener('click', (e) => this.onPaletteClick(e));
    this.palette.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.opt === 'width') {
        h.onWidth(Number(t.value));
        const out = this.palette.querySelector('.u-width-val');
        if (out) out.textContent = `${t.value} m`;
      } else if (t.dataset.opt === 'grade') h.onGradeNew(t.checked);
    });
  }

  get openCategory(): string | null {
    return this.open;
  }

  /** Otwiera kategorię (i wybiera jej pierwszą dostępną kartę) albo zamyka, gdy już otwarta. */
  toggleCategory(id: string): void {
    if (this.open === id) {
      this.close();
      return;
    }
    this.openCategory_(id, true);
  }

  /** Otwarcie kategorii bez wyboru karty (np. skrót klawiszowy wybrał już narzędzie). */
  showCategory(id: string): void {
    if (this.open !== id) this.openCategory_(id, false);
  }

  private openCategory_(id: string, pick: boolean): void {
    const c = this.cats.find((x) => x.id === id);
    if (!c) return;
    this.open = id;
    this.lastRender = '';
    this.render();
    this.palette.classList.remove('hidden');
    if (pick) {
      const ok = (k: PaletteCard) => !k.disabled && !k.action && !(k.lockKey && this.h.lockReason(k.lockKey)) && !!k.tool;
      const s = this.state;
      const remembered = (k: PaletteCard) => !!s && !!k.sub && (k.sub.kind === 'lift' ? k.sub.id === s.liftTypeId : k.sub.kind === 'gun' ? k.sub.id === s.gunTypeId : k.sub.id === s.buildingTypeId);
      const sel = c.cards.find((k) => this.isSelected(k)) ?? c.cards.find((k) => ok(k) && remembered(k)) ?? c.cards.find(ok);
      if (sel) this.h.onCard(sel);
    }
  }

  close(): void {
    if (!this.open) return;
    this.open = null;
    this.palette.classList.add('hidden');
    this.render();
    this.h.onClose();
  }

  /** Stan budowy (narzędzie, typy) – podświetlenie kart i opcji. */
  setState(s: BuildBarState): void {
    this.state = s;
    // Narzędzie spoza otwartej kategorii (np. klawisz) – przełącz kategorię.
    if (s.tool !== 'select') {
      const cat = this.cats.find((c) => c.cards.some((k) => this.isSelected(k)));
      if (cat && cat.id !== this.open) this.showCategory(cat.id);
    }
    this.render();
  }

  private isSelected(k: PaletteCard): boolean {
    const s = this.state;
    if (!s || !k.tool) return false;
    const toolMatch = k.tool === s.tool || (k.tool === 'pisteBrush' && s.tool === 'pisteAxis');
    if (!toolMatch) return false;
    if (!k.sub) return true;
    if (k.sub.kind === 'lift') return k.sub.id === s.liftTypeId;
    if (k.sub.kind === 'building') return k.sub.id === s.buildingTypeId;
    return k.sub.id === s.gunTypeId;
  }

  private onPaletteClick(e: Event): void {
    const t = e.target as HTMLElement;
    const card = t.closest<HTMLElement>('[data-card]');
    const c = this.cats.find((x) => x.id === this.open);
    if (card && c) {
      const k = c.cards.find((x) => x.id === card.dataset.card);
      if (!k) return;
      if (k.disabled) return this.showToast(k.disabled);
      const lock = k.lockKey ? this.h.lockReason(k.lockKey) : null;
      if (lock) return this.showToast(`${k.name}: ${lock}.`);
      if (k.action) return this.h.onAction(k.action);
      this.h.onCard(k);
      return;
    }
    const b = t.closest<HTMLElement>('[data-opt]');
    if (!b) return;
    if (b.dataset.opt === 'hand' || b.dataset.opt === 'click') this.h.onDrawMode(b.dataset.opt);
    else if (b.dataset.opt === 'undo') this.h.onUndo();
    else if (b.dataset.opt === 'redo') this.h.onRedo();
    else if (b.dataset.opt === 'close') this.close();
  }

  private render(): void {
    for (const b of this.nav.querySelectorAll<HTMLElement>('[data-c]')) {
      const on = b.dataset.c === this.open;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const c = this.cats.find((x) => x.id === this.open);
    if (!c) return;
    const s = this.state;
    const locks = c.cards.map((k) => (k.lockKey ? this.h.lockReason(k.lockKey) : null));
    const key = JSON.stringify([this.open, s, locks]);
    if (key === this.lastRender) return;
    this.lastRender = key;
    const cards = c.cards
      .map((k, i) => {
        const sel = this.isSelected(k);
        const lock = locks[i];
        const dis = k.disabled || lock;
        return `<button type="button" class="u-card${sel ? ' sel' : ''}${dis ? ' locked' : ''}" data-card="${k.id}" aria-pressed="${sel}" ${dis ? 'aria-disabled="true"' : ''} ${tipAttrs(k.tip ?? k.name, k.key)} data-tip-side="top">
          ${artSvg(k.art, dis ? '#6F8296' : sel ? '#FFB47A' : '#C9D6E3')}
          <span class="u-card-name">${k.name}</span>
          ${lock ? `<span class="u-card-param u-lock">${icon('lock', 13, 2)}${lock}</span>` : `<span class="u-card-param">${k.param}</span>`}
          <span class="u-card-price">${k.price}</span>
        </button>`;
      })
      .join('');
    const opts = c.options ?? [];
    const line = opts.includes('draw') && s
      ? `<div class="u-seg" role="group" aria-label="Sposób rysowania"><button type="button" data-opt="hand" class="${s.drawMode === 'hand' ? 'active' : ''}" ${tipAttrs('Rysuj ręką: przeciągnij myszą – linia sama się upraszcza i wygładza', 'O')}>${icon('hand', 16)}Ręką</button><button type="button" data-opt="click" class="${s.drawMode === 'click' ? 'active' : ''}" ${tipAttrs('Klikaj punkty: klik = punkt, podwójny klik lub Enter = koniec', 'O')}>${icon('points', 16)}Punktami</button></div>`
      : '';
    const width = opts.includes('width') && s
      ? `<label class="u-range" ${tipAttrs('Szerokość nowej trasy', '[ ]')}>Szerokość <input type="range" data-opt="width" min="${s.minWidthM}" max="${s.maxWidthM}" step="5" value="${s.widthM}"><span class="u-width-val">${s.widthM} m</span></label>`
      : '';
    const grade = opts.includes('grade') && s
      ? `<label class="u-check" ${tipAttrs('Nowe trasy z wyrównaniem terenu (usunięte kamienie i pniaki): koszt, ale do jazdy wystarczy mniej śniegu')}><input type="checkbox" data-opt="grade" ${s.gradeNew ? 'checked' : ''}> wyrównanie terenu</label>`
      : '';
    const undo = s
      ? `<div class="u-pal-undo"><button type="button" class="u-icon-btn" data-opt="undo" ${s.canUndo ? '' : 'disabled'} ${tipAttrs('Cofnij', 'Ctrl+Z')}>${icon('undo', 18)}</button><button type="button" class="u-icon-btn" data-opt="redo" ${s.canRedo ? '' : 'disabled'} ${tipAttrs('Ponów', 'Ctrl+Y')}>${icon('redo', 18)}</button></div>`
      : '';
    this.palette.setAttribute('aria-label', `Budowa: ${c.label.toLowerCase()}`);
    const opts2 = line || width || grade;
    this.palette.innerHTML = opts2 ? `<div class="u-cards">${cards}</div><div class="u-pal-opts">${line}${width}${grade}${undo}</div>` : `<div class="u-pal-row"><div class="u-cards">${cards}</div>${undo.replace('u-pal-undo', 'u-pal-undo side')}</div>`;
  }

  /** Krótka podpowiedź nad paletą (znika po kilku sekundach). */
  showToast(text: string): void {
    if (!text) return;
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    const pal = !this.palette.classList.contains('hidden') && !this.palette.classList.contains('under-profile');
    this.toast.style.bottom = pal ? `${104 + this.palette.offsetHeight + 10}px` : '';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), 5000);
  }

  /** Paleta chowa się, gdy na dole jest profil (rysowanie, zaznaczony obiekt). */
  setProfileShown(shown: boolean): void {
    this.palette.classList.toggle('under-profile', shown);
  }
}
