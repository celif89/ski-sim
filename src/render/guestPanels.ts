/**
 * Panele gości (etap 5): panel „Goście” (liczba gości dnia, stan, wyciągi: kolejka, czekanie,
 * wykorzystanie; zdarzenia), karta gościa (po kliknięciu postaci) i raport dnia.
 */
import type { GuestCard, GuestCounts, GuestDayReport, GuestEvent } from '../sim/guests';
import { LEAVE_REASONS } from '../sim/guests';

const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const f1 = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const hhmm = (s: number) => {
  const m = Math.round(s / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const bar = (v: number, cls = '') => `<span class="g-bar ${cls}"><span style="width:${Math.round(Math.min(1, Math.max(0, v)) * 100)}%"></span></span>`;
const stars = (r: number) => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));

export interface LiftRow {
  name: string;
  queue: number;
  waitMin: number;
  utilization: number;
  closed: boolean;
  onLine: number;
  rides: number;
}

export interface GuestPanelHandlers {
  onGuestsChange(n: number): void;
  onRestart(): void;
  onReport(): void;
  onLoadOsm(): void;
  onResortOpen(open: boolean): void;
}

/** Ostrzeżenie „za mało śniegu” na trasie (z kontrolera budowy). */
export interface SnowWarningRow {
  pisteName: string;
  segments: { fromM: number; toM: number; baseCm: number; neededCm: number }[];
}

export class GuestPanel {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly lifts: HTMLElement;
  private readonly events: HTMLElement;
  private readonly count: HTMLInputElement;
  private readonly osm: HTMLButtonElement;
  private readonly open: HTMLInputElement;
  private readonly warnings: HTMLElement;
  private collapsed = false;
  private lastHtml = '';

