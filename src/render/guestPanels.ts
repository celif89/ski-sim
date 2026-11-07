/**
 * Panele gości (etap 5): panel „Goście” (liczba gości dnia, stan, wyciągi: kolejka, czekanie,
 * wykorzystanie; zdarzenia), karta gościa (po kliknięciu postaci) i raport dnia.
 */
import type { GuestCard, GuestCounts, GuestDayReport, GuestEvent } from '../sim/guests';
import { LEAVE_REASONS } from '../sim/guests';
import { icon } from './ui/icons';

const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const f1 = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const hhmm = (s: number) => {
  const m = Math.round(s / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const bar = (v: number, cls = '') => `<span class="g-bar ${cls}"><span style="width:${Math.round(Math.min(1, Math.max(0, v)) * 100)}%"></span></span>`;

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
  private readonly planNote: HTMLElement;
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
          <label class="g-open-label" title="Ośrodek otwarty – przyjeżdżają goście. Zamknięty (przed sezonem i po sezonie) – nikt nie przyjeżdża, wyciągi stoją."><input type="checkbox" class="g-open"> Sezon otwarty</label>
        </div>
        <div class="build-row g-row">
          <label title="Ilu gości przyjedzie danego dnia (parametr scenariusza – popyt i ceny w etapie 6)">Gości dziś <input type="number" class="g-count" min="0" max="8000" step="100"></label>
          <button type="button" class="g-restart" title="Zacznij ten dzień od nowa (ten sam seed – ten sam przebieg)">Od nowa</button>
          <button type="button" class="g-report" title="Raport dnia: przejazdy, kolejki, oceny, wypadki, zatłoczone miejsca">Raport dnia</button>
        </div>
        <div class="g-plan muted"></div>
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
    this.planNote = this.root.querySelector('.g-plan')!;
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
      ? `<div class="build-section">Dziennik zdarzeń</div>${last.map((e) => `<div class="g-event">${icon('warn', 14)} ${hhmm(e.timeS)} – wypadek, ${e.place} (${e.cause})</div>`).join('')}${events.length > 4 ? `<div class="muted">…i ${events.length - 4} wcześniej (raport dnia)</div>` : ''}`
      : '';
  }

  setGuests(n: number): void {
    this.count.value = String(n);
  }

  setPlanNote(text: string): void {
    this.planNote.textContent = text;
  }

  setManualGuests(on: boolean): void {
    this.count.disabled = !on;
    this.count.title = on ? 'Ilu gości przyjedzie dziś (piaskownica – możesz zmienić)' : 'Liczba gości wynika z popytu: dzień tygodnia, ferie, śnieg, prognoza, reputacja, ceny, konkurencja, parking';
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
      return `<div class="g-warning">${icon('warn', 14)} Za mało śniegu: <b>${r.pisteName}</b>, ${segs}${r.segments.length > 3 ? '…' : ''} – ${f0(worst.baseCm)} cm bazy, potrzebne ${f0(worst.neededCm)} cm</div>`;
    });
    this.warnings.innerHTML = `<div class="build-section">Śnieg na otwartych trasach</div>${items.join('')}${rows.length > 6 ? `<div class="muted">…i ${rows.length - 6} innych tras</div>` : ''}<div class="muted">Zamknij trasę w profilu (klik na trasie) albo poczekaj na śnieg. Na zbyt cienkiej bazie: kamienie, więcej wypadków, uszkodzony sprzęt.</div>`;
  }
}

/** Imiona do karty gościa (tylko wyświetlanie – gość w symulacji ma numer). */
const NAMES_F = ['Marta', 'Anna', 'Kasia', 'Ola', 'Zosia', 'Magda', 'Ewa', 'Basia', 'Agnieszka', 'Julia', 'Natalia', 'Hania', 'Monika', 'Iza', 'Ula', 'Dorota'];
const NAMES_M = ['Tomek', 'Piotr', 'Kuba', 'Marek', 'Bartek', 'Paweł', 'Michał', 'Janek', 'Wojtek', 'Adam', 'Krzysiek', 'Staszek', 'Maciek', 'Łukasz', 'Rafał', 'Grzegorz'];
const AVATAR = ['#F2C14E', '#7CC4F2', '#5FD39A', '#FF9A4D', '#C9A7F5', '#FF8A8A'];

