/**
 * Goście w widoku (etap 5): łączy wątek gości z mapą i panelami.
 *  – co klatkę prosi wątek o doliczenie dnia do godziny zegara gry (zegar czeka, gdy wątek nie
 *    nadąża), odbiera ramki z położeniami i rysuje postacie (MoverLayer) oraz ślady nart na śniegu,
 *  – panel „Goście”, karta gościa (kliknięcie), raport dnia, ikony wypadków, czasy oczekiwania przy
 *    stacjach (nakładka), natężenie ruchu (nakładka – dane z wątku),
 *  – na koniec dnia przekazuje przejazdy do modelu śniegu (ubijanie, zsuwanie, muldy).
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { CalendarDate } from '../sim';
import type { GuestParams } from '../sim/guestParams';
import type { GuestNet } from '../sim/guestNetwork';
import type { GuestCard, GuestConditions, GuestCounts, GuestDayReport, GuestEconomySummary, GuestEvent } from '../sim/guests';
import { LIFT_STRIDE } from '../sim/guests';
import type { GuestClient } from '../worker/guestClient';
import type { GuestFrameMessage } from '../worker/guestProtocol';
import type { Camera, ViewCamera } from './camera';
import { DayReportView, GuestCardView, GuestPanel } from './guestPanels';
import type { LiftRow, SnowWarningRow } from './guestPanels';
import { KIND_BOARD, KIND_SKI } from './movers';
import type { MoverLayer } from './movers';
import type { SummerFacts, SummerOutcome, SummerPlan } from '../sim/summer';
import type { SummerNet, SummerStats } from '../sim/summerGuests';

/** Etap 7b: dzień letni do wątku gości. */
export interface SummerDayPayload {
  plan: SummerPlan;
  net: SummerNet;
  sf: SummerFacts;
  summerJson: unknown;
  personsPerCar: number;
  seed: number;
  note: string;
  /** Zmiana sieci (nowy obiekt) – dzień od nowa. */
  netKey: string;
}
import type { TrackBuffer } from './terrainRenderer';

/** Ile czasu gry wątek może zostać w tyle, zanim zegar poczeka [s] (przy ×20 i wolnym ekranie jedna klatka to kilka minut gry). */
const MAX_LAG_S = 900;
/** Budżet obliczeń wątku na jedną ramkę [ms]. */
const ADVANCE_BUDGET_MS = 25;
/** Ślad nart: szerokość [m], siła odcisku, najdłuższy odcinek między ramkami [m]. */
const SKI_TRACK_WIDTH_M = 0.6;
const SKI_TRACK_STRENGTH = 0.12;
const SKI_TRACK_MAX_SEGMENT_M = 25;

const sameDate = (a: CalendarDate | null, b: CalendarDate | null) => !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day;

export interface GuestControllerOptions {
  client: GuestClient;
  params: GuestParams;
  movers: MoverLayer;
  /** Ślady nart: bufor 2 m (oddalenie) i warstwa detalu 1 m (etap 7d). */
  ski: Pick<TrackBuffer, 'stamp'>;
  screenLayer: Container;
  camera: ViewCamera;
  panelParent: HTMLElement;
  cardParent: HTMLElement;
  /** Etap 7c: raport dnia w nowym oknie (zamiast starego panelu). */
  onReportRequest?: () => void;
  /** Etap 7c: wydatki gościa (karta gościa). */
  spendOf?: (c: GuestCard) => number | null;
  initialGuests: number;
  /** Przejazdy dnia gotowe – do modelu śniegu. */
  onDayTraffic(date: CalendarDate, passes: Float32Array): void;
  onLoadOsm(): void;
  /** Gracz otworzył / zamknął ośrodek. */
  onResortOpen?(open: boolean): void;
  /** Koniec dnia z gośćmi: podsumowanie dla ekonomii (etap 6). */
  onDaySummary?(date: CalendarDate, summary: GuestEconomySummary): void;
  /** Etap 7b: wynik dnia letniego z wątku gości. */
  onSummerDay?(date: CalendarDate, outcome: SummerOutcome, stats: SummerStats | null): void;
  /** Czy gracz może sam wpisać liczbę gości (piaskownica); w karierze – z popytu. */
  manualGuests?(): boolean;
}