  constructor(parent: HTMLElement, h: GuestPanelHandlers, initialGuests: number) {
    this.root = document.createElement('div');
    this.root.className = 'build-panel guest-panel';
    this.root.innerHTML = `
      <button type="button" class="build-toggle">Goście ▾</button>
      <div class="build-content">
        <div class="build-row g-row">
          <label class="g-open-label" title="Ośrodek otwarty – przyjeżdżają goście. Zamknięty (przed sezonem i po sezonie) – nikt nie przyjeżdża, wyciągi stoją."><input type="checkbox" class="g-open"> Ośrodek otwarty</label>
        </div>
        <div class="build-row g-row">
          <label title="Ilu gości przyjedzie danego dnia (parametr scenariusza – popyt i ceny w etapie 6)">Gości dziś <input type="number" class="g-count" min="0" max="8000" step="100"></label>
          <button type="button" class="g-restart" title="Zacznij ten dzień od nowa (ten sam seed – ten sam przebieg)">↺ Od nowa</button>
          <button type="button" class="g-report" title="Raport dnia: przejazdy, kolejki, oceny, wypadki, zatłoczone miejsca">Raport dnia</button>
        </div>
        <div class="g-status"></div>
        <div class="g-hint"></div>
        <div class="g-lifts"></div>
        <div class="g-warnings"></div>
        <div class="g-events"></div>
        <div class="build-row build-buttons"><button type="button" class="g-osm" title="Wyciągi i trasy prawdziwego ośrodka Pilsko z OpenStreetMap jako Twój układ (można cofnąć: Ctrl+Z)">Wczytaj prawdziwy ośrodek Pilsko</button></div>
      </div>`;
    // Zaraz pod legendą (nad panelem budowy).
    parent.insertBefore(this.root, parent.children[1] ?? null);
    this.status = this.root.querySelector('.g-status')!;
    this.hint = this.root.querySelector('.g-hint')!;
    this.lifts = this.root.querySelector('.g-lifts')!;
    this.events = this.root.querySelector('.g-events')!;
    this.count = this.root.querySelector('.g-count')!;
    this.osm = this.root.querySelector('.g-osm')!;
    this.open = this.root.querySelector('.g-open')!;
    this.warnings = this.root.querySelector('.g-warnings')!;
    this.open.checked = true;
    this.open.addEventListener('change', () => h.onResortOpen(this.open.checked));
    this.count.value = String(initialGuests);
    this.count.addEventListener('change', () => h.onGuestsChange(Math.max(0, Math.round(Number(this.count.value) || 0))));
    this.root.querySelector('.g-restart')!.addEventListener('click', () => h.onRestart());
    this.root.querySelector('.g-report')!.addEventListener('click', () => h.onReport());
    this.osm.addEventListener('click', () => h.onLoadOsm());
    this.root.querySelector('.build-toggle')!.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
      this.root.querySelector('.build-toggle')!.textContent = this.collapsed ? 'Goście ▸' : 'Goście ▾';
    });
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  setHint(text: string, showOsm: boolean): void {
    this.hint.textContent = text;
    this.hint.classList.toggle('hidden', !text);
    this.osm.classList.toggle('hidden', !showOsm);
  }

  update(counts: GuestCounts | null, lifts: LiftRow[], catching: number | null): void {
    let s = '';
    if (catching !== null) s = `<div class="g-catch">Przeliczam dzień do tej godziny… ${f0(catching * 100)} %</div>`;
    else if (counts) {
      s = `<div class="g-counts">
        <span title="Na stoku teraz"><b>${f0(counts.onHill)}</b> na stoku</span>
        <span title="Stoją w kolejkach"><b>${f0(counts.inQueue)}</b> w kolejkach</span>
        <span title="Jadą wyciągami (albo czekają na górze na grupę)"><b>${f0(counts.onLift)}</b> na wyciągach</span>
        <span title="Zjeżdżają"><b>${f0(counts.onPiste)}</b> na trasach</span>
        <span title="Posiłek, odpoczynek, ogrzewanie się"><b>${f0(counts.inBreak)}</b> na przerwie</span>
        <span title="Przyjechało / wyjechało / planowanych"><b>${f0(counts.arrived)}</b> przyjechało, ${f0(counts.gone)} wyjechało z ${f0(counts.planned)}</span>
      </div>`;
    }
    const rows = lifts
      .map(
        (l) =>
          `<tr class="${l.closed ? 'g-closed' : ''}"><td><b>${l.name}</b></td><td>${l.closed ? 'stoi' : `${f0(l.queue)} os.`}</td><td class="${l.waitMin > 15 ? 'g-bad' : l.waitMin > 5 ? 'g-warn' : ''}">${l.closed ? '–' : `${f0(l.waitMin)} min`}</td><td>${bar(l.utilization, l.utilization > 0.9 ? 'red' : '')} ${f0(l.utilization * 100)} %</td></tr>`,
      )
      .join('');
    const html = s + (lifts.length ? `<table class="build-list"><tr><th>Wyciąg</th><th>Kolejka</th><th>Czekanie</th><th>Wykorzystanie (30 min)</th></tr>${rows}</table>` : '');
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.status.innerHTML = s;
      this.lifts.innerHTML = lifts.length ? `<table class="build-list"><tr><th>Wyciąg</th><th>Kolejka</th><th>Czekanie</th><th title="Ilu wjechało w ostatnich 30 min wobec przepustowości">Wykorzystanie</th></tr>${rows}</table>` : '';
    }
  }

  setEvents(events: GuestEvent[]): void {
    const last = events.slice(-4).reverse();
    this.events.innerHTML = last.length
      ? `<div class="build-section">Dziennik zdarzeń</div>${last.map((e) => `<div class="g-event">🚑 ${hhmm(e.timeS)} – wypadek, ${e.place} (${e.cause})</div>`).join('')}${events.length > 4 ? `<div class="muted">…i ${events.length - 4} wcześniej (raport dnia)</div>` : ''}`
      : '';
  }

  setGuests(n: number): void {
    this.count.value = String(n);
  }

  setResortOpen(open: boolean): void {
    this.open.checked = open;
    this.root.classList.toggle('g-resort-closed', !open);
  }

  /** Lista „za mało śniegu” na otwartych trasach (odcinki: od–do [m], baza / potrzebna [cm]). */
  setSnowWarnings(rows: SnowWarningRow[]): void {
    if (!rows.length) {
      this.warnings.innerHTML = '';
      return;
    }
    const items = rows.slice(0, 6).map((r) => {
      const worst = r.segments.reduce((a, b) => (b.baseCm / b.neededCm < a.baseCm / a.neededCm ? b : a));
      const segs = r.segments
        .slice(0, 3)
        .map((g) => `${f0(g.fromM)}–${f0(g.toM)} m`)
        .join(', ');
      return `<div class="g-warning">⚠ Za mało śniegu: <b>${r.pisteName}</b>, ${segs}${r.segments.length > 3 ? '…' : ''} – ${f0(worst.baseCm)} cm bazy, potrzebne ${f0(worst.neededCm)} cm</div>`;
    });
    this.warnings.innerHTML = `<div class="build-section">Śnieg na otwartych trasach</div>${items.join('')}${rows.length > 6 ? `<div class="muted">…i ${rows.length - 6} innych tras</div>` : ''}<div class="muted">Zamknij trasę w profilu (klik na trasie) albo poczekaj na śnieg. Na zbyt cienkiej bazie: kamienie, więcej wypadków, uszkodzony sprzęt.</div>`;
  }
}

