/**
 * Karta obiektu (etap 7b, wygląd etapu 7c – makiety docs/ui/ui-1-mapa i ui-2-karty): po prawej,
 * nagłówek z ikoną (albo skrótem „P1”, „W2”), zakładki (Przegląd, Szczegóły, Ustawienia), duża
 * liczba stanu z paskiem, trzy kafelki, wykres godzinowy (szare słupki – prognoza na resztę dnia),
 * jedno zdanie z sugestią i akcje. Dane liczy symulacja (src/sim/objectCards.ts) – tu tylko wygląd.
 */
import type { CardAction, CardLevel, ObjectCard } from '../sim/objectCards';
import { icon } from './ui/icons';
import { tipAttrs } from './ui/shell';

export interface ViewAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface ObjectCardHandlers {
  onAction(action: CardAction, value: string | null): void;
  onViewAction(id: string): void;
  /** Etap 7c: suwak „gładkość” linii (trasa, droga, rurociąg) – 0 łamana, 1 łuk. */
  onSmooth(value: number): void;
  onClose(): void;
}

const LEVEL_COLOR: Record<CardLevel, string> = { good: '#5FD39A', warn: '#F5C542', bad: '#FF6B6B' };
const STATUS_LEVEL: Record<string, string> = { budowa: 'warn', czynny: 'good', zamknięty: 'muted', przegląd: 'cold', awaria: 'bad', nieczynny: 'muted' };
const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Ikona nagłówka wg rodzaju obiektu. */
function headIcon(kind: string, card: ObjectCard): string {
  const k = card.kindLabel.toLowerCase();
  const short = /^(W\d+|\d+[a-z]?)$/.exec(card.title.trim());
  if (kind === 'lift' && short) return `<span class="u-code">${short[1]}</span>`;
  if (kind === 'piste' && short) return `<span class="u-code">${short[1]}</span>`;
  const park = /^Parking (\d+)/.exec(card.title);
  if (park) return `<span class="u-code">P${park[1]}</span>`;
  const map: [string, string][] = [
    ['kolej', 'lift'], ['wyciąg', 'lift'], ['trasa narciarska', 'piste'], ['rowerow', 'bike'], ['ścieżk', 'walk'], ['tor', 'sled'],
    ['droga', 'road'], ['rura', 'pipe'], ['rurociąg', 'pipe'], ['armatk', 'gun'], ['lanca', 'gun'], ['gastronom', 'home'], ['zbiornik', 'tank'],
    ['pompown', 'water'], ['ujęcie', 'water'], ['studnia', 'water'], ['wodociąg', 'water'], ['rowy', 'water'], ['przyłącze', 'bolt'], ['garaż', 'groomer'],
    ['kotw', 'anchor'], ['plac zabaw', 'playground'], ['punkt widokowy', 'view'], ['parking', 'parking'],
  ];
  const hit = map.find(([s]) => k.includes(s));
  return icon(hit ? hit[1] : kind === 'piste' ? 'piste' : kind === 'lift' ? 'lift' : 'building', 22, 1.9);
}

/** Wykres godzinowy: przeszłość – niebieskie, pełne – czerwone, reszta dnia z modelu – szare. */
function hourlyChart(c: NonNullable<ObjectCard['chart']>): string {
  const perH = Math.max(1, Math.round(1 / c.slotH));
  const hours = Math.floor(c.values.length / perH);
  const hv: number[] = [];
  for (let h = 0; h < hours; h++) {
    let s = 0;
    for (let k = 0; k < perH; k++) s += c.values[h * perH + k] ?? 0;
    hv.push(s / perH);
  }
  let first = hv.findIndex((v) => v > 0.01);
  let last = hv.length - 1 - [...hv].reverse().findIndex((v) => v > 0.01);
  if (first < 0) {
    first = 7;
    last = 16;
  }
  first = Math.max(0, Math.min(first, 8));
  last = Math.min(23, Math.max(last, first + 7));
  const nowH = Math.floor(c.nowIndex / perH);
  const vals = hv.slice(first, last + 1);
  const max = Math.max(1, c.capacity ?? 0, ...vals) * 1.05;
  const W = 372;
  const H = 96;
  const n = vals.length;
  const gap = n > 14 ? 4 : 8;
  const bw = (W - gap * (n - 1)) / n;
  let svg = `<svg viewBox="0 0 ${W} ${H + 18}" width="100%" class="u-chart" role="img" aria-label="${esc(c.title)}">`;
  if (c.capacity) {
    const y = H - (c.capacity / max) * H;
    svg += `<line x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.25)" stroke-dasharray="4 4"/>`;
  }
  vals.forEach((v, i) => {
    const h = first + i;
    const x = i * (bw + gap);
    const bh = Math.max(v > 0 ? 2 : 0, (v / max) * H);
    const future = h > nowH;
    if (future && c.forecast) {
      if (bh > 0) svg += `<rect x="${x.toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" stroke-dasharray="3 3"/>`;
      return;
    }
    if (future) return;
    const full = c.capacity !== undefined && v >= c.capacity * 0.98;
    if (bh > 0) svg += `<rect x="${x.toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${full ? '#FF6B6B' : '#7CC4F2'}"/>`;
  });
  svg += `<line x1="0" x2="${W}" y1="${H + 0.5}" y2="${H + 0.5}" stroke="rgba(255,255,255,0.1)"/>`;
  const ticks = [first, first + Math.round((last - first) / 3), first + Math.round((2 * (last - first)) / 3), last];
  ticks.forEach((h, i) => {
    const x = (h - first) * (bw + gap) + (i === 3 ? bw : 0);
    svg += `<text x="${x.toFixed(1)}" y="${H + 14}" font-size="11" fill="#9DB0C3" text-anchor="${i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}">${h}:00</text>`;
  });
  return `${svg}</svg>`;
}