/** Plan dnia z ekonomii (etap 6): liczba gości z popytu, skład grup, godziny wyciągów. */
export interface GuestDayPlan {
  date: CalendarDate;
  guests: number;
  typeShares: number[];
  hours: { openH: number; closeH: number };
  /** Opis do panelu („sobota, ferie: śląskie – popyt 820, parking 700”). */
  note: string;
}

export class GuestController {
  private readonly o: GuestControllerOptions;
  private net: GuestNet | null = null;
  private guests: number;
  private resortOpen = true;
  private plan: GuestDayPlan | null = null;
  private summarySent = '';
  private day: CalendarDate | null = null;
  private frame: GuestFrameMessage | null = null;
  private inflight = false;
  private readonly panel: GuestPanel;
  private readonly card: GuestCardView;
  private readonly report: DayReportView;
  private selected = -1;
  /** Etap 7c: kamera śledzi zaznaczonego gościa. */
  private follow = false;
  private cardTimer = 0;
  private readonly lastPos = new Map<number, number>();
  private readonly lastX: number[] = [];
  private readonly lastY: number[] = [];
  private events: GuestEvent[] = [];
  private trafficSent = '';
  private reportShown = '';
  private readonly gfx = new Graphics();
  private readonly labels = new Container();
  private readonly labelPool: Text[] = [];
  /** Nakładka czasów oczekiwania przy stacjach. */
  showWaits = false;
  counts: GuestCounts | null = null;
  liftRows: LiftRow[] = [];

  constructor(o: GuestControllerOptions) {
    this.o = o;
    this.guests = o.initialGuests;
    this.panel = new GuestPanel(
      o.panelParent,
      {
        onGuestsChange: (n) => {
          if (o.manualGuests && !o.manualGuests()) {
            this.panel.setGuests(this.plan?.guests ?? this.guests);
            return;
          }
          this.guests = n;
          if (this.plan) this.plan = { ...this.plan, guests: n, note: `${this.plan.note} · ręcznie: ${n}` };
          this.restart();
        },
        onRestart: () => this.restart(),
        onReport: () => (o.onReportRequest ? o.onReportRequest() : void this.showReport()),
        onLoadOsm: () => o.onLoadOsm(),
        onResortOpen: (open) => {
          this.setResortOpen(open);
          o.onResortOpen?.(open);
        },
      },
      this.guests,
    );
    this.card = new GuestCardView(o.cardParent);
    this.card.onClose = () => {
      this.selected = -1;
      this.follow = false;
    };
    this.card.onFollow = (on) => (this.follow = on);
    if (o.spendOf) this.card.spendOf = o.spendOf;
    this.report = new DayReportView(o.cardParent);
    o.screenLayer.addChild(this.gfx, this.labels);
    o.client.onFrame = (f) => this.onFrame(f);
    this.updateHint();
  }

  get guestsPerDay(): number {
    return this.guests;
  }

  get isResortOpen(): boolean {
    return this.resortOpen;
  }

  /** Ośrodek zamknięty – dzień bez gości (zaczyna się od nowa). */
  setResortOpen(open: boolean): void {
    if (open === this.resortOpen) return;
    this.resortOpen = open;
    this.panel.setResortOpen(open);
    this.updateHint();
    this.restart();
  }

  /** Etap 7b: dzień letni – goście letni w wątku gości (null – dzień zimowy). */
  private summerDay: SummerDayPayload | null = null;
  private summerActive = false;

