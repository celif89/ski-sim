/**
 * Etap 7c: powiadomienia (lewa strona, makieta ui-1-mapa): ikona stanu, tytuł, godzina gry, jedno
 * zdanie z sugestią. Kliknięcie przenosi kamerę do miejsca. Po kilkunastu sekundach znikają z mapy,
 * zostają w historii (menu gry → „Historia powiadomień”). To samo zdarzenie (klucz) nie jest
 * powtarzane, dopóki trwa.
 */
import { readNumber, readSection } from '../../sim/params';
import { icon } from './icons';
import { tipAttrs } from './shell';

export type NoticeLevel = 'bad' | 'warn' | 'info' | 'good';

export interface Notice {
  /** Klucz zdarzenia – to samo zdarzenie nie pojawia się drugi raz, dopóki trwa. */
  key: string;
  level: NoticeLevel;
  icon: string;
  title: string;
  text: string;
  /** Godzina gry „10:38” (pokazywana obok tytułu) i data (w historii). */
  time: string;
  date?: string;
  at?: { xM: number; yM: number } | null;
}

export interface NoticeParams {
  visible: number;
  lifetimeS: number;
  historySize: number;
  queueWarnMin: number;
  thawWarnC: number;
}

const FILE = 'data/ui.json';

export function parseNoticeParams(json: unknown): NoticeParams {
  const s = readSection(json as Record<string, unknown>, 'notifications', FILE);
  return {
    visible: readNumber(s, 'visible', FILE, { integer: true, min: 1 }),
    lifetimeS: readNumber(s, 'lifetimeS', FILE, { min: 1 }),
    historySize: readNumber(s, 'historySize', FILE, { integer: true, min: 1 }),
    queueWarnMin: readNumber(s, 'queueWarnMin', FILE, { min: 0 }),
    thawWarnC: readNumber(s, 'thawWarnC', FILE),
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export class Notifications {
  private readonly el: HTMLElement;
  private readonly live: { n: Notice; born: number }[] = [];
  readonly history: Notice[] = [];
  /** Zdarzenia trwające (klucz → ostatnio zgłoszone) – bez powtórek. */
  private readonly active = new Map<string, number>();
  onJump: (at: { xM: number; yM: number }) => void = () => {};

  constructor(parent: HTMLElement, private readonly p: NoticeParams) {
    this.el = document.createElement('section');
    this.el.className = 'u-notices';
    this.el.setAttribute('aria-label', 'Powiadomienia');
    this.el.setAttribute('aria-live', 'polite');
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const card = t.closest<HTMLElement>('[data-i]');
      if (!card) return;
      const i = Number(card.dataset.i);
      const item = this.live[i];
      if (!item) return;
      if (t.closest('.u-x')) {
        this.live.splice(i, 1);
        this.render();
        return;
      }
      if (item.n.at) this.onJump(item.n.at);
    });
  }

  /** Przesunięcie w prawo, gdy obok paska widoków stoi legenda. */
  setOffset(legendVisible: boolean): void {
    this.el.classList.toggle('shifted', legendVisible);
  }

  /** Nowe powiadomienie (pomijane, jeśli to samo zdarzenie już trwa). */
  push(n: Notice): boolean {
    if (this.active.has(n.key)) {
      this.active.set(n.key, performance.now());
      return false;
    }
    this.active.set(n.key, performance.now());
    this.history.unshift(n);
    if (this.history.length > this.p.historySize) this.history.length = this.p.historySize;
    this.live.unshift({ n, born: performance.now() });
    if (this.live.length > this.p.visible) this.live.length = this.p.visible;
    this.render();
    return true;
  }

  /** Zdarzenie się skończyło (np. kolejka spadła) – może zostać zgłoszone ponownie. */
  resolve(keyPrefix: string, stillActive: (key: string) => boolean = () => false): void {
    for (const k of [...this.active.keys()]) if (k.startsWith(keyPrefix) && !stillActive(k)) this.active.delete(k);
  }

  /** Wywoływane co klatkę: wygasanie powiadomień. */
  tick(nowMs: number): void {
    const before = this.live.length;
    for (let i = this.live.length - 1; i >= 0; i--) if (nowMs - this.live[i].born > this.p.lifetimeS * 1000 && !this.el.matches(':hover')) this.live.splice(i, 1);
    if (this.live.length !== before) this.render();
  }

  private render(): void {
    this.el.innerHTML = this.live
      .map(
        ({ n }, i) => `<div class="u-panel u-notice ${n.level}${n.at ? ' jump' : ''}" data-i="${i}" ${n.at ? `role="button" tabindex="0" ${tipAttrs('Pokaż na mapie')}` : ''}>
          <div class="u-notice-ic ${n.level}">${icon(n.icon, 18, 1.9)}</div>
          <div class="u-notice-body"><div class="u-notice-head"><span class="u-notice-title">${esc(n.title)}</span><span class="u-notice-time">${n.time}</span></div><span class="u-notice-text">${esc(n.text)}</span></div>
          <button type="button" class="u-x" aria-label="Zamknij powiadomienie">${icon('close', 12, 2)}</button>
        </div>`,
      )
      .join('');
  }

  /** Historia jako HTML (okno w menu). */
  historyHtml(): string {
    if (!this.history.length) return '<p class="muted">Jeszcze nic się nie wydarzyło.</p>';
    return `<div class="u-history">${this.history
      .map(
        (n, i) => `<div class="u-notice ${n.level}${n.at ? ' jump' : ''}" data-h="${i}" ${n.at ? 'role="button" tabindex="0"' : ''}>
          <div class="u-notice-ic ${n.level}">${icon(n.icon, 18, 1.9)}</div>
          <div class="u-notice-body"><div class="u-notice-head"><span class="u-notice-title">${esc(n.title)}</span><span class="u-notice-time">${n.date ? `${n.date}, ` : ''}${n.time}</span></div><span class="u-notice-text">${esc(n.text)}</span></div>
        </div>`,
      )
      .join('')}</div>`;
  }
}