export class ObjectCardView {
  private readonly root: HTMLElement;
  private lastHtml = '';
  private card: ObjectCard | null = null;
  private tab = 'overview';
  private titleKey = '';

  constructor(parent: HTMLElement, h: ObjectCardHandlers) {
    this.root = document.createElement('aside');
    this.root.className = 'u-panel u-objcard hidden';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el.closest('.u-close')) {
        this.hide();
        h.onClose();
        return;
      }
      const tab = el.closest<HTMLElement>('[data-tab]');
      if (tab) {
        this.tab = tab.dataset.tab!;
        this.lastHtml = '';
        if (this.card) this.render(this.card, this.kind, this.extra, true);
        return;
      }
      const v = el.closest<HTMLElement>('[data-view]');
      if (v) {
        h.onViewAction(v.dataset.view!);
        return;
      }
      const b = el.closest<HTMLElement>('[data-act]');
      if (!b || !this.card) return;
      const a = this.card.actions[Number(b.dataset.act)];
      if (!a) return;
      if (a.input) {
        const inp = this.root.querySelector<HTMLInputElement>(`[data-input="${b.dataset.act}"]`);
        h.onAction(a, inp ? inp.value : null);
      } else {
        if (a.id === 'demolish' && !confirm(`Rozebrać „${this.card.title}”? Część kosztu budowy przepada.`)) return;
        h.onAction(a, null);
      }
    });
    this.root.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.smooth !== undefined) {
        h.onSmooth(Number(t.value) / 100);
        t.blur();
      }
    });
    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.smooth !== undefined) {
        const out = this.root.querySelector('.u-smooth-val');
        if (out) out.textContent = `${t.value} %`;
      }
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
        h.onClose();
      }
      e.stopPropagation();
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.card = null;
    this.lastHtml = '';
  }

  private kind = '';
  private extra: ViewAction[] = [];
  private smooth: number | null = null;

  show(card: ObjectCard, kind = '', extra: ViewAction[] = [], smooth: number | null = null): void {
    this.smooth = smooth;
    this.render(card, kind, extra, false);
  }

  private render(card: ObjectCard, kind: string, extra: ViewAction[], force: boolean): void {
    this.card = card;
    this.kind = kind;
    this.extra = extra;
    const smoothCtl =
      this.smooth !== null
        ? `<label class="u-range u-smooth" ${tipAttrs('Gładkość przebiegu: 0 % – łamana przez punkty kontrolne, 100 % – gładki łuk. Punkty przeciągasz myszą, przeciągnięcie odcinka dodaje punkt.')}>Gładkość <input type="range" min="0" max="100" step="5" value="${Math.round(this.smooth * 100)}" data-smooth><span class="u-smooth-val">${Math.round(this.smooth * 100)} %</span></label>`
        : '';
    if (card.title !== this.titleKey) {
      this.titleKey = card.title;
      this.tab = 'overview';
    }
    const focused = this.root.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT';
    const st = STATUS_LEVEL[card.status] ?? 'muted';
    const tabs: [string, string][] = [['overview', 'Przegląd'], ['details', 'Szczegóły'], ['settings', 'Ustawienia']];
    let body = '';
    if (this.tab === 'overview') {
      const hl = card.headline;
      if (hl) {
        const share = hl.of ? Math.max(0, Math.min(1, hl.value / Math.max(1, hl.of))) : null;
        body += `<div class="u-hl"><div class="u-hl-row"><span class="u-hl-num">${f0(hl.value)}</span><span class="u-hl-unit">${hl.of !== undefined ? `/ ${f0(hl.of)} ` : ''}${esc(hl.unit)}</span>${hl.badge ? `<span class="u-badge ${hl.level}">${esc(hl.badge)}</span>` : ''}</div>${share !== null ? `<div class="u-bar"><div style="width:${(share * 100).toFixed(1)}%;background:${LEVEL_COLOR[hl.level]}"></div></div>` : ''}</div>`;
      } else {
        body += `<div class="u-status-line"><span class="u-chip ${st}">${card.status}</span><span>${esc(card.statusText)}</span></div>`;
      }
      if (hl) body += `<div class="u-status-line small"><span class="u-chip ${st}">${card.status}</span><span>${esc(card.statusText)}</span></div>`;
      if (card.tiles?.length) body += `<div class="u-tiles">${card.tiles.map((t) => `<div class="u-tile"><span class="u-label">${esc(t.label)}</span><span class="u-tile-val ${t.level ?? ''}">${esc(t.value)}</span></div>`).join('')}</div>`;
      if (card.chart) {
        const fullAt = card.chart.capacity ? card.chart.values.findIndex((v) => v >= card.chart!.capacity! - 0.5) : -1;
        const side = fullAt >= 0 ? `pełny od ${String(Math.floor(fullAt * card.chart.slotH)).padStart(2, '0')}:${String(Math.round(((fullAt * card.chart.slotH) % 1) * 60)).padStart(2, '0')}` : card.chart.unit;
        body += `<div class="u-chart-box"><div class="u-chart-head"><span>${esc(card.chart.title[0].toUpperCase() + card.chart.title.slice(1))}</span><span class="u-dim">${side}</span></div>${hourlyChart(card.chart)}${card.chart.forecast ? '<div class="u-note-dim">Szare słupki to prognoza na resztę dnia.</div>' : ''}</div>`;
      }
      if (card.note) body += `<div class="u-advice">${esc(card.note)}</div>`;
      body += smoothCtl;
      const simple = card.actions.map((a, i) => [a, i] as const).filter(([a]) => !a.input && a.id !== 'demolish');
      const primary = extra.find((x) => x.primary);
      const others = extra.filter((x) => !x.primary);
      body += '<div class="u-actions">';
      if (primary) body += `<button type="button" class="u-btn primary wide" data-view="${primary.id}">${esc(primary.label)}</button>`;
      const btns = [...simple.map(([a, i]) => `<button type="button" class="u-btn" data-act="${i}">${esc(a.label)}</button>`), ...others.map((x) => `<button type="button" class="u-btn" data-view="${x.id}">${esc(x.label)}</button>`)];
      if (btns.length) body += `<div class="u-grid2">${btns.join('')}</div>`;
      body += '</div>';
    } else if (this.tab === 'details') {
      body += `<div class="u-status-line"><span class="u-chip ${st}">${card.status}</span><span>${esc(card.statusText)}</span></div>`;
      body += `<table class="u-table u-rows"><tbody>${card.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
    } else {
      const acts = card.actions
        .map((a, i) =>
          a.input
            ? `<label class="u-field"><span>${esc(a.label)}</span><span class="u-field-row"><input data-input="${i}" type="${a.input}" value="${a.value ?? ''}" ${a.input === 'number' ? 'min="0" max="400" step="1"' : ''}><button type="button" class="u-btn" data-act="${i}">Ustaw</button></span></label>`
            : a.id === 'demolish'
              ? ''
              : `<button type="button" class="u-btn" data-act="${i}">${esc(a.label)}</button>`,
        )
        .join('');
      const dem = card.actions.findIndex((a) => a.id === 'demolish');
      body += `<div class="u-settings">${smoothCtl}${acts || (smoothCtl ? '' : '<p class="muted">Brak ustawień dla tego obiektu.</p>')}</div>`;
      if (dem >= 0) body += `<div class="u-danger-zone"><button type="button" class="u-btn danger" data-act="${dem}">${icon('trash', 16)} Rozbierz</button><span class="u-dim">Część kosztu budowy przepada.</span></div>`;
    }
    const html = `<div class="u-card-head"><div class="u-head-icon">${headIcon(kind, card)}</div><div class="u-stack"><span class="u-card-title">${esc(card.title)}</span><span class="u-sub">${esc(card.kindLabel[0].toUpperCase() + card.kindLabel.slice(1))}</span></div><button type="button" class="u-icon-btn u-close" ${tipAttrs('Zamknij kartę', 'Esc')}>${icon('close', 18, 2)}</button></div>
      <div class="u-tabs" role="tablist">${tabs.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${this.tab === id}">${l}</button>`).join('')}</div>
      <div class="u-card-body">${body}</div>`;
    if (html === this.lastHtml && !force) return;
    if (focused && !force) return; // nie przerywać wpisywania ceny / daty
    this.lastHtml = html;
    this.root.innerHTML = html;
    this.root.classList.remove('hidden');
  }
}