  setSummerDay(p: SummerDayPayload | null): void {
    const key = (x: SummerDayPayload | null) => (x ? `${x.plan.date.year}-${x.plan.date.month}-${x.plan.date.day}|${x.plan.guests}|${x.netKey}` : '');
    if (key(p) === key(this.summerDay)) return;
    const same = !!p && sameDate(p.plan.date, this.day);
    this.summerDay = p;
    if (p) this.panel.setPlanNote(p.note);
    if (same || (!p && this.summerActive)) this.restart();
  }

  /** Etap 7b: stan wyciągów teraz (karty obiektów, zima). */
  liveLifts(): Map<string, { queue: number; waitMin: number; utilization: number; rides: number; closed: boolean }> {
    const m = new Map<string, { queue: number; waitMin: number; utilization: number; rides: number; closed: boolean }>();
    if (!this.net || this.summerActive) return m;
    this.net.lifts.forEach((l, i) => {
      const r = this.liftRows[i];
      if (r) m.set(l.id, { queue: r.queue, waitMin: r.waitMin, utilization: r.utilization, rides: r.rides, closed: r.closed });
    });
    return m;
  }

  /** Etap 7b: statystyki bieżącego dnia letniego (co 15 min) – karty obiektów. */
  async liveSummerStats(): Promise<SummerStats | null> {
    if (!this.summerActive) return null;
    return (await this.o.client.summerEconomy()).stats;
  }

  get isSummerDay(): boolean {
    return this.summerActive;
  }

  /** Plan dnia z ekonomii – gdy inny niż bieżący, dzień liczy się od nowa. */
  setDayPlan(plan: GuestDayPlan | null): void {
    const key = (p: GuestDayPlan | null) => (p ? `${p.date.year}-${p.date.month}-${p.date.day}|${p.guests}|${p.hours.openH}|${p.hours.closeH}|${p.typeShares.join(',')}` : '');
    if (key(plan) === key(this.plan)) return;
    const sameDay = !!plan && !!this.plan && sameDate(plan.date, this.plan.date);
    this.plan = plan;
    if (plan) {
      this.guests = plan.guests;
      this.panel.setGuests(plan.guests);
    }
    this.panel.setPlanNote(plan?.note ?? '');
    if (sameDay || (plan && sameDate(plan.date, this.day))) this.restart();
  }

  /** Liczba gości wpisywana ręcznie (piaskownica) albo z popytu (kariera). */
  setManualGuests(on: boolean): void {
    this.panel.setManualGuests(on);
  }

  get dayPlan(): GuestDayPlan | null {
    return this.plan;
  }

  setSnowWarnings(rows: SnowWarningRow[]): void {
    this.panel.setSnowWarnings(rows);
  }

  setGuestsPerDay(n: number): void {
    this.guests = n;
    this.panel.setGuests(n);
    this.restart();
  }

  // ------------------------------------------------------------ dane wejściowe

  setNet(net: GuestNet): void {
    this.net = net;
    this.o.client.setNet(net);
    this.updateHint();
  }

  setConditions(c: GuestConditions): void {
    this.o.client.setConditions(c);
  }

  /** Śnieg dla gości: stan, grubość, muldy (0–255) i „za cienka baza” 0–1 (null – wystarcza). */
  setSnow(quality: Uint8Array, depthCm: Float32Array, moguls: Uint8Array | null, thin: Float32Array | null = null): void {
    const m = moguls ? Float32Array.from(moguls, (v) => v / 255) : null;
    this.o.client.setSnow(quality.slice(), depthCm.slice(), m, thin ? thin.slice() : null);
  }

  private updateHint(): void {
    const n = this.net;
    if (!this.resortOpen) this.panel.setHint('Ośrodek zamknięty – nie przyjeżdżają goście. Otwórz go (pole „Ośrodek otwarty”), gdy jest dość śniegu.', false);
    else if (!n || n.lifts.length === 0) this.panel.setHint('Goście przyjadą, gdy ośrodek będzie miał wyciąg i trasę. Zbuduj je albo wczytaj prawdziwy ośrodek Pilsko.', true);
    else if (n.edges.length === 0) this.panel.setHint('Brak tras połączonych z wyciągami – goście nie mają jak zjechać.', false);
    else this.panel.setHint('', false);
  }

