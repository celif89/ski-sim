/**
 * Etap 7c: okno raportu – dzień, tydzień, sezon (makieta docs/ui/ui-3-raport.html): pięć kafelków
 * (goście, przychody, koszty, wynik, ocena), wykres gości na stoku, „Co mówią goście”, skąd pieniądze
 * i na co poszły, wyciągi, a na dole doradca – jedno zdanie i przycisk akcji.
 * Dane: zamknięte dni gry (GameState: lastDay, recentFlows, year), raport dnia z symulacji gości
 * (zapamiętany przy zamknięciu dnia) albo model dnia.
 */
import type { DayRecord, Flows, GameState } from '../../sim/economy';
import { COST_KEYS, FLOW_NAMES, REVENUE_KEYS, sumCosts, sumRevenue, zeroFlows } from '../../sim/economy';
import type { GuestDayReport } from '../../sim/guests';
import { LEAVE_REASONS } from '../../sim/guests';
import { parseIsoDate } from '../../sim/time';
import { formatDayHeader } from '../topBar';
import type { Advice, AdvisorInput, AdvisorParams } from './advisor';
import { advise } from './advisor';
import { icon } from './icons';
import { tipAttrs } from './shell';

export interface ReportSource {
  state(): GameState | null;
  /** Raport symulacji gości dla dnia (zapamiętany przy zamknięciu dnia) albo null. */
  guestReport(dateIso: string): GuestDayReport | null;
  /** Model: goście na stoku co 15 min (96 wartości) przy danej liczbie gości. */
  presence(guests: number): number[];
  /** Model parkingu: od kiedy pełny i ilu odjechało (null – bez parkingów). */
  parking(guests: number): { fullAt: string | null; turnedAway: number; parkingId: string | null } | null;
  food(guests: number): { has: boolean; full: boolean; id: string | null };
  thin(): { open: number; thin: number };
  hasSnowmaking(): boolean;
  reputation(): number;
  closeH(): number;
  seasonNumber(): number;
}

export interface ReportHandlers {
  onAdvice(actionId: string, advice: Advice): void;
  onSeasonDetails(): void;
  /** Dotychczasowy raport dnia z symulacji gości (zatłoczone trasy, wypadki, oceny co godzinę). */
  onGuestDetails(): void;
}

