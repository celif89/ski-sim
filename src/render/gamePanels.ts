/**
 * Panele gry (etap 6): finanse (saldo, dzień, sezon, kredyt, zapis), cennik i godziny otwarcia,
 * raport sezonu, ekran startowy (kariera / piaskownica / kontynuacja / wczytanie).
 */
import type { DayRecord, Flows, GameState, Loan, SeasonReport } from '../sim/economy';
import { COST_KEYS, FLOW_NAMES, REVENUE_KEYS, fmtPln, sumCosts, sumRevenue } from '../sim/economy';
import type { EconomyParams, OpeningHours, PassPrices } from '../sim/economyParams';
import { WINTER_CLASS_NAMES } from '../sim/winterClass';

const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const f1 = (v: number) => v.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const stars = (r: number) => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));

export interface FinanceView {
  state: GameState;
  modeLabel: string;
  phaseLabel: string;
  reputation: number;
  debtPln: number;
  loanLimitPln: number;
  assetValuePln: number;
  planNote: string;
  marketPricePln: number;
  /** Postęp przewijania dni (dni do policzenia) – null, gdy nic. */
  catchingUp: number | null;
}

export interface FinanceHandlers {
  onPrices(): void;
  onReport(): void;
  onSave(): void;
  onLoad(file: File): void;
  onNewGame(): void;
  onLoan(amountPln: number, years: number): void;
  onRepay(loanId: number): void;
}