  private restart(): void {
    this.day = null; // następne sync() zacznie dzień od nowa
    this.lastPos.clear();
    this.events = [];
    this.panel.setEvents([]);
  }

  // ------------------------------------------------------------ zegar

  /** Czy zegar gry ma poczekać (wątek gości nie nadąża). */
  holdClock(hour: number): boolean {
    if (!this.day || !this.frame || this.frame.catchingUp !== null) return this.day !== null;
    return hour * 3600 - this.frame.timeS > MAX_LAG_S;
  }

  /** Co klatkę: dzień i godzina zegara gry. */
  sync(date: CalendarDate, hour: number): void {
    const timeS = hour * 3600;
    if (!this.net) return;
    // Nowy dzień albo cofnięcie zegara – dzień od nowa do tej godziny.
    if (!sameDate(this.day, date) || (this.frame && sameDate(this.frame.date, date) && this.frame.catchingUp === null && timeS < this.frame.timeS - 120)) {
      this.day = date;
      this.frame = null;
      this.inflight = false;
      this.lastPos.clear();
      this.events = [];
      this.panel.setEvents([]);
      const sd = this.summerDay && sameDate(this.summerDay.plan.date, date) ? this.summerDay : null;
      this.o.movers.summer = !!sd;
      if (sd) {
        this.summerActive = true;
        this.o.client.setSummerDay({ net: sd.net, plan: sd.plan, sf: sd.sf, summerJson: sd.summerJson, personsPerCar: sd.personsPerCar, seed: sd.seed, timeS });
        return;
      }
      if (this.summerActive) {
        this.summerActive = false;
        this.o.client.setSummerDay(null);
      }
      const plan = this.plan && sameDate(this.plan.date, date) ? this.plan : null;
      const n = !this.resortOpen ? 0 : plan ? plan.guests : this.guests;
      this.o.client.startDay(date, n, timeS, plan?.hours, plan?.typeShares);
      return;
    }
    if (this.inflight) return;
    this.inflight = true;
    this.o.client.advance(timeS, ADVANCE_BUDGET_MS);
  }

  private onFrame(f: GuestFrameMessage): void {
    this.inflight = false;
    if (!sameDate(f.date, this.day)) return; // ramka starego dnia
    this.frame = f;
    if (f.catchingUp === null) {
      this.o.movers.setFrame(f.data, f.count, f.timeS);
      if (!this.summerActive) this.stampTracks(f);
    } else this.o.movers.setFrame(f.data, 0, f.timeS);
    if (f.counts) this.counts = f.counts;
    if (f.events.length) {
      this.events.push(...f.events);
      this.panel.setEvents(this.events);
    }
    this.liftRows = this.net
      ? this.net.lifts.map((l, i) => ({
          name: l.name,
          queue: f.lifts[i * LIFT_STRIDE] ?? 0,
          waitMin: f.lifts[i * LIFT_STRIDE + 1] ?? 0,
          utilization: f.lifts[i * LIFT_STRIDE + 2] ?? 0,
          closed: (f.lifts[i * LIFT_STRIDE + 3] ?? 0) > 0.5,
          onLine: f.lifts[i * LIFT_STRIDE + 4] ?? 0,
          rides: f.lifts[i * LIFT_STRIDE + 5] ?? 0,
        }))
      : [];
    this.panel.update(this.counts, this.liftRows, f.catchingUp);
    // Koniec dnia: przejazdy do modelu śniegu, raport dnia.
    const key = f.date ? `${f.date.year}-${f.date.month}-${f.date.day}` : '';
    // Etap 7b: koniec dnia letniego – wynik i statystyki do ekonomii i kart obiektów.
    if (this.summerActive && f.done && this.summarySent !== key) {
      this.summarySent = key;
      void this.o.client.summerEconomy().then((r) => {
        if (r.date && r.outcome) this.o.onSummerDay?.(r.date, r.outcome, r.stats);
      });
    }
    if (f.done && f.counts && f.counts.arrived > 0 && this.trafficSent !== key) {
      this.trafficSent = key;
      void this.o.client.dayTraffic().then((r) => {
        if (r.date && r.passes) this.o.onDayTraffic(r.date, r.passes);
      });
      if (this.o.onDaySummary && this.summarySent !== key) {
        this.summarySent = key;
        void this.o.client.economy().then((r) => {
          if (r.date && r.summary) this.o.onDaySummary!(r.date, r.summary);
        });
      }
      if (this.reportShown !== key) {
        this.reportShown = key;
        void this.showReport();
      }
    }
  }