/** Karta gościa (po kliknięciu postaci na mapie). */
export class GuestCardView {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'a-card guest-card hidden';
    this.root.innerHTML = `<button type="button" class="profile-close" title="Zamknij">×</button><div class="gc-body"></div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.gc-body')!;
    this.root.querySelector('.profile-close')!.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  show(c: GuestCard): void {
    this.root.classList.remove('hidden');
    const who = `${c.child ? 'dziecko – ' : ''}${c.snowboard ? 'snowboardzista' : 'narciarz'}, ${c.skillName}`;
    this.body.innerHTML = `
      <div class="gc-title">Gość nr ${c.id + 1}</div>
      <div class="gc-sub">${who} · ${c.typeName}${c.groupSize > 1 ? ` (${c.groupSize} os.)` : ''}</div>
      <div class="gc-doing">${c.doing}</div>
      <div class="gc-plan">${c.plan}</div>
      <div class="gc-grid">
        <span>Zadowolenie</span><span>${bar(c.satisfaction, 'green')} ${stars(c.ratingNow)}</span>
        <span>Zmęczenie</span><span>${bar(c.fatigue)} ${f0(c.fatigue * 100)} %</span>
        <span>Głód</span><span>${bar(c.hunger)} ${f0(c.hunger * 100)} %</span>
        <span>Zimno</span><span>${bar(c.cold, 'blue')} ${f0(c.cold * 100)} %</span>
      </div>
      <div class="gc-grid gc-small">
        <span>Zjazdy / wjazdy</span><span>${c.runs} / ${c.liftRides}</span>
        <span>Przejechał</span><span>${f1(c.distanceKm)} km, ${f0(c.verticalM)} m w dół</span>
        <span>Jazda / kolejki</span><span>${f0(c.skiMin)} / ${f0(c.queueMin)} min</span>
        <span>Cierpliwość w kolejce</span><span>ok. ${f0(c.patienceMin)} min</span>
        <span>Lubi</span><span>długie trasy ${f0(c.prefs.long * 100)} %, puch ${f0(c.prefs.powder * 100)} %, spokój ${f0(c.prefs.quiet * 100)} %</span>
        <span>Pobyt</span><span>${hhmm(c.arriveH * 3600)}–${hhmm(c.departH * 3600)} (plan)</span>
      </div>`;
  }
}

/** Raport dnia. */
export class DayReportView {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'a-card day-report hidden';
    this.root.innerHTML = `<button type="button" class="profile-close" title="Zamknij">×</button><div class="dr-body"></div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.dr-body')!;
    this.root.querySelector('.profile-close')!.addEventListener('click', () => this.hide());
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  show(r: GuestDayReport): void {
    this.root.classList.remove('hidden');
    const d = `${r.date.day}.${String(r.date.month).padStart(2, '0')}.${r.date.year}`;
    const finished = r.counts.onHill === 0 && r.counts.arrived === r.counts.planned;
    const ratingBars = r.ratings
      .map((n, i) => `<div class="dr-rate"><span>${'★'.repeat(i + 1)}</span>${bar(r.counts.arrived ? n / r.counts.arrived : 0, 'gold')}<span>${f0(n)}</span></div>`)
      .reverse()
      .join('');
    const reasons = r.leaveReasons
      .map((n, i) => ({ n, t: LEAVE_REASONS[i] }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .map((x) => `<li>${x.t}: ${f0(x.n)} os.</li>`)
      .join('');
    const lifts = r.busiestLifts
      .slice(0, 6)
      .map((l) => `<tr><td><b>${l.name}</b></td><td>${f0(l.rides)}</td><td>${f0(l.maxQueue)} os.</td><td>${f0(l.maxWaitMin)} min</td><td>${f0(l.utilization * 100)} %</td></tr>`)
      .join('');
    const pistes = r.crowdedPistes.map((p) => `<tr><td><b>${p.name}</b></td><td>${f0(p.peakPer100m)}</td><td>${f0(p.personHours)}</td></tr>`).join('');
    const accidents = r.accidents.map((e) => `<li>${hhmm(e.timeS)} – ${e.place} (${e.cause})</li>`).join('');
    const maxHill = Math.max(1, ...r.hourly.map((h) => h.onHill));
    const hourly = r.hourly
      .map((h) => `<div class="dr-hour" title="${h.hour}:00 – na stoku ${h.onHill}, w kolejkach ${h.inQueue}, średnie czekanie ${f1(h.meanWaitMin)} min"><span style="height:${Math.round((h.onHill / maxHill) * 100)}%"></span><span class="q" style="height:${Math.round((h.inQueue / maxHill) * 100)}%"></span><em>${h.hour}</em></div>`)
      .join('');
    this.body.innerHTML = `
      <div class="gc-title">Raport dnia – ${d}${finished ? '' : ` (stan na ${hhmm(r.timeS)})`}</div>
      <div class="dr-kpis">
        <div><b>${f0(r.counts.arrived)}</b><span>gości</span></div>
        <div><b>${f0(r.liftRides)}</b><span>wjazdów</span></div>
        <div><b>${f0(r.descents)}</b><span>zjazdów</span></div>
        <div><b>${f1(r.meanQueueMin)} min</b><span>średnio w kolejce na wjazd</span></div>
        <div><b>${f1(r.meanRating)} ★</b><span>średnia ocena</span></div>
        <div><b>${f0(r.accidents.length)}</b><span>wypadków</span></div>
      </div>
      <div class="dr-cols">
        <div><div class="build-section">Oceny gości (1–5)</div>${ratingBars}<div class="build-section">Dlaczego wyjechali</div><ul class="dr-list">${reasons || '<li>nikt jeszcze nie wyjechał</li>'}</ul></div>
        <div><div class="build-section">Na stoku i w kolejkach (co godzinę)</div><div class="dr-hours">${hourly}</div><div class="muted">niebieskie – na stoku, pomarańczowe – w kolejkach</div></div>
      </div>
      <div class="build-section">Wyciągi – najdłuższe czekanie</div>
      <table class="build-list"><tr><th>Wyciąg</th><th>Wjazdy</th><th>Najdłuższa kolejka</th><th>Najdłuższe czekanie</th><th>Wykorzystanie</th></tr>${lifts}</table>
      <div class="build-section">Najbardziej zatłoczone trasy</div>
      <table class="build-list"><tr><th>Trasa</th><th>Szczyt tłoku [os./100 m]</th><th>Osobogodziny jazdy</th></tr>${pistes || '<tr><td colspan="3">–</td></tr>'}</table>
      <div class="build-section">Wypadki (ratownicy – etap 8)</div>
      <ul class="dr-list">${accidents || '<li>bez wypadków</li>'}</ul>`;
  }
}
