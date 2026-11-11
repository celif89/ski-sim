/**
 * Etap 7f: samouczek naśnieżania – okno z krokami (woda, zbiornik, pompownia, prąd, „Naśnież trasę”,
 * plan naśnieżania, ratrak). Każdy krok sprawdza wykonanie (src/sim/snowChecklist.ts) i mówi, dlaczego
 * jest potrzebny; „Pokaż” otwiera właściwą kartę palety albo panel i podświetla ją pomarańczową obwódką.
 * Proponowany przy pierwszym otwarciu kategorii Naśnieżanie, dostępny w menu i w panelu naśnieżania.
 */
import type { ChecklistStep } from '../../sim/snowChecklist';
import { icon } from './icons';
import { tipAttrs } from './shell';

const SEEN_KEY = 'ski-sim:samouczek-nasniezanie';

export interface SnowTutorialHandlers {
  steps(): ChecklistStep[];
  /** Pokazuje miejsce kroku (paleta, panel) i zwraca element do podświetlenia (albo null). */
  reveal(step: ChecklistStep): HTMLElement | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class SnowTutorial {
  private readonly el: HTMLElement;
  private index = -1;
  private offer = false;
  private highlighted: HTMLElement | null = null;
  private doneAt = 0;
  private lastHtml = '';

  constructor(parent: HTMLElement, private readonly h: SnowTutorialHandlers) {
    this.el = document.createElement('section');
    this.el.className = 'u-panel u-tutorial hidden';
    this.el.setAttribute('aria-label', 'Samouczek naśnieżania');
    this.el.setAttribute('role', 'dialog');
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-tut]')?.dataset.tut;
      if (!a) return;
      if (a === 'start') this.start();
      else if (a === 'later' || a === 'close') this.stop();
      else if (a === 'show') this.reveal();
      else if (a === 'next') this.go(this.index + 1);
      else if (a === 'prev') this.go(this.index - 1);
    });
  }

  get active(): boolean {
    return this.index >= 0 || this.offer;
  }

  /** Pierwsze otwarcie kategorii Naśnieżanie – propozycja samouczka (raz). */
  offerOnce(): void {
    try {
      if (window.localStorage.getItem(SEEN_KEY)) return;
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* bez pamięci przeglądarki – proponujemy przy każdym starcie */
    }
    if (this.active) return;
    if (this.h.steps().every((s) => s.done)) return;
    this.offer = true;
    this.render();
  }

  /** Start od pierwszego niezrobionego kroku. */
  start(): void {
    this.offer = false;
    const steps = this.h.steps();
    const first = steps.findIndex((s) => !s.done);
    this.go(first < 0 ? steps.length - 1 : first);
  }

  stop(): void {
    this.offer = false;
    this.index = -1;
    this.unhighlight();
    this.el.classList.add('hidden');
    this.lastHtml = '';
  }

  private go(i: number): void {
    const steps = this.h.steps();
    this.index = Math.max(0, Math.min(steps.length - 1, i));
    this.doneAt = 0;
    this.render();
    this.reveal();
  }

  private reveal(): void {
    const steps = this.h.steps();
    const s = steps[this.index];
    if (!s) return;
    this.unhighlight();
    const el = this.h.reveal(s);
    if (el) {
      el.classList.add('u-tut-hl');
      this.highlighted = el;
    }
  }

  private unhighlight(): void {
    this.highlighted?.classList.remove('u-tut-hl');
    this.highlighted = null;
  }

  /** Co ok. pół sekundy: sprawdzenie, czy bieżący krok zrobiony (wtedy po chwili następny). */
  tick(nowMs: number): void {
    if (this.index < 0) return;
    const steps = this.h.steps();
    const s = steps[this.index];
    if (!s) return;
    if (s.done) {
      if (!this.doneAt) this.doneAt = nowMs;
      else if (nowMs - this.doneAt > 1800) {
        const next = steps.findIndex((x, i) => i > this.index && !x.done);
        if (next >= 0) this.go(next);
        else if (steps.every((x) => x.done)) {
          this.index = steps.length;
          this.unhighlight();
        }
      }
    }
    // Podświetlany element mógł zniknąć (przerysowana paleta) – odśwież.
    if (this.highlighted && !this.highlighted.isConnected) this.reveal();
    this.render();
  }

  private render(): void {
    const steps = this.h.steps();
    let html: string;
    if (this.offer) {
      html = `<div class="u-card-head"><div class="u-head-icon">${icon('snow', 22)}</div><div class="u-stack"><span class="u-card-title">Pierwszy raz w naśnieżaniu?</span><span class="u-sub">Samouczek – ${steps.length} kroków</span></div></div>
        <p>Pokażę po kolei, co trzeba zbudować, żeby armatki zrobiły śnieg: woda, zbiornik, pompownia, prąd, rury z armatkami, plan i ratrak. Każdy krok sprawdzę sam.</p>
        <div class="u-grid2"><button type="button" class="u-btn" data-tut="later">Nie teraz</button><button type="button" class="u-btn primary" data-tut="start">Zacznij</button></div>
        <p class="u-note-dim">Samouczek jest też w menu (☰) i w panelu „Naśnieżanie”.</p>`;
    } else if (this.index >= steps.length) {
      html = `<div class="u-card-head"><div class="u-head-icon">${icon('check', 22)}</div><div class="u-stack"><span class="u-card-title">Gotowe!</span><span class="u-sub">System naśnieżania kompletny</span></div><button type="button" class="u-icon-btn u-close" data-tut="close" ${tipAttrs('Zamknij', 'Esc')}>${icon('close', 18, 2)}</button></div>
        <p>Automat będzie naśnieżał, gdy temperatura mokra spadnie poniżej progu armatek (nakładka M pokazuje, gdzie teraz da się naśnieżać). Wodę, moc i pracę armatek widać w panelu „Naśnieżanie”.</p>
        <button type="button" class="u-btn primary wide" data-tut="close">Zamknij</button>`;
    } else if (this.index >= 0) {
      const s = steps[this.index];
      const dots = steps.map((x, i) => `<span class="u-tut-dot${x.done ? ' ok' : ''}${i === this.index ? ' cur' : ''}" title="${esc(x.title)}"></span>`).join('');
      html = `<div class="u-card-head"><div class="u-head-icon">${icon(s.done ? 'check' : 'snow', 22)}</div><div class="u-stack"><span class="u-card-title">${this.index + 1}. ${esc(s.title)}</span><span class="u-sub">Samouczek naśnieżania · krok ${this.index + 1} z ${steps.length}</span></div><button type="button" class="u-icon-btn u-close" data-tut="close" ${tipAttrs('Zakończ samouczek', 'Esc')}>${icon('close', 18, 2)}</button></div>
        <div class="u-tut-dots">${dots}</div>
        ${s.done ? `<div class="u-tut-done">${icon('check', 16)} Zrobione – za chwilę następny krok.</div>` : ''}
        <p><b>Dlaczego:</b> ${esc(s.why)}</p>
        <p><b>Co zrobić:</b> ${esc(s.how)}</p>
        <div class="u-tut-row"><button type="button" class="u-btn" data-tut="prev" ${this.index === 0 ? 'disabled' : ''}>Wstecz</button><button type="button" class="u-btn primary" data-tut="show">Pokaż gdzie</button><button type="button" class="u-btn" data-tut="next" ${this.index >= steps.length - 1 ? 'disabled' : ''}>Dalej</button></div>`;
    } else {
      this.el.classList.add('hidden');
      return;
    }
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.el.innerHTML = html;
    }
    this.el.classList.remove('hidden');
  }
}