export class FinancePanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly loanAmount: HTMLInputElement;
  private readonly loanYears: HTMLInputElement;
  private collapsed = false;
  private lastHtml = '';

  constructor(parent: HTMLElement, h: FinanceHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'build-panel finance-panel';
    this.root.innerHTML = `
      <button type="button" class="build-toggle">Finanse ▾</button>
      <div class="build-content">
        <div class="fin-body"></div>
        <div class="build-row build-buttons">
          <button type="button" class="f-prices" title="Ceny karnetów i godziny pracy wyciągów">Cennik i godziny</button>
          <button type="button" class="f-report" title="Raport roku gry: wynik, przepływy, frekwencja, konkurencja">Raport sezonu</button>
        </div>
        <details class="f-loan-box"><summary>Kredyt inwestycyjny</summary>
          <div class="f-loans"></div>
          <div class="build-row g-row"><label>Kwota <input type="number" class="f-amount" min="0" step="100000" value="2000000"> zł</label>
          <label>na <input type="number" class="f-years" min="1" max="15" step="1" value="10"> lat</label>
          <button type="button" class="f-take">Weź kredyt</button></div>
        </details>
        <div class="build-row build-buttons">
          <button type="button" class="f-save" title="Zapisz pełny stan gry do pliku (gra zapisuje się też sama co dzień w przeglądarce)">Zapisz grę</button>
          <label class="file-button" title="Wczytaj grę z pliku">Wczytaj grę<input type="file" accept=".json,application/json" class="f-load"></label>
          <button type="button" class="f-new" title="Nowa kariera albo piaskownica">Nowa gra</button>
        </div>
      </div>`;
    parent.insertBefore(this.root, parent.children[1] ?? null);
    this.body = this.root.querySelector('.fin-body')!;
    this.loanAmount = this.root.querySelector('.f-amount')!;
    this.loanYears = this.root.querySelector('.f-years')!;
    this.root.querySelector('.f-prices')!.addEventListener('click', () => h.onPrices());
    this.root.querySelector('.f-report')!.addEventListener('click', () => h.onReport());
    this.root.querySelector('.f-save')!.addEventListener('click', () => h.onSave());
    this.root.querySelector('.f-new')!.addEventListener('click', () => h.onNewGame());
    this.root.querySelector('.f-take')!.addEventListener('click', () => h.onLoan(Number(this.loanAmount.value) || 0, Number(this.loanYears.value) || 10));
    const file = this.root.querySelector<HTMLInputElement>('.f-load')!;
    file.addEventListener('change', () => {
      if (file.files?.[0]) h.onLoad(file.files[0]);
      file.value = '';
    });
    this.root.querySelector('.f-loans')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-loan]');
      if (b) h.onRepay(Number(b.dataset.loan));
    });
    this.root.querySelector('.build-toggle')!.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
      this.root.querySelector('.build-toggle')!.textContent = this.collapsed ? 'Finanse ▸' : 'Finanse ▾';
    });
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  update(v: FinanceView): void {
    const s = v.state;
    const d = s.lastDay;
    const y = s.year.flows;
    const result = sumRevenue(y) - sumCosts(y);
    const days = s.year.days;
    const openDays = days.filter((x) => x.open).length;
    const guests = days.reduce((a, x) => a + x.guests, 0);
    const building = Object.keys(s.construction).length;
    const html = `
      <div class="fin-top"><div><span class="muted">${v.modeLabel} · ${v.phaseLabel}</span><div class="fin-balance ${s.balancePln < 0 ? 'g-bad' : ''}">${fmtPln(s.balancePln)}</div></div>
        <div class="fin-rep" title="Reputacja z ocen gości (świeże ważą więcej)"><span class="fin-stars">${stars(v.reputation)}</span><br><span class="muted">${f1(v.reputation)} reputacja</span></div></div>
      ${s.bankrupt ? '<div class="g-bad"><b>Bankructwo – koniec kariery.</b> Zacznij nową grę albo wczytaj zapis.</div>' : ''}
      ${v.catchingUp !== null ? `<div class="g-catch">Liczę dni… zostało ${f0(v.catchingUp)}</div>` : ''}
      <div class="fin-grid">
        <div><span class="muted">Wczoraj</span>${d ? `<b>${d.open ? `${f0(d.guests)} gości` : 'zamknięte'}</b><span>+${fmtPln(d.revenuePln)} / −${fmtPln(d.costPln)}</span>` : '<b>–</b>'}</div>
        <div><span class="muted">Rok gry (od 1 V)</span><b class="${result >= 0 ? '' : 'g-bad'}">${result >= 0 ? '+' : ''}${fmtPln(result)}</b><span>${openDays} dni otw. · ${f0(guests)} gości</span></div>
        <div><span class="muted">Budowa w roku</span><b>${fmtPln(y.construction + s.pending.construction - y.refunds - s.pending.refunds)}</b><span>${building ? `🚧 ${building} w toku` : 'nic w toku'}</span></div>
        <div><span class="muted">Kredyt</span><b>${fmtPln(v.debtPln)}</b><span>majątek ${fmtPln(v.assetValuePln)}</span></div>
      </div>
      <div class="fin-prices muted">Karnet dzienny <b>${f0(s.prices.dayPln)} zł</b> (konkurencja śr. ${f0(v.marketPricePln)} zł) · 4 h ${f0(s.prices.fourHourPln)} · 2 h ${f0(s.prices.twoHourPln)} · wyciągi ${hhmm(s.hours.openH)}–${hhmm(s.hours.closeH)}</div>
      ${v.planNote ? `<div class="fin-plan">${v.planNote}</div>` : ''}
      ${s.log.length ? `<div class="build-section">Wydarzenia</div>${s.log.slice(-4).reverse().map((l) => `<div class="g-event">${l.date.slice(5).split('-').reverse().join('.')} – ${l.text}</div>`).join('')}` : ''}`;
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.body.innerHTML = html;
    }
    const loans = this.root.querySelector('.f-loans')!;
    const lh = s.loans.length
      ? `<table class="build-list"><tr><th>kredyt</th><th>zostało</th><th>rata/mies.</th><th></th></tr>${s.loans.map((l: Loan) => `<tr><td>${l.takenOn}</td><td>${fmtPln(l.remainingPln)}</td><td>${fmtPln(l.monthlyPaymentPln)}</td><td><button type="button" data-loan="${l.id}" title="Spłać całość z gotówki">Spłać</button></td></tr>`).join('')}</table>`
      : '<div class="muted">Brak kredytów.</div>';
    const limit = `<div class="muted small">Bank pożyczy jeszcze do ${fmtPln(v.loanLimitPln)}. Oprocentowanie i limity: data/economy.json.</div>`;
    if (loans.innerHTML !== lh + limit) loans.innerHTML = lh + limit;
    this.root.classList.toggle('hidden', false);
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }
}

// ------------------------------------------------------------------ okna