const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const f1 = (v: number) => v.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const zl = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v) >= 1e6 ? `${f1(Math.abs(v) / 1e6)} mln` : f0(Math.abs(v))} zł`;
const signedZl = (v: number) => `${v >= 0 ? '+' : '−'}${zl(Math.abs(v))}`;
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

type Tab = 'day' | 'week' | 'season';

/** Grupy kosztów do „Na co poszły” (jak w makiecie – krótkie nazwy). */
const COST_GROUPS: [string, (keyof Flows)[]][] = [
  ['Naśnieżanie', ['snowEnergy', 'water']],
  ['Personel', ['liftStaff', 'cashiers', 'patrol', 'seasonal', 'buildingsStaff', 'permanent']],
  ['Odsetki kredytu', ['interest']],
  ['Energia wyciągów', ['energy']],
  ['Towar w kuchni i serwis', ['goods']],
  ['Utrzymanie', ['maintenance', 'insurance', 'inspections', 'roads', 'trails', 'mowing']],
  ['Ratraki', ['groomFuel', 'groomStaff', 'groomService', 'leasing', 'repairs']],
  ['Administracja', ['admin']],
];

function sumFlows(list: Flows[]): Flows {
  const f = zeroFlows();
  for (const x of list) for (const k of Object.keys(f) as (keyof Flows)[]) f[k] += x[k] ?? 0;
  return f;
}

function barList(items: [string, number][], color: string, cols = '112px minmax(0, 1fr) 96px'): string {
  const max = Math.max(1, ...items.map((x) => x[1]));
  if (!items.length) return '<p class="muted">Brak danych.</p>';
  return `<div class="u-barlist" style="grid-template-columns:${cols}">${items
    .map(([n, v]) => `<span>${esc(n)}</span><div class="u-hbar" style="width:${Math.max(0.6, (100 * v) / max).toFixed(1)}%;background:${color}"></div><span class="u-num-r">${zl(v)}</span>`)
    .join('')}</div>`;
}

/** Wykres powierzchniowy (jak w makiecie): oś godzin lub dni, linia i cień, znacznik zdarzenia. */
function areaChart(xs: number[], ys: number[], xLabel: (x: number) => string, xTicks: number[], marker: { x: number; label: string } | null, peak: boolean): string {
  const W = 760;
  const H = 230;
  const L = 48;
  const R = 740;
  const T = 24;
  const B = 200;
  if (xs.length < 2) return '<p class="muted u-empty-chart">Za mało danych do wykresu.</p>';
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const maxY = Math.max(10, ...ys);
  const step = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000].find((s) => maxY / s <= 4.5) ?? 50000;
  const top = Math.ceil(maxY / step) * step;
  const px = (x: number) => L + ((x - x0) / Math.max(1e-9, x1 - x0)) * (R - L);
  const py = (y: number) => B - (y / top) * (B - T);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="u-area" role="img" aria-label="Wykres">`;
  svg += '<g stroke="rgba(255,255,255,0.08)">';
  for (let v = 0; v <= top + 1e-9; v += step) svg += `<line x1="${L}" x2="${R}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}"/>`;
  svg += '</g><g font-size="12" fill="#9DB0C3" text-anchor="end">';
  for (let v = 0; v <= top + 1e-9; v += step) svg += `<text x="${L - 8}" y="${(py(v) + 4).toFixed(1)}">${f0(v)}</text>`;
  svg += '</g><g font-size="12" fill="#9DB0C3" text-anchor="middle">';
  for (const t of xTicks) svg += `<text x="${px(t).toFixed(1)}" y="222">${xLabel(t)}</text>`;
  svg += '</g>';
  const pts = xs.map((x, i) => `${px(x).toFixed(1)} ${py(ys[i]).toFixed(1)}`);
  svg += `<path d="M${pts.join(' L')} L${px(x1).toFixed(1)} ${B} L${px(x0).toFixed(1)} ${B} Z" fill="rgba(124,196,242,0.14)"/>`;
  svg += `<path d="M${pts.join(' L')}" fill="none" stroke="#7CC4F2" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (peak) {
    const i = ys.indexOf(Math.max(...ys));
    svg += `<circle cx="${px(xs[i]).toFixed(1)}" cy="${py(ys[i]).toFixed(1)}" r="4" fill="#7CC4F2" stroke="#172331" stroke-width="2"/>`;
  }
  if (marker) {
    const mx = px(marker.x);
    svg += `<line x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${T}" y2="${B}" stroke="#FF6B6B" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    const w = marker.label.length * 7.4 + 16;
    const rx = mx + w + 8 > R ? mx - w - 6 : mx + 6;
    svg += `<rect x="${rx.toFixed(1)}" y="96" width="${w.toFixed(0)}" height="24" rx="6" fill="rgba(255,107,107,0.16)"/><text x="${(rx + 8).toFixed(1)}" y="112.5" font-size="13" font-weight="600" fill="#FF8A8A">${esc(marker.label)}</text>`;
  }
  return `${svg}</svg>`;
}

export class ReportWindow {
  private readonly el: HTMLElement;
  private tab: Tab = 'day';
  private advice: Advice[] = [];