  /** Ślady nart na śniegu (nakładka śladów z etapu 4b) – odcinki od poprzedniej ramki. */
  private stampTracks(f: GuestFrameMessage): void {
    const d = f.data;
    const seen = new Set<number>();
    for (let k = 0; k < f.count; k++) {
      const o = k * 9;
      const kind = d[o + 6];
      if (kind !== KIND_SKI && kind !== KIND_BOARD) continue;
      const id = d[o];
      const x = d[o + 1];
      const y = d[o + 2];
      seen.add(id);
      const slot = this.lastPos.get(id);
      if (slot !== undefined) {
        const px = this.lastX[slot];
        const py = this.lastY[slot];
        if (Math.hypot(x - px, y - py) < SKI_TRACK_MAX_SEGMENT_M) this.o.ski.stamp(px, py, x, y, SKI_TRACK_WIDTH_M, SKI_TRACK_STRENGTH);
        this.lastX[slot] = x;
        this.lastY[slot] = y;
      } else {
        const s = this.lastX.length;
        this.lastPos.set(id, s);
        this.lastX.push(x);
        this.lastY.push(y);
      }
    }
    if (this.lastPos.size > 4 * Math.max(1, f.count)) {
      // Porządek: zapominamy tych, których już nie ma na trasach.
      for (const id of [...this.lastPos.keys()]) if (!seen.has(id)) this.lastPos.delete(id);
    }
  }

  // ------------------------------------------------------------ mapa i panele