/** Imię, wiek i rodzaj z numeru gościa (zawsze to samo dla tego samego numeru). */
export function guestPersona(c: Pick<GuestCard, 'id' | 'child'>): { name: string; age: number; female: boolean; color: string } {
  let h = (c.id * 2654435761) >>> 0;
  h ^= h >>> 15;
  const female = (h & 1) === 0;
  const list = female ? NAMES_F : NAMES_M;
  const name = list[(h >>> 3) % list.length];
  const age = c.child ? 7 + ((h >>> 9) % 9) : 18 + ((h >>> 9) % 48);
  return { name, age, female, color: AVATAR[(h >>> 13) % AVATAR.length] };
}

const lata = (n: number) => (n === 1 ? 'rok' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'lata' : 'lat');

/** „Co myśli”: zdania z potrzeb i przebiegu dnia (+ dobrze, − źle). */
export function guestThoughts(c: GuestCard, female: boolean): { good: boolean; text: string }[] {
  const out: { good: boolean; text: string }[] = [];
  const g = (m: string, f: string) => (female ? f : m);
  if (c.queueMin > 10 && c.queueMin > c.skiMin * 0.5) out.push({ good: false, text: `W kolejkach ${g('stałem', 'stałam')} już ${f0(c.queueMin)} minut – prawie tyle, co jeżdżę.` });
  if (c.damage > 0) out.push({ good: false, text: 'Kamienie spod śniegu – narty do serwisu.' });
  if (c.cold > 0.6) out.push({ good: false, text: `${g('Zmarzłem', 'Zmarzłam')}, trzeba się ogrzać.` });
  if (c.hunger > 0.6) out.push({ good: false, text: `${g('Zgłodniałem', 'Zgłodniałam')} – czas na obiad.` });
  if (c.fatigue > 0.75) out.push({ good: false, text: 'Nogi już bolą, jeszcze jeden zjazd i koniec.' });
  if (c.runs >= 3 && c.queueMin <= c.skiMin * 0.25) out.push({ good: true, text: 'Prawie bez kolejek – dużo jazdy.' });
  if (c.verticalM >= 1500) out.push({ good: true, text: `Już ${f0(c.verticalM)} m w dół – świetny dzień.` });
  if (c.satisfaction >= 0.75 && out.every((x) => x.good)) out.push({ good: true, text: 'Warto było przyjechać.' });
  if (c.satisfaction < 0.4) out.push({ good: false, text: 'Chyba wybierzemy inny ośrodek następnym razem.' });
  if (!out.length) out.push({ good: true, text: c.runs ? 'Jest dobrze, jeździmy dalej.' : 'Dopiero zaczynamy dzień.' });
  return out.slice(0, 4);
}

