/**
 * Karta obiektu (etap 7b): okno z nazwą, statusem, liczbami „na żywo”, wykresem dzisiejszego dnia
 * (oś godzin) i akcjami (otwórz/zamknij, cena, kolej latem, wieszaki, termin przeglądu, rozbiórka).
 * Dane liczy symulacja (src/sim/objectCards.ts) – tu tylko wyświetlanie.
 */
import type { CardAction, ObjectCard } from '../sim/objectCards';

export interface ObjectCardHandlers {
  onAction(action: CardAction, value: string | null): void;
  onClose(): void;
}

const STATUS_COLORS: Record<string, string> = { budowa: '#e67700', czynny: '#2b8a3e', zamknięty: '#868e96', przegląd: '#1971c2', awaria: '#c92a2a', nieczynny: '#868e96' };

function chartSvg(c: NonNullable<ObjectCard['chart']>): string {
  const W = 300;
  const H = 80;
  const from = 6 * 4;
  const to = 22 * 4;
  const vals = c.values.slice(from, to);
  const max = Math.max(1, c.capacity ?? 0, ...vals) * 1.08;
  const bw = W / vals.length;
  const y = (v: number) => H - (v / max) * H;
  let svg = `<svg viewBox="0 0 ${W} ${H + 14}" class="oc-chart" role="img" aria-label="${c.title}">`;
  vals.forEach((v, i) => {
    if (v <= 0) return;
    const past = from + i <= c.nowIndex;
    svg += `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${y(v).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${(H - y(v)).toFixed(1)}" fill="${past ? '#1c7ed6' : '#a5d8ff'}"/>`;
  });
  if (c.capacity) svg += `<line x1="0" x2="${W}" y1="${y(c.capacity).toFixed(1)}" y2="${y(c.capacity).toFixed(1)}" stroke="#e03131" stroke-dasharray="4 3"/>`;
  const nx = ((c.nowIndex - from + 0.5) / vals.length) * W;
  if (nx >= 0 && nx <= W) svg += `<line x1="${nx.toFixed(1)}" x2="${nx.toFixed(1)}" y1="0" y2="${H}" stroke="#0f172a"/>`;
  for (const h of [6, 9, 12, 15, 18, 21]) svg += `<text x="${(((h - 6) * 4) / vals.length) * W + 1}" y="${H + 11}" font-size="9" fill="#64748b">${h}:00</text>`;
  svg += `<text x="${W - 2}" y="9" font-size="9" fill="#64748b" text-anchor="end">maks. ${Math.round(Math.max(...vals)).toLocaleString('pl-PL')} ${c.unit}</text>`;
  return `${svg}</svg>`;
}

export class ObjectCardView {
  private readonly root: HTMLElement;
  private lastHtml = '';
  private card: ObjectCard | null = null;

  constructor(parent: HTMLElement, h: ObjectCardHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'a-card object-card hidden';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el.closest('.oc-close')) {
        this.hide();
        h.onClose();
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
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.card = null;
    this.lastHtml = '';
  }

  show(card: ObjectCard): void {
    this.card = card;
    const focused = this.root.contains(document.activeElement);
    const rows = card.rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const acts = card.actions
      .map((a, i) =>
        a.input
          ? `<label class="oc-input">${a.label} <input data-input="${i}" type="${a.input}" value="${a.value ?? ''}" ${a.input === 'number' ? 'min="0" max="400" step="1"' : ''}> <button type="button" data-act="${i}">Ustaw</button></label>`
          : `<button type="button" data-act="${i}" class="${a.id === 'demolish' ? 'oc-danger' : ''}">${a.label}</button>`,
      )
      .join('');
    const html = `<button type="button" class="profile-close oc-close" title="Zamknij">×</button>
      <div class="oc-head"><div class="oc-title">${card.title}</div><div class="oc-kind">${card.kindLabel}</div></div>
      <div class="oc-status"><span class="oc-chip" style="background:${STATUS_COLORS[card.status] ?? '#868e96'}">${card.status}</span> ${card.statusText}</div>
      ${card.chart ? `<div class="oc-chart-title">${card.chart.title} (${card.chart.unit}) – dziś</div>${chartSvg(card.chart)}` : ''}
      <table class="oc-rows">${rows}</table>
      <div class="oc-actions">${acts}</div>`;
    if (html === this.lastHtml) return;
    if (focused) return; // nie przerywać wpisywania ceny / daty
    this.lastHtml = html;
    this.root.innerHTML = html;
    this.root.classList.remove('hidden');
  }
}