export abstract class Modal {
  protected readonly root: HTMLElement;
  protected readonly body: HTMLElement;
  constructor(parent: HTMLElement, cls: string) {
    this.root = document.createElement('div');
    this.root.className = `a-card game-modal ${cls} hidden`;
    this.root.innerHTML = `<button type="button" class="profile-close" title="Zamknij">×</button><div class="gm-body"></div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.gm-body')!;
    this.root.querySelector('.profile-close')!.addEventListener('click', () => this.hide());
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }
  hide(): void {
    this.root.classList.add('hidden');
  }
  protected showRoot(): void {
    this.root.classList.remove('hidden');
  }
  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}

export class PricesDialog extends Modal {
  constructor(parent: HTMLElement, private readonly onApply: (prices: PassPrices, hours: OpeningHours) => void) {
    super(parent, 'prices-dialog');
  }

  show(prices: PassPrices, hours: OpeningHours, ep: EconomyParams, marketPln: number): void {
    const comp = ep.competitors.list.map((c) => `${c.name} ${c.dayPln} zł`).join(', ');
    this.body.innerHTML = `
      <div class="gc-title">Cennik i godziny otwarcia</div>
      <div class="gc-sub">Zmiany obowiązują od następnego dnia. Wyższa cena – mniej gości (porównują z konkurencją: ${comp}; średnio ${f0(marketPln)} zł).</div>
      <div class="gm-grid">
        <label>Karnet dzienny <input type="number" name="dayPln" min="${ep.passes.minPricePln}" max="${ep.passes.maxPricePln}" value="${prices.dayPln}"> zł</label>
        <label>Karnet 4 h <input type="number" name="fourHourPln" min="${ep.passes.minPricePln}" max="${ep.passes.maxPricePln}" value="${prices.fourHourPln}"> zł</label>
        <label>Karnet 2 h <input type="number" name="twoHourPln" min="${ep.passes.minPricePln}" max="${ep.passes.maxPricePln}" value="${prices.twoHourPln}"> zł</label>
        <label>Punkt (karnet punktowy) <input type="number" name="pointPln" step="0.5" min="0" value="${prices.pointPln}"> zł</label>
        <label>Otwarcie wyciągów <input type="time" name="open" value="${hhmm(hours.openH)}" min="${hhmm(ep.hours.minOpenH)}" max="${hhmm(ep.hours.maxCloseH)}"></label>
        <label>Zamknięcie <input type="time" name="close" value="${hhmm(hours.closeH)}" min="${hhmm(ep.hours.minOpenH)}" max="${hhmm(ep.hours.maxCloseH)}"></label>
      </div>
      <div class="muted small">Przejazd za punkty: orczyk/talerzyk ${ep.passes.pointsSurfaceRide} pkt, kanapa ${ep.passes.pointsChairRide} pkt, gondola ${ep.passes.pointsGondolaRide} pkt. Dzieci i seniorzy płacą ${Math.round(ep.passes.reducedFactor * 100)} % ceny. Dłużej otwarte – więcej przejazdów, ale i wyższe koszty obsługi i energii.</div>
      <div class="build-row build-buttons"><button type="button" class="gm-apply">Zapisz cennik</button></div>`;
    this.body.querySelector('.gm-apply')!.addEventListener('click', () => {
      const v = (n: string) => Number((this.body.querySelector(`[name="${n}"]`) as HTMLInputElement).value);
      const t = (n: string) => {
        const [h, m] = (this.body.querySelector(`[name="${n}"]`) as HTMLInputElement).value.split(':').map(Number);
        return h + (m || 0) / 60;
      };
      this.onApply({ dayPln: v('dayPln'), fourHourPln: v('fourHourPln'), twoHourPln: v('twoHourPln'), pointPln: v('pointPln') }, { openH: t('open'), closeH: t('close') });
      this.hide();
    });
    this.showRoot();
  }
}

/** Mały wykres dni: goście (słupki) i ocena śniegu (linia). */
function daysChart(days: DayRecord[]): string {
  const season = days.filter((d) => {
    const m = Number(d.date.slice(5, 7));
    return m >= 11 || m <= 4;
  });
  if (!season.length) return '<div class="muted">Brak dni sezonu.</div>';
  const w = 640;
  const h = 150;
  const pad = { l: 36, r: 8, t: 10, b: 20 };
  const max = Math.max(10, ...season.map((d) => Math.max(d.guests, d.compGuests[2] ?? 0)));
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / Math.max(1, season.length - 1)) * pw;
  const y = (v: number) => pad.t + ph * (1 - v / max);
  let svg = `<svg viewBox="0 0 ${w} ${h}" class="gm-chart">`;
  season.forEach((d, i) => {
    if (d.open && d.guests > 0) svg += `<rect x="${x(i) - 1}" y="${y(d.guests)}" width="2.4" height="${pad.t + ph - y(d.guests)}" fill="#1c64d8"><title>${d.date} ${d.label}: ${d.guests} gości</title></rect>`;
  });
  svg += `<polyline fill="none" stroke="#2f9e44" stroke-width="1.5" points="${season.map((d, i) => `${x(i)},${pad.t + ph * (1 - d.snowScore)}`).join(' ')}"/>`;
  season.forEach((d, i) => {
    if (d.date.endsWith('-01')) svg += `<text x="${x(i)}" y="${h - 5}" font-size="10" fill="#64748b">${d.date.slice(5, 7)}.${d.date.slice(2, 4)}</text>`;
  });
  svg += `<text x="${pad.l - 4}" y="${pad.t + 8}" font-size="10" fill="#64748b" text-anchor="end">${f0(max)}</text></svg>`;
  return `<div class="legend small"><span style="color:#1c64d8">■ goście dziennie</span> <span style="color:#2f9e44">— ocena śniegu na trasach (0–1)</span></div>${svg}`;
}

function flowsTable(f: Flows): string {
  const rows = (keys: readonly (keyof Flows)[]) => keys.filter((k) => Math.abs(f[k]) > 0.5).map((k) => `<tr><td>${FLOW_NAMES[k]}</td><td>${fmtPln(f[k])}</td></tr>`).join('');
  return `<div class="dr-cols"><div><b>Przychody</b><table class="build-list">${rows(REVENUE_KEYS) || '<tr><td class="muted">brak</td></tr>'}<tr><td><b>razem</b></td><td><b>${fmtPln(sumRevenue(f))}</b></td></tr></table></div>
    <div><b>Koszty</b><table class="build-list">${rows(COST_KEYS)}<tr><td><b>razem</b></td><td><b>${fmtPln(sumCosts(f))}</b></td></tr></table></div></div>
    <table class="build-list" style="margin-top:6px"><tr><td>Budowa (inwestycje)</td><td>${fmtPln(f.construction)}</td></tr>${f.refunds ? `<tr><td>Zwroty za anulowane budowy</td><td>${fmtPln(f.refunds)}</td></tr>` : ''}<tr><td>Kredyt – wypłaty / spłata kapitału</td><td>${fmtPln(f.loanIn)} / ${fmtPln(f.loanPrincipal)}</td></tr></table>`;
}

/** Naśnieżanie i ratraki w sezonie (etap 7): śnieg, woda, energia, paliwo, koszty, dni dzięki naśnieżaniu. */
function snowSection(r: SeasonReport): string {
  const sum = (k: 'snowM3' | 'waterM3' | 'snowKWh' | 'fuelL' | 'groomed' | 'unfinished') => r.days.reduce((a, d) => a + (d[k] ?? 0), 0);
  const snowM3 = sum('snowM3');
  const fuel = sum('fuelL');
  if (snowM3 <= 0 && fuel <= 0) return '';
  const f = r.flows;
  const snowCost = f.snowEnergy + f.water;
  const groomCost = f.groomFuel + f.groomStaff + f.groomService + f.leasing + f.repairs;
  const tech = r.days.filter((d) => d.techOpen).length;
  return `<h4>Naśnieżanie i ratraki</h4>
    <table class="build-list">
      <tr><td>Śnieg techniczny</td><td>${f0(snowM3)} m³</td><td>woda ${f0(sum('waterM3'))} m³ · energia ${f0(sum('snowKWh') / 1000)} MWh</td></tr>
      <tr><td>Koszt naśnieżania</td><td>${fmtPln(snowCost)}</td><td>${snowM3 > 0 ? `${f1(snowCost / snowM3)} zł/m³ śniegu (bez budowy)` : ''}</td></tr>
      <tr><td>Ratraki</td><td>${f0(fuel)} l paliwa</td><td>${f0(sum('groomed'))} przejazdów tras · nie zdążyły ${f0(sum('unfinished'))} razy · koszt ${fmtPln(groomCost)}</td></tr>
      <tr><td><b>Dni otwarte dzięki naśnieżaniu</b></td><td><b>${tech}</b></td><td>na samym naturalnym śniegu połowa tras miałaby zbyt cienką bazę</td></tr>
    </table>`;
}

export class SeasonReportView extends Modal {
  constructor(parent: HTMLElement) {
    super(parent, 'season-report');
  }

  show(r: SeasonReport, ep: EconomyParams, final: boolean, us: { kmOpen: number; dayPln: number }): void {
    const result = sumRevenue(r.flows) - sumCosts(r.flows);
    const best = r.days.reduce<DayRecord | null>((a, d) => (!a || d.guests > a.guests ? d : a), null);
    const comp = r.competitors
      .map((c, i) => `<tr><td>${c.name}</td><td>${f1(ep.competitors.list[i].pisteKm)} km</td><td>${c.dayPln} zł</td><td>${c.openDays}</td><td>${f0(c.guests)}</td></tr>`)
      .join('');
    this.body.innerHTML = `
      <div class="gc-title">${final ? 'Raport sezonu' : 'Sezon – stan na dziś'} ${r.startYear}/${String((r.startYear + 1) % 100).padStart(2, '0')}</div>
      <div class="gc-sub">Rok gry ${r.from} – ${r.to}${final ? '' : ' (w trakcie)'}</div>
      <div class="dr-kpis">
        <div><b class="${result >= 0 ? '' : 'g-bad'}">${fmtPln(result)}</b><span>wynik (przychody − koszty)</span></div>
        <div><b>${fmtPln(r.balanceEnd)}</b><span>saldo (na początku ${fmtPln(r.balanceStart)})</span></div>
        <div><b>${r.openDays}</b><span>dni otwartych</span></div>
        <div><b>${f0(r.guests)}</b><span>gości</span></div>
        <div><b>${r.meanRating === null ? '–' : f1(r.meanRating)}</b><span>średnia ocena gości</span></div>
        <div><b>${f1(r.reputationEnd)} ★</b><span>reputacja</span></div>
        ${r.winter ? `<div title="Dni 1 XII – 31 III z bazą ubitą ≥ ${r.winter.thresholdCm} cm ze śniegu naturalnego na otwartym terenie na ${r.winter.elevationM} m (model w punkcie), na tle 160 zim z generatora pogody"><b>${WINTER_CLASS_NAMES[r.winter.cls]}</b><span>zima: ${r.winter.days} dni ze śniegiem (średnio ${f0(r.winter.meanDays)}; ${f0(r.winter.percentile * 100)}. percentyl)</span></div>` : ''}
      </div>
      ${daysChart(r.days)}
      ${best && best.guests > 0 ? `<div class="muted small">Najlepszy dzień: ${best.date} (${best.label}) – ${f0(best.guests)} gości.</div>` : ''}
      <h4>Przepływy pieniędzy</h4>${flowsTable(r.flows)}
      <h4>Porównanie z konkurencją</h4>
      <table class="build-list"><tr><th>ośrodek</th><th>trasy</th><th>karnet</th><th>dni otw.</th><th>goście</th></tr>
      <tr><td><b>Twój ośrodek</b></td><td>${f1(us.kmOpen)} km</td><td>${f0(us.dayPln)} zł</td><td>${r.openDays}</td><td>${f0(r.guests)}</td></tr>${comp}</table>
      ${snowSection(r)}
      <div class="muted small">Konkurenci naśnieżają – dlatego zwykle mają dłuższy sezon. Kredyt na koniec: ${fmtPln(r.debtEnd)}.</div>`;
    this.showRoot();
  }
}

export interface StartChoice {
  hasAutosave: boolean;
  autosaveLabel: string;
}

export class StartScreen extends Modal {
  constructor(
    parent: HTMLElement,
    private readonly h: { onCareer(): void; onSandbox(): void; onContinue(): void; onLoad(file: File): void },
  ) {
    super(parent, 'start-screen');
  }

  show(c: StartChoice, ep: EconomyParams): void {
    this.body.innerHTML = `
      <div class="gc-title">Symulator ośrodka narciarskiego – Pilsko</div>
      <div class="gc-sub">Północne stoki Pilska nad Korbielowem. Wybierz tryb gry.</div>
      <div class="start-options">
        ${c.hasAutosave ? `<button type="button" class="st-continue"><b>Kontynuuj</b><span>${c.autosaveLabel}</span></button>` : ''}
        <button type="button" class="st-career"><b>Nowa kariera</b><span>Pusta góra, ${fmtPln(ep.career.startCapitalPln)} kapitału, start ${ep.career.startDate.split('-').reverse().join('.')} (lato – czas budowy). Budowa kosztuje i trwa, możesz wziąć kredyt. Bankructwo kończy grę.</span></button>
        <button type="button" class="st-sandbox"><b>Piaskownica</b><span>Bez limitu pieniędzy, budowa od razu. Twój dotychczasowy układ ośrodka zostaje.</span></button>
        <label class="st-load file-button"><b>Wczytaj grę z pliku</b><span>Plik zapisany przyciskiem „Zapisz grę”.</span><input type="file" accept=".json,application/json"></label>
      </div>`;
    this.body.querySelector('.st-continue')?.addEventListener('click', () => {
      this.hide();
      this.h.onContinue();
    });
    this.body.querySelector('.st-career')!.addEventListener('click', () => {
      this.hide();
      this.h.onCareer();
    });
    this.body.querySelector('.st-sandbox')!.addEventListener('click', () => {
      this.hide();
      this.h.onSandbox();
    });
    const file = this.body.querySelector<HTMLInputElement>('.st-load input')!;
    file.addEventListener('change', () => {
      if (file.files?.[0]) {
        this.hide();
        this.h.onLoad(file.files[0]);
      }
    });
    this.root.querySelector('.profile-close')!.classList.add('hidden');
    this.showRoot();
  }
}