  constructor(parent: HTMLElement, private readonly src: ReportSource, private readonly ap: AdvisorParams, h: ReportHandlers) {
    this.el = document.createElement('section');
    this.el.className = 'u-report hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Raport');
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.u-close') || t === this.el) return this.hide();
      const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (tab) {
        this.tab = tab;
        this.render();
        return;
      }
      const a = t.closest<HTMLElement>('[data-adv]');
      if (a) {
        const adv = this.advice[Number(a.dataset.i)];
        if (adv) {
          this.hide();
          h.onAdvice(a.dataset.adv!, adv);
        }
        return;
      }
      if (t.closest('[data-season-details]')) h.onSeasonDetails();
      if (t.closest('[data-guest-details]')) {
        this.hide();
        h.onGuestDetails();
      }
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
      e.stopPropagation();
    });
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(tab: Tab = 'day'): void {
    this.tab = tab;
    this.render();
    this.el.classList.remove('hidden');
    this.el.querySelector<HTMLElement>('.u-close')?.focus({ preventScroll: true });
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  private render(): void {
    const s = this.src.state();
    const titles: Record<Tab, string> = { day: 'Raport dnia', week: 'Raport tygodnia', season: 'Raport sezonu' };
    let sub = '';
    let body = '';
    if (!s) {
      sub = 'Gra nie jest uruchomiona.';
      body = '<p class="muted u-pad">Zacznij karierę albo piaskownicę (menu gry → Nowa gra), żeby zobaczyć raporty.</p>';
    } else if (this.tab === 'day') ({ sub, body } = this.dayHtml(s));
    else if (this.tab === 'week') ({ sub, body } = this.weekHtml(s));
    else ({ sub, body } = this.seasonHtml(s));
    const tabs: [Tab, string][] = [['day', 'Dzień'], ['week', 'Tydzień'], ['season', 'Sezon']];
    this.el.innerHTML = `<div class="u-report-box">
      <div class="u-report-head"><div class="u-stack"><h1>${titles[this.tab]}</h1><span class="u-sub">${esc(sub)}</span></div>
        <div class="u-seg big" role="tablist">${tabs.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${this.tab === id}" class="${this.tab === id ? 'active' : ''}">${l}</button>`).join('')}</div>
        <button type="button" class="u-icon-btn big u-close" ${tipAttrs('Zamknij raport', 'Esc')}>${icon('close', 18, 2)}</button></div>
      ${body}</div>`;
  }

  // ------------------------------------------------------------------ wspólne

  private tiles(t: { label: string; value: string; sub: string; cls?: string; subCls?: string }[]): string {
    return `<div class="u-kpis">${t.map((x) => `<div class="u-kpi ${x.cls ?? ''}"><span class="u-label">${x.label}</span><span class="u-kpi-val">${x.value}</span><span class="u-kpi-sub ${x.subCls ?? ''}">${x.sub}</span></div>`).join('')}</div>`;
  }

  private money(f: Flows): string {
    const rev = REVENUE_KEYS.map((k) => [FLOW_NAMES[k][0].toUpperCase() + FLOW_NAMES[k].slice(1), f[k]] as [string, number]).filter((x) => x[1] > 0.5).sort((a, b) => b[1] - a[1]);
    const used = new Set<string>();
    const costs: [string, number][] = [];
    for (const [name, keys] of COST_GROUPS) {
      const v = keys.reduce((a, k) => a + f[k], 0);
      keys.forEach((k) => used.add(k));
      if (v > 0.5) costs.push([name, v]);
    }
    for (const k of COST_KEYS) if (!used.has(k) && f[k] > 0.5) costs.push([FLOW_NAMES[k], f[k]]);
    costs.sort((a, b) => b[1] - a[1]);
    if (f.loanPrincipal > 0.5) costs.push(['Raty kredytu (kapitał)', f.loanPrincipal]);
    return `<div class="u-box"><div class="u-box-title">Skąd pieniądze</div>${barList(rev.slice(0, 7), '#5FD39A')}</div>
      <div class="u-box"><div class="u-box-title">Na co poszły</div>${barList(costs.slice(0, 7), '#FFA36B', '128px minmax(0, 1fr) 96px')}</div>`;
  }

  private adviceHtml(input: AdvisorInput): string {
    this.advice = advise(input, this.ap);
    const [a, ...rest] = this.advice;
    if (!a) return '';
    const more = rest.length ? `<div class="u-advice-more">Także: ${rest.map((r) => esc(r.title.toLowerCase())).join(' · ')}</div>` : '';
    return `<div class="u-advisor ${a.level}"><div class="u-advisor-ic">${icon(a.level === 'good' ? 'check' : 'bulb', 22)}</div>
      <div class="u-stack u-grow"><span class="u-advisor-title">${esc(a.title)}</span><span class="u-advisor-text">${esc(a.text)}</span>${more}</div>
      <div class="u-advisor-acts">${a.actions.map((x) => `<button type="button" class="u-btn${x.primary ? ' primary' : ''}" data-adv="${x.id}" data-i="0">${esc(x.label)}</button>`).join('')}</div></div>`;
  }

  private voices(r: GuestDayReport | null): string {
    if (!r) return '<p class="muted">Opinie zbieramy z dni oglądanych na żywo (symulacja gości). Ten dzień był przewinięty – liczony modelem zgrubnym.</p>';
    const items: { t: string; n: number; good: boolean }[] = [];
    r.leaveReasons.forEach((n, i) => {
      if (n > 0 && i !== 0) items.push({ t: `Wyjechali: ${LEAVE_REASONS[i]}`, n, good: false });
    });
    if (r.equipmentDamage > 0) items.push({ t: 'Kamienie na trasach – sprzęt uszkodzony', n: r.equipmentDamage, good: false });
    if (r.accidents.length) items.push({ t: 'Wypadki na stoku', n: r.accidents.length, good: false });
    if (r.ratings[4] > 0) items.push({ t: 'Świetny dzień (ocena 5)', n: r.ratings[4], good: true });
    if (r.ratings[3] > 0) items.push({ t: 'Dobry dzień (ocena 4)', n: r.ratings[3], good: true });
    if (r.ratings[0] + r.ratings[1] > 0) items.push({ t: 'Nieudany dzień (ocena 1–2)', n: r.ratings[0] + r.ratings[1], good: false });
    items.sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...items.map((x) => x.n));
    return items
      .slice(0, 5)
      .map((x) => `<div class="u-voice"><div class="u-voice-row"><span>${esc(x.t)}</span><b>${f0(x.n)}</b></div><div class="u-bar thin"><div style="width:${((100 * x.n) / max).toFixed(1)}%;background:${x.good ? '#5FD39A' : '#FF6B6B'}"></div></div></div>`)
      .join('');
  }

  private liftTable(r: GuestDayReport | null): string {
    if (!r || !r.busiestLifts.length) return '<p class="muted">Dane o wyciągach – z dni oglądanych na żywo (symulacja gości).</p>';
    return `<table class="u-table u-lifts"><thead><tr><th>Wyciąg</th><th>Przewiezieni</th><th>Kolejka</th><th>Obciążenie</th></tr></thead><tbody>${r.busiestLifts
      .slice(0, 5)
      .map((l) => `<tr><th>${esc(l.name)}</th><td>${f0(l.rides)}</td><td class="${l.maxWaitMin >= 15 ? 'bad' : l.maxWaitMin >= 5 ? 'warn' : ''}">${f0(l.maxWaitMin)} min</td><td class="${l.utilization >= 0.9 ? 'bad' : ''}">${f0(l.utilization * 100)} %</td></tr>`)
      .join('')}</tbody></table><div class="u-note-dim">Kolejka – najdłuższe czekanie w ciągu dnia; obciążenie – wjazdy wobec przepustowości.</div>`;
  }

  private advisorInput(guests: number, r: GuestDayReport | null, rating: number | null, closedDay: boolean): AdvisorInput {
    const park = this.src.parking(guests);
    const food = this.src.food(guests);
    const th = this.src.thin();
    const s = this.src.state();
    const month = s ? s.date.month : 1;
    return {
      guests,
      lifts: r ? r.busiestLifts.map((l) => ({ name: l.name, utilization: l.utilization, waitMin: l.maxWaitMin })) : [],
      parkingTurnedAway: park?.turnedAway ?? 0,
      parkingFullAt: park?.fullAt ?? null,
      parkingId: park?.parkingId ?? null,
      foodQueuePeak: 0,
      foodFull: food.full,
      hasFood: food.has,
      openPistes: th.open,
      thinPistes: th.thin,
      closedDay,
      hasSnowmaking: this.src.hasSnowmaking(),
      leftNoLevel: r ? r.leaveReasons[7] ?? 0 : 0,
      rating,
      winter: month >= 11 || month <= 4,
    };
  }

  // ------------------------------------------------------------------ dzień

  private dayHtml(s: GameState): { sub: string; body: string } {
    const d = s.lastDay;
    if (!d) return { sub: 'Pierwszy dzień gry jeszcze trwa.', body: '<p class="muted u-pad">Raport pojawi się po zamknięciu pierwszego dnia (o północy gry). Przewiń czas przyciskami ×5 / ×20.</p>' };
    const date = parseIsoDate(d.date);
    const r = this.src.guestReport(d.date);
    const rev = sumRevenue(d.flows);
    const cost = sumCosts(d.flows);
    const result = rev - cost;
    const days = s.year.days;
    const idx = days.findIndex((x) => x.date === d.date);
    const prevWeek: DayRecord | undefined = idx >= 7 ? days[idx - 7] : undefined;
    const guestDelta = prevWeek && prevWeek.guests > 0 ? (100 * (d.guests - prevWeek.guests)) / prevWeek.guests : null;
    const groups = COST_GROUPS.map(([n, keys]) => [n, keys.reduce((a, k) => a + d.flows[k], 0)] as [string, number]).sort((a, b) => b[1] - a[1]);
    const seasonResult = sumRevenue(s.year.flows) - sumCosts(s.year.flows);
    const rep = this.src.reputation();
    const tiles = this.tiles([
      { label: 'Goście', value: f0(d.guests), sub: guestDelta === null ? (d.open ? 'otwarte' : 'ośrodek nieczynny') : `${guestDelta >= 0 ? '+' : '−'}${f0(Math.abs(guestDelta))} % wobec tygodnia wcześniej`, subCls: guestDelta === null ? '' : guestDelta >= 0 ? 'good' : 'bad' },
      { label: 'Przychody', value: zl(rev), sub: d.guests > 0 ? `${f0(rev / d.guests)} zł na gościa` : 'brak gości' },
      { label: 'Koszty', value: zl(cost), sub: cost > 0 && groups[0][1] > 0 ? `${groups[0][0].toLowerCase()} ${f0((100 * groups[0][1]) / cost)} %` : '–' },
      { label: 'Wynik dnia', value: signedZl(result), sub: `w sezonie ${signedZl(seasonResult)}`, cls: result >= 0 ? 'good' : 'bad' },
      { label: 'Ocena gości', value: d.rating !== null ? `${f1(d.rating)} <small>/ 5</small>` : '–', sub: d.rating !== null ? (d.rating < rep - 0.15 ? `niżej niż reputacja ${f1(rep)}` : `reputacja ${f1(rep)}`) : 'brak ocen', subCls: d.rating !== null && d.rating < rep - 0.15 ? 'warn' : '' },
    ]);
    // Goście na stoku w ciągu dnia.
    let xs: number[] = [];
    let ys: number[] = [];
    if (r?.hourly.length) {
      xs = r.hourly.map((x) => x.hour + 0.5);
      ys = r.hourly.map((x) => x.onHill);
    } else if (d.guests > 0) {
      const prof = this.src.presence(d.guests);
      for (let k = 7 * 4; k <= 18 * 4; k += 2) {
        xs.push(k / 4);
        ys.push(prof[k]);
      }
    }
    const park = this.src.parking(d.guests);
    const peakI = ys.length ? ys.indexOf(Math.max(...ys)) : -1;
    const fullH = park?.fullAt ? Number(park.fullAt.slice(0, 2)) + Number(park.fullAt.slice(3)) / 60 : null;
    const chart = areaChart(xs, ys, (x) => `${Math.round(x)}:00`, [8, 10, 12, 14, 16].filter((t) => xs.length && t >= xs[0] - 0.5 && t <= xs[xs.length - 1] + 0.5), fullH !== null && park ? { x: fullH, label: `Parking pełny ${park.fullAt}` } : null, true);
    const body = `${tiles}
      <div class="u-report-row two">
        <div class="u-box"><div class="u-box-head"><span class="u-box-title">Goście na stoku w ciągu dnia</span><span class="u-dim">${peakI >= 0 ? `szczyt ${f0(ys[peakI])} o ${hhmm(Math.floor(xs[peakI]))}` : ''}${r ? '' : ' · model'}</span></div>${chart}</div>
        <div class="u-box"><div class="u-box-head"><span class="u-box-title">Co mówią goście</span><span class="u-dim">liczba osób</span></div>${this.voices(r)}<button type="button" class="u-btn wide u-mt-auto" data-guest-details ${tipAttrs('Dzisiejszy dzień w symulacji gości: oceny, powody wyjazdu, kolejki co godzinę, zatłoczone trasy, wypadki')}>Szczegóły dnia gości</button></div>
      </div>
      <div class="u-report-row three">${this.money(d.flows)}<div class="u-box"><div class="u-box-title">Wyciągi</div>${this.liftTable(r)}</div></div>
      ${this.adviceHtml(this.advisorInput(d.guests, r, d.rating, s.seasonOpen && !d.open))}`;
    return { sub: `${formatDayHeader(date)}, sezon ${this.src.seasonNumber()}. ${d.open ? `Ośrodek zamknięty o ${hhmm(this.src.closeH())}.` : 'Ośrodek nieczynny.'}`, body };
  }

  // ------------------------------------------------------------------ tydzień

  private weekHtml(s: GameState): { sub: string; body: string } {
    const days = s.year.days.slice(-7);
    if (!days.length) return { sub: 'Brak zamkniętych dni.', body: '<p class="muted u-pad">Raport tygodnia pojawi się po pierwszym zamkniętym dniu.</p>' };
    const flowsList = (s.recentFlows ?? []).filter((x) => days.some((d) => d.date === x.date)).map((x) => x.flows);
    const f = sumFlows(flowsList);
    const rev = flowsList.length ? sumRevenue(f) : days.reduce((a, d) => a + d.revenuePln, 0);
    const cost = flowsList.length ? sumCosts(f) : days.reduce((a, d) => a + d.costPln, 0);
    const guests = days.reduce((a, d) => a + d.guests, 0);
    const rated = days.filter((d) => d.rating !== null);
    const rating = rated.length ? rated.reduce((a, d) => a + d.rating! * d.guests, 0) / Math.max(1, rated.reduce((a, d) => a + d.guests, 0)) : null;
    const open = days.filter((d) => d.open).length;
    const tiles = this.tiles([
      { label: 'Goście', value: f0(guests), sub: `${open} z ${days.length} dni otwarte` },
      { label: 'Przychody', value: zl(rev), sub: guests ? `${f0(rev / guests)} zł na gościa` : '–' },
      { label: 'Koszty', value: zl(cost), sub: `${zl(cost / days.length)} dziennie` },
      { label: 'Wynik tygodnia', value: signedZl(rev - cost), sub: `saldo ${zl(s.balancePln)}`, cls: rev - cost >= 0 ? 'good' : 'bad' },
      { label: 'Ocena gości', value: rating !== null ? `${f1(rating)} <small>/ 5</small>` : '–', sub: `reputacja ${f1(this.src.reputation())}` },
    ]);
    const maxG = Math.max(1, ...days.map((d) => d.guests));
    const bars = days
      .map((d) => {
        const dt = parseIsoDate(d.date);
        const res = d.revenuePln - d.costPln;
        return `<div class="u-daybar" ${tipAttrs(`${d.date}: ${f0(d.guests)} gości, wynik ${signedZl(res)}`)} tabindex="0"><span class="u-daybar-v">${f0(d.guests)}</span><div class="u-daybar-col"><div style="height:${((100 * d.guests) / maxG).toFixed(1)}%" class="${d.open ? '' : 'closed'}"></div></div><span class="u-daybar-l">${formatDayHeader(dt).split(',')[0].slice(0, 3)} ${dt.day}</span><span class="u-daybar-r ${res >= 0 ? 'good' : 'bad'}">${signedZl(res)}</span></div>`;
      })
      .join('');
    const last = s.lastDay;
    const r = last ? this.src.guestReport(last.date) : null;
    const table = `<table class="u-table"><thead><tr><th>Dzień</th><th>Goście</th><th>Ocena</th><th>Wynik</th></tr></thead><tbody>${days
      .map((d) => `<tr><th>${d.date.slice(8)}.${d.date.slice(5, 7)}</th><td>${f0(d.guests)}</td><td>${d.rating !== null ? f1(d.rating) : '–'}</td><td class="${d.revenuePln - d.costPln >= 0 ? 'good' : 'bad'}">${signedZl(d.revenuePln - d.costPln)}</td></tr>`)
      .join('')}</tbody></table>`;
    const body = `${tiles}
      <div class="u-report-row two">
        <div class="u-box"><div class="u-box-head"><span class="u-box-title">Goście dzień po dniu</span><span class="u-dim">wynik dnia pod słupkiem</span></div><div class="u-daybars">${bars}</div></div>
        <div class="u-box"><div class="u-box-head"><span class="u-box-title">Co mówią goście</span><span class="u-dim">ostatni dzień</span></div>${this.voices(r)}</div>
      </div>
      <div class="u-report-row three">${flowsList.length ? this.money(f) : '<div class="u-box"><p class="muted">Podział przychodów i kosztów – od kolejnych zamkniętych dni.</p></div><div class="u-box"></div>'}<div class="u-box"><div class="u-box-title">Dni tygodnia</div>${table}</div></div>
      ${this.adviceHtml(this.advisorInput(last?.guests ?? 0, r, rating, s.seasonOpen && open === 0))}`;
    return { sub: `${days[0].date.slice(8)}.${days[0].date.slice(5, 7)}–${days[days.length - 1].date.slice(8)}.${days[days.length - 1].date.slice(5, 7)}, sezon ${this.src.seasonNumber()}.`, body };
  }

  // ------------------------------------------------------------------ sezon

  private seasonHtml(s: GameState): { sub: string; body: string } {
    const days = s.year.days;
    const f = s.year.flows;
    const rev = sumRevenue(f);
    const cost = sumCosts(f);
    const guests = days.reduce((a, d) => a + d.guests, 0);
    const open = days.filter((d) => d.open).length;
    const rated = days.filter((d) => d.rating !== null && d.guests > 0);
    const rating = rated.length ? rated.reduce((a, d) => a + d.rating! * d.guests, 0) / Math.max(1, rated.reduce((a, d) => a + d.guests, 0)) : null;
    const tiles = this.tiles([
      { label: 'Goście', value: f0(guests), sub: `${open} dni otwartych z ${days.length}` },
      { label: 'Przychody', value: zl(rev), sub: guests ? `${f0(rev / guests)} zł na gościa` : '–' },
      { label: 'Koszty', value: zl(cost), sub: `budowa ${zl(f.construction)}` },
      { label: 'Wynik roku', value: signedZl(rev - cost), sub: `saldo ${zl(s.balancePln)}`, cls: rev - cost >= 0 ? 'good' : 'bad' },
      { label: 'Ocena gości', value: rating !== null ? `${f1(rating)} <small>/ 5</small>` : '–', sub: `reputacja ${f1(this.src.reputation())}` },
    ]);
    const xs = days.map((_, i) => i);
    const ys = days.map((d) => d.guests);
    const ticks: number[] = [];
    days.forEach((d, i) => {
      if (d.date.endsWith('-01')) ticks.push(i);
    });
    const months = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
    const chart = areaChart(xs, ys, (x) => months[Number(days[Math.round(x)]?.date.slice(5, 7) ?? 1) - 1], ticks.length > 8 ? ticks.filter((_, k) => k % 2 === 0) : ticks, null, true);
    const best = [...days].sort((a, b) => b.guests - a.guests).slice(0, 6);
    const table = `<table class="u-table"><thead><tr><th>Najlepsze dni</th><th>Goście</th><th>Ocena</th><th>Wynik</th></tr></thead><tbody>${best
      .map((d) => `<tr><th>${d.date.slice(8)}.${d.date.slice(5, 7)}</th><td>${f0(d.guests)}</td><td>${d.rating !== null ? f1(d.rating) : '–'}</td><td class="${d.revenuePln - d.costPln >= 0 ? 'good' : 'bad'}">${signedZl(d.revenuePln - d.costPln)}</td></tr>`)
      .join('')}</tbody></table>`;
    const winterDays = days.filter((d) => {
      const m = Number(d.date.slice(5, 7));
      return m === 12 || m <= 3;
    });
    const closedShare = winterDays.length ? winterDays.filter((d) => !d.open).length / winterDays.length : 0;
    const last = s.lastDay;
    const r = last ? this.src.guestReport(last.date) : null;
    const body = `${tiles}
      <div class="u-report-row two">
        <div class="u-box"><div class="u-box-head"><span class="u-box-title">Goście dzień po dniu (od 1 maja)</span><span class="u-dim">${days.length ? `szczyt ${f0(Math.max(...ys))}` : ''}</span></div>${chart}</div>
        <div class="u-box">${table}<button type="button" class="u-btn wide" data-season-details>Szczegóły roku i poprzednie sezony</button></div>
      </div>
      <div class="u-report-row three">${this.money(f)}<div class="u-box"><div class="u-box-title">Wyciągi (ostatni dzień)</div>${this.liftTable(r)}</div></div>
      ${this.adviceHtml(this.advisorInput(last?.guests ?? 0, r, rating, s.seasonOpen && winterDays.length > 14 && closedShare > 0.5))}`;
    return { sub: `Rok gry od 1 maja ${s.year.startYear}, sezon ${this.src.seasonNumber()}.`, body };
  }
}