/** Karta gościa (po kliknięciu postaci na mapie) – wygląd jak w makiecie ui-2-karty. */
export class GuestCardView {
  private readonly root: HTMLElement;
  onClose: (() => void) | null = null;
  onFollow: ((on: boolean) => void) | null = null;
  /** Wydatki gościa dziś (karnet wg pobytu) – liczone w main z cennika gry. */
  spendOf: ((c: GuestCard) => number | null) | null = null;
  private following = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('aside');
    this.root.className = 'u-panel u-guestcard hidden';
    this.root.setAttribute('aria-label', 'Karta gościa');
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.u-close')) {
        this.hide();
        this.onClose?.();
      } else if (t.closest('.u-follow')) {
        this.following = !this.following;
        this.onFollow?.(this.following);
        t.closest('.u-follow')!.classList.toggle('active', this.following);
        t.closest('.u-follow')!.textContent = this.following ? 'Kamera śledzi' : 'Śledź kamerą';
      }
    });
  }

  hide(): void {
    this.root.classList.add('hidden');
    if (this.following) {
      this.following = false;
      this.onFollow?.(false);
    }
  }

  show(c: GuestCard): void {
    this.root.classList.remove('hidden');
    const p = guestPersona(c);
    const who = `${c.typeName}${c.groupSize > 1 ? ` (${c.groupSize} os.)` : ''}, ${c.child ? 'dziecko, ' : ''}${c.snowboard ? 'snowboard, ' : ''}${c.skillName}`;
    const barRow = (label: string, v: number, color: string) => `<div class="u-need"><span>${label}</span><div class="u-bar thin"><div style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%;background:${color}"></div></div><b>${Math.round(Math.max(0, Math.min(1, v)) * 100)}%</b></div>`;
    const thoughts = guestThoughts(c, p.female)
      .map((t) => `<li><span class="u-sign ${t.good ? 'good' : 'bad'}" aria-label="${t.good ? 'dobrze' : 'źle'}">${t.good ? '+' : '−'}</span>${t.text}</li>`)
      .join('');
    const spend = this.spendOf?.(c) ?? null;
    this.root.innerHTML = `
      <div class="u-card-head"><div class="u-avatar" style="background:${p.color}">${p.name[0]}</div><div class="u-stack"><span class="u-card-title">${p.name}, ${p.age} ${lata(p.age)}</span><span class="u-sub">${who}</span></div><button type="button" class="u-icon-btn u-close" aria-label="Zamknij kartę">${icon('close', 18, 2)}</button></div>
      <div class="u-doing">${icon(c.doing.includes('wyciąg') || c.doing.includes('kolejk') ? 'lift' : c.doing.includes('przerw') || c.doing.includes('posił') ? 'food' : 'piste', 20)}<span>${c.doing}${c.plan ? ` ${c.plan}` : ''}</span></div>
      <div class="u-needs">
        ${barRow('Zadowolenie', c.satisfaction, '#5FD39A')}
        ${barRow('Energia', 1 - c.fatigue, '#7CC4F2')}
        ${barRow('Sytość', 1 - c.hunger, '#F5C542')}
        ${barRow('Ciepło', 1 - c.cold, '#7CC4F2')}
      </div>
      <div class="u-sec-title">Co myśli</div>
      <ul class="u-thoughts">${thoughts}</ul>
      <div class="u-guest-foot">
        <div class="u-stack"><span class="u-label">${p.female ? 'Wydała' : 'Wydał'} dziś</span><span class="u-num-s">${spend === null ? '–' : `${f0(spend)} zł`}</span></div>
        <div class="u-stack"><span class="u-label">Zjazdy</span><span class="u-num-s">${c.runs}</span></div>
        <div class="u-stack"><span class="u-label">Ocena</span><span class="u-num-s">${c.ratingNow} / 5</span></div>
        <button type="button" class="u-btn u-follow${this.following ? ' active' : ''}">${this.following ? 'Kamera śledzi' : 'Śledź kamerą'}</button>
      </div>
      <details class="u-more"><summary>Więcej o gościu</summary>
        <table class="u-table u-rows"><tbody>
          <tr><th>Wjazdy</th><td>${c.liftRides}</td></tr>
          <tr><th>Przejechane</th><td>${f1(c.distanceKm)} km, ${f0(c.verticalM)} m w dół</td></tr>
          <tr><th>Jazda / kolejki</th><td>${f0(c.skiMin)} / ${f0(c.queueMin)} min</td></tr>
          <tr><th>Cierpliwość w kolejce</th><td>ok. ${f0(c.patienceMin)} min</td></tr>
          <tr><th>Lubi</th><td>długie trasy ${f0(c.prefs.long * 100)} %, puch ${f0(c.prefs.powder * 100)} %, spokój ${f0(c.prefs.quiet * 100)} %</td></tr>
          <tr><th>Pobyt (plan)</th><td>${hhmm(c.arriveH * 3600)}–${hhmm(c.departH * 3600)}</td></tr>
          <tr><th>Numer w symulacji</th><td>${c.id + 1}</td></tr>
        </tbody></table>
      </details>`;
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
      .map((n, i) => `<div class="dr-rate"><span>${i + 1} / 5</span>${bar(r.counts.arrived ? n / r.counts.arrived : 0, 'gold')}<span>${f0(n)}</span></div>`)
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
        <div><b>${f1(r.meanRating)} / 5</b><span>średnia ocena</span></div>
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
