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
import type { GuestConditions, GuestCounts, GuestEvent } from '../sim/guests';
import { LIFT_STRIDE } from '../sim/guests';
import type { GuestClient } from '../worker/guestClient';
import type { GuestFrameMessage } from '../worker/guestProtocol';
import type { Camera } from './camera';
import { DayReportView, GuestCardView, GuestPanel } from './guestPanels';
import type { LiftRow, SnowWarningRow } from './guestPanels';
import { KIND_BOARD, KIND_SKI } from './movers';
import type { MoverLayer } from './movers';
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
  ski: TrackBuffer;
  screenLayer: Container;
  camera: Camera;
  panelParent: HTMLElement;
  cardParent: HTMLElement;
  initialGuests: number;
  /** Przejazdy dnia gotowe – do modelu śniegu. */
  onDayTraffic(date: CalendarDate, passes: Float32Array): void;
  onLoadOsm(): void;
  /** Gracz otworzył / zamknął ośrodek. */
  onResortOpen?(open: boolean): void;
}

export class GuestController {
  private readonly o: GuestControllerOptions;
  private net: GuestNet | null = null;
  private guests: number;
  private resortOpen = true;
  private day: CalendarDate | null = null;
  private frame: GuestFrameMessage | null = null;
  private inflight = false;
  private readonly panel: GuestPanel;
  private readonly card: GuestCardView;
  private readonly report: DayReportView;
  private selected = -1;
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
          this.guests = n;
          this.restart();
        },
        onRestart: () => this.restart(),
        onReport: () => void this.showReport(),
        onLoadOsm: () => o.onLoadOsm(),
        onResortOpen: (open) => {
          this.setResortOpen(open);
          o.onResortOpen?.(open);
        },
      },
      this.guests,
    );
    this.card = new GuestCardView(o.cardParent);
    this.card.onClose = () => (this.selected = -1);
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
      this.o.client.startDay(date, this.resortOpen ? this.guests : 0, timeS);
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
      this.stampTracks(f);
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
    if (f.done && f.counts && f.counts.arrived > 0 && this.trafficSent !== key) {
      this.trafficSent = key;
      void this.o.client.dayTraffic().then((r) => {
        if (r.date && r.passes) this.o.onDayTraffic(r.date, r.passes);
      });
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
    const g = this.gfx;
    g.clear();
    let li = 0;
    const iconS = this.o.params.accidents.iconHours * 3600;
    for (const e of this.events) {
      const age = renderTimeS - e.timeS;
      if (age < 0) continue;
      const s = camera.worldToScreen(e.xM, e.yM);
      const a = age < iconS ? 1 : 0.35;
      g.circle(s.xPx, s.yPx, 8).fill({ color: 0xffffff, alpha: a }).stroke({ width: 2, color: 0xd92b2b, alpha: a });
      g.rect(s.xPx - 1.5, s.yPx - 5, 3, 10).fill({ color: 0xd92b2b, alpha: a });
      g.rect(s.xPx - 5, s.yPx - 1.5, 10, 3).fill({ color: 0xd92b2b, alpha: a });
    }
    if (this.showWaits && this.net) {
      this.net.lifts.forEach((l, i) => {
        const row = this.liftRows[i];
        if (!row) return;
        const s = camera.worldToScreen(l.bottomX, l.bottomY);
        const w = row.waitMin;
        const color = row.closed ? 0x64748b : w < 5 ? 0x2f9e44 : w < 15 ? 0xf59f00 : w < 30 ? 0xe8590c : 0xd92b2b;
        g.roundRect(s.xPx - 30, s.yPx + 10, 60, 20, 10).fill({ color }).stroke({ width: 2, color: 0xffffff });
        let t = this.labelPool[li];
        if (!t) {
          t = new Text({ text: '', style: { fontFamily: 'Barlow Condensed', fontWeight: '700', fontSize: 14, fill: 0xffffff } });
          t.anchor.set(0.5);
          this.labelPool[li] = t;
          this.labels.addChild(t);
        }
        const text = row.closed ? 'stoi' : `${Math.round(w)} min · ${Math.round(row.queue)}`;
        if (t.text !== text) t.text = text;
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
        const s = camera.worldToScreen(p.xM, p.yM);
        g.circle(s.xPx, s.yPx, 11).stroke({ width: 2.5, color: 0xfacc15 });
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
