/**
 * Etap 7c: menu gry (przycisk ☰ w górnym pasku), panel boczny z dotychczasowymi panelami
 * (Finanse, Goście, Naśnieżanie i ratraki, Obiekty ośrodka) – po prawej, jeden naraz – oraz
 * proste okno (historia powiadomień, skróty klawiszowe, ustawienia).
 */
import { icon } from './icons';
import { tipAttrs } from './shell';

/** Panel boczny: miejsce na dotychczasowe panele, pokazywany jeden naraz. */
export class Drawer {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly slots = new Map<string, { el: HTMLElement; title: string; empty: string }>();
  private current: string | null = null;
  onShow: (name: string | null) => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('aside');
    this.el.className = 'u-panel u-drawer hidden';
    this.el.innerHTML = `<div class="u-drawer-head"><span class="u-drawer-title"></span><button type="button" class="u-icon-btn u-close" ${tipAttrs('Zamknij', 'Esc')}>${icon('close', 18, 2)}</button></div><div class="u-drawer-body"></div>`;
    parent.appendChild(this.el);
    this.title = this.el.querySelector('.u-drawer-title')!;
    this.el.querySelector('.u-close')!.addEventListener('click', () => this.hide());
  }

  /** Miejsce na panel (przekazywane jako rodzic przy tworzeniu panelu). */
  slot(name: string, title: string, empty = ''): HTMLElement {
    const el = document.createElement('div');
    el.className = 'u-drawer-slot hidden';
    el.dataset.slot = name;
    if (empty) {
      const e = document.createElement('p');
      e.className = 'u-slot-empty muted';
      e.textContent = empty;
      el.appendChild(e);
    }
    this.el.querySelector('.u-drawer-body')!.appendChild(el);
    this.slots.set(name, { el, title, empty });
    return el;
  }

  get open(): string | null {
    return this.current;
  }

  show(name: string): void {
    const s = this.slots.get(name);
    if (!s) return;
    for (const [n, x] of this.slots) x.el.classList.toggle('hidden', n !== name);
    this.title.textContent = s.title;
    this.current = name;
    this.el.classList.remove('hidden');
    this.onShow(name);
  }

  toggle(name: string): void {
    if (this.current === name) this.hide();
    else this.show(name);
  }

  hide(): void {
    if (!this.current) return;
    this.current = null;
    this.el.classList.add('hidden');
    this.onShow(null);
  }
}

/** Proste okno na środku (historia, skróty, ustawienia). */
export class UiWindow {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private readonly titleEl: HTMLElement;

  constructor(parent: HTMLElement, cls = '') {
    this.el = document.createElement('section');
    this.el.className = `u-window ${cls} hidden`;
    this.el.setAttribute('role', 'dialog');
    this.el.innerHTML = `<div class="u-window-head"><h2 class="u-window-title"></h2><button type="button" class="u-icon-btn u-close" ${tipAttrs('Zamknij', 'Esc')}>${icon('close', 18, 2)}</button></div><div class="u-window-body"></div>`;
    parent.appendChild(this.el);
    this.body = this.el.querySelector('.u-window-body')!;
    this.titleEl = this.el.querySelector('.u-window-title')!;
    this.el.querySelector('.u-close')!.addEventListener('click', () => this.hide());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
      e.stopPropagation();
    });
  }

  show(title: string, html: string): void {
    this.titleEl.textContent = title;
    this.body.innerHTML = html;
    this.el.classList.remove('hidden');
    this.el.querySelector<HTMLElement>('.u-close')!.focus({ preventScroll: true });
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}

export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  key?: string;
  /** Sekcja – kreska przed pozycją. */
  sep?: boolean;
}

/** Menu gry: lista pozycji pod przyciskiem ☰. */
export class GameMenu {
  private readonly el: HTMLElement;

  constructor(parent: HTMLElement, items: MenuItem[], onPick: (id: string) => void) {
    this.el = document.createElement('nav');
    this.el.className = 'u-panel u-menu hidden';
    this.el.setAttribute('aria-label', 'Menu gry');
    this.el.innerHTML = items
      .map((it) => `${it.sep ? '<div class="u-menu-sep"></div>' : ''}<button type="button" class="u-menu-item" data-id="${it.id}">${icon(it.icon, 18)}<span>${it.label}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>`)
      .join('');
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id;
      if (!id) return;
      this.hide();
      onPick(id);
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.visible && !this.el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.u-menu-btn')) this.hide();
    });
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(): void {
    this.el.classList.toggle('hidden');
    if (this.visible) this.el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}

/** Lista skrótów klawiszowych (okno w menu). */
export const SHORTCUTS: [string, string][] = [
  ['Spacja', 'pauza / ×1'],
  ['1–9', 'widoki danych: nachylenie, ekspozycja, mapa, słońce teraz i w ciągu doby, temperatura, śnieg (grubość, stan), ruch'],
  ['G, K, M', 'podłoże, kolejki, naśnieżanie teraz'],
  ['P', 'profil terenu (dwa punkty)'],
  ['I', 'dymek przy kursorze'],
  ['N, R', 'sieć tras, prawdziwy ośrodek Pilsko'],
  ['V', 'wybieranie obiektów'],
  ['L', 'wyciąg'],
  ['T', 'trasa narciarska'],
  ['O', 'rysowanie: ręką ↔ klikaniem punktów'],
  ['U', 'nartostrada'],
  ['E', 'droga dojazdowa'],
  ['H, F, J', 'rurociąg, rura zasilająca, armatka'],
  ['B', 'budynek'],
  ['X, Q, C', 'trasa rowerowa, ścieżka, tor saneczkowy'],
  ['[ ]', 'szerokość trasy'],
  ['Enter / podwójne kliknięcie', 'koniec rysowania klikaniem'],
  ['Backspace', 'cofnij ostatni punkt'],
  ['Delete', 'usuń zaznaczony obiekt'],
  ['Ctrl+Z / Ctrl+Y', 'cofnij / ponów'],
  ['Esc', 'anuluj, zamknij okno'],
  ['W A S D, strzałki', 'przesuwanie mapy; kółko myszy – przybliżanie'],
  ['`', 'menu deweloperskie'],
];

export function shortcutsHtml(): string {
  return `<table class="u-table u-keys"><tbody>${SHORTCUTS.map(([k, t]) => `<tr><th><kbd>${k}</kbd></th><td>${t}</td></tr>`).join('')}</tbody></table>`;
}