  /** Co klatkę: postacie, ikony wypadków, czasy oczekiwania, zaznaczony gość. */
  update(camera: Camera, night: number, renderTimeS: number, dtRealS: number): void {
    this.o.movers.update(camera, night, renderTimeS);
    // Ikony, kolejki i zaznaczenie – przez przelicznik narzędzi (w widoku 3D rzut na teren).
    const view = this.o.camera;
    const g = this.gfx;
    g.clear();
    let li = 0;
    const iconS = this.o.params.accidents.iconHours * 3600;
    for (const e of this.events) {
      const age = renderTimeS - e.timeS;
      if (age < 0) continue;
      const s = view.worldToScreen(e.xM, e.yM);
      const a = age < iconS ? 1 : 0.35;
      g.circle(s.xPx, s.yPx, 8).fill({ color: 0xffffff, alpha: a }).stroke({ width: 2, color: 0xd92b2b, alpha: a });
      g.rect(s.xPx - 1.5, s.yPx - 5, 3, 10).fill({ color: 0xd92b2b, alpha: a });
      g.rect(s.xPx - 5, s.yPx - 1.5, 10, 3).fill({ color: 0xd92b2b, alpha: a });
    }
    if (this.showWaits && this.net) {
      this.net.lifts.forEach((l, i) => {
        const row = this.liftRows[i];
        if (!row) return;
        const s = view.worldToScreen(l.bottomX, l.bottomY);
        const w = row.waitMin;
        // Etap 7c: kolory stanów z zasad wyglądu (dobrze / uwaga / źle), tekst ciemny na jasnym tle.
        const color = row.closed ? 0x64748b : w < 5 ? 0x5fd39a : w < 15 ? 0xf5c542 : 0xff6b6b;
        g.roundRect(s.xPx - 30, s.yPx + 10, 60, 20, 10).fill({ color }).stroke({ width: 2, color: 0xffffff });
        let t = this.labelPool[li];
        if (!t) {
          t = new Text({ text: '', style: { fontFamily: 'Barlow Condensed', fontWeight: '700', fontSize: 14, fill: 0x1b2633 } });
          t.anchor.set(0.5);
          this.labelPool[li] = t;
          this.labels.addChild(t);
        }
        const text = row.closed ? 'stoi' : `${Math.round(w)} min · ${Math.round(row.queue)}`;
        if (t.text !== text) t.text = text;
        t.style.fill = row.closed ? 0xffffff : 0x1b2633;
        t.position.set(Math.round(s.xPx), Math.round(s.yPx + 20));
        t.visible = true;
        li++;
      });
    }
    for (let i = li; i < this.labelPool.length; i++) this.labelPool[i].visible = false;
    // Zaznaczony gość: obwódka + odświeżana karta.
    if (this.selected >= 0) {
      const p = this.findById(this.selected, renderTimeS);
      if (p) {
        if (this.follow) view.centerOn(p.xM, p.yM);
        const s = view.worldToScreen(p.xM, p.yM);
        g.circle(s.xPx, s.yPx, 11).stroke({ width: 2.5, color: 0xff7a1a });
      }
      this.cardTimer -= dtRealS;
      if (this.cardTimer <= 0) {
        this.cardTimer = 0.5;
        void this.refreshCard();
      }
    }
  }

  private findById(id: number, renderTimeS: number): { xM: number; yM: number } | null {
    const m = this.o.movers;
    for (let k = 0; k < m.personCount; k++) {
      const p = m.positionOf(k, renderTimeS);
      if (p.id === id) return p;
    }
    return null;
  }

  /** Kliknięcie na mapie: najbliższa postać w promieniu 14 px → karta gościa. */
  handleClick(xPx: number, yPx: number, renderTimeS: number): boolean {
    const m = this.o.movers;
    const cam = this.o.camera;
    let best = -1;
    let bestD = 9; // [px] – mniej niż promień wyboru wyciągu/trasy, by dało się je kliknąć między postaciami
    for (let k = 0; k < m.personCount; k++) {
      const p = m.positionOf(k, renderTimeS);
      const s = cam.worldToScreen(p.xM, p.yM);
      const d = Math.hypot(s.xPx - xPx, s.yPx - yPx);
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    if (best < 0) return false;
    this.selected = best;
    this.cardTimer = 0;
    return true;
  }

  private async refreshCard(): Promise<void> {
    const c = await this.o.client.card(this.selected);
    if (c && this.selected === c.id) this.card.show(c);
  }

  /** Etap 7d: wypadki z ostatnich godzin (ratownik i skuter przy miejscu). */
  recentAccidents(renderTimeS: number): { xM: number; yM: number }[] {
    const iconS = this.o.params.accidents.iconHours * 3600;
    return this.events.filter((e) => renderTimeS - e.timeS >= 0 && renderTimeS - e.timeS < iconS).map((e) => ({ xM: e.xM, yM: e.yM }));
  }

  /** Etap 7c: raport dnia z wątku gości (okno raportu). */
  dayReport(): Promise<GuestDayReport | null> {
    return this.o.client.report();
  }

  async showReport(): Promise<void> {
    const r = await this.o.client.report();
    if (r) this.report.show(r);
  }

  /** Natężenie ruchu teraz [przejazdy/h] – do nakładki. */
  traffic(): Promise<Float32Array | null> {
    return this.o.client.traffic();
  }

  get gameTimeS(): number | null {
    return this.frame ? this.frame.timeS : null;
  }
}
