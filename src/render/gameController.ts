/**
 * Gra (etap 6) w widoku: stan ekonomii, przejście dnia (zamknięcie dnia – symulacja gości albo model
 * zgrubny dla dni przewiniętych), plan dnia dla gości (popyt), budowy w czasie i opłaty, otwarcie
 * sezonu, cennik, kredyt, raport sezonu, zapis do pliku i automatyczny zapis w przeglądarce.
 * Całe liczenie – w src/sim/economy.ts (to samo co w trybie bez grafiki).
 */
import type { CalendarDate } from '../sim';
import { PHASE_NAMES, yearPhase } from '../sim/calendar';
import type { CompetitionInput, CompetitorSeason } from '../sim/competition';
import { competitorSeason, competitorsOn } from '../sim/competition';
import type { DayContext, DayOutcome, GameMode, GameState, ResortFacts } from '../sim/economy';
import {
  agentOutcome,
  closeDay,
  constructionChargePreview,
  debtOf,
  fmtPln,
  loanLimit,
  markAllBuilt,
  newGameState,
  objectCosts,
  operationalLayout,
  planDay,
  quickDayOutcome,
  reconcileConstruction,
  repayLoan,
  reputationOf,
  resortFacts,
  resortSnow,
  seasonReport,
  setHours,
  setPrices,
  setSeasonOpen,
  skiSeasonYear,
  takeLoan,
} from '../sim/economy';
import type { EconomyParams } from '../sim/economyParams';
import type { DayOpsResult, Infra, OpsSnow } from '../sim/operations';
import { acquireGroomer, blockedPistes, infraFacts, previewDayOperations, runDayOperations } from '../sim/operations';
import type { SnowOps } from '../sim/snowOps';
import { encodeOps } from '../sim/gameSave';
import { parseIsoDate } from '../sim/time';
import type { GameSave } from '../sim/gameSave';
import { encodeTraffic, makeSave, parseSave } from '../sim/gameSave';
import type { GuestNet } from '../sim/guestNetwork';
import type { GuestParams } from '../sim/guestParams';
import type { GuestEconomySummary } from '../sim/guests';
import type { LiftParams } from '../sim/lifts';
import type { ResortAnalysis, ResortLayout } from '../sim/resort';
import { emptyLayout } from '../sim/resort';
import type { RidingParams } from '../sim/snowRiding';
import type { TerrainGrid } from '../sim/terrainGrid';
import { addDays, daysBetween, formatIsoDate } from '../sim/time';
import type { WeatherBook } from '../sim/weatherBook';
import type { BuildController } from './buildController';
import { FinancePanel, PricesDialog, SeasonReportView, StartScreen } from './gamePanels';
import type { GuestController } from './guestController';

export interface GameSnow {
  quality: Uint8Array;
  sweMm: Float32Array;
  /** Etap 7: do naśnieżania i ratraków. */
  depthCm?: Float32Array;
  pileMm?: Float32Array;
  techMm?: Float32Array;
  liquidMm?: Float32Array;
}

export interface GameControllerOptions {
  ep: EconomyParams;
  gp: GuestParams;
  lp: LiftParams;
  riding: RidingParams;
  grid: TerrainGrid;
  book: WeatherBook;
  competition: Omit<CompetitionInput, 'book' | 'ep'>;
  build: BuildController;
  guests: GuestController;
  mapName: string;
  seed: number;
  /** Data startowa piaskownicy (ustawienia widoku). */
  sandboxDate: CalendarDate;
  panelParent: HTMLElement;
  modalParent: HTMLElement;
  /** Śnieg na koniec dnia (wątek obliczeń); null latem. */
  snowOn(date: CalendarDate): Promise<GameSnow | null>;
  /** Sieć gości dla układu (bez obiektów w budowie). */
  buildNet(layout: ResortLayout, analysis: ResortAnalysis): GuestNet;
  /** Ustawienie zegara (po wczytaniu, nowej grze, odmowie cofania czasu). */
  setDateTime(date: CalendarDate, hour: number): void;
  /** Przejazdy dnia z zapisu → model śniegu. */
  setTraffic(date: CalendarDate, passes: Float32Array): void;
  /** Etap 7: naśnieżanie i ratrakowanie dnia → model śniegu. */
  setOperations?(date: CalendarDate, ops: SnowOps): void;
  /** Etap 7: po przeliczeniu dnia lub podglądu – panele i mapa (armatki, ratraki). */
  onOps?(): void;
  toast(text: string): void;
  /** Ekonomia skończyła przeliczać dni – mapa może pobrać śnieg. */
  onCaughtUp?(): void;
}

const AUTOSAVE_DB = 'ski-sim-gra';
const AUTOSAVE_STORE = 'zapisy';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUTOSAVE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(AUTOSAVE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<unknown> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(AUTOSAVE_STORE).objectStore(AUTOSAVE_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, 'readwrite');
    tx.objectStore(AUTOSAVE_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const sameDate = (a: CalendarDate, b: CalendarDate) => a.year === b.year && a.month === b.month && a.day === b.day;

export class GameController {
  state: GameState | null = null;
  private layout: ResortLayout = emptyLayout();
  private analysis: ResortAnalysis | null = null;
  private facts: ResortFacts | null = null;
  private comp: CompetitorSeason | null = null;
  private readonly summaries = new Map<string, GuestEconomySummary>();
  /** Przejazdy gości w bieżącym sezonie (zakodowane – do zapisu gry). */
  private readonly traffic = new Map<string, string>();
  private target: CalendarDate | null = null;
  private running = false;
  private catching: number | null = null;
  private planNote = '';
  private readonly finance: FinancePanel;
  private readonly prices: PricesDialog;
  private readonly report: SeasonReportView;
  private readonly start: StartScreen;
  private lastPanelMs = 0;
  /** Etap 7: trasy zablokowane przez pryzmy (śnieg techniczny nierozepchnięty). */
  private blocked = new Set<string>();
  /** Etap 7: operacje dnia (zakodowane – do zapisu gry). */
  private readonly opsSaved = new Map<string, ReturnType<typeof encodeOps>>();
  /** Etap 7: podgląd bieżącej doby (armatki dziś, plan nadchodzącej nocy). */
  preview: DayOpsResult | null = null;
  /** Ostatnio policzony śnieg bieżącego dnia (do podglądu). */
  private todaySnow: { date: CalendarDate; snow: GameSnow | null } | null = null;

  constructor(private readonly o: GameControllerOptions) {
    this.finance = new FinancePanel(o.panelParent, {
      onPrices: () => this.state && this.prices.show(this.state.prices, this.state.hours, o.ep, this.marketPrice()),
      onReport: () => this.showReport(),
      onSave: () => this.saveFile(),
      onLoad: (f) => void this.loadFile(f),
      onNewGame: () => void this.showStart(),
      onLoan: (amount, years) => this.loan(amount, years),
      onRepay: (id) => this.repay(id),
    });
    this.finance.setVisible(false);
    this.prices = new PricesDialog(o.modalParent, (p, h) => {
      if (!this.state) return;
      setPrices(this.state, p, o.ep);
      setHours(this.state, h, o.ep);
      o.toast('Cennik zapisany – obowiązuje od jutra.');
      this.refreshPanel(true);
    });
    this.report = new SeasonReportView(o.modalParent);
    this.start = new StartScreen(o.modalParent, {
      onCareer: () => this.newGame('career'),
      onSandbox: () => this.newGame('sandbox'),
      onContinue: () => void this.continueAutosave(),
      onLoad: (f) => void this.loadFile(f),
    });
  }

  get mode(): GameMode | null {
    return this.state?.mode ?? null;
  }

  private marketPrice(): number {
    const l = this.o.ep.competitors.list;
    return l.reduce((a, c) => a + c.dayPln, 0) / l.length;
  }

  // ------------------------------------------------------------ start, zapis

  async showStart(): Promise<void> {
    let label = '';
    let has = false;
    try {
      const s = (await idbGet(`gra:${this.o.mapName}`)) as GameSave | undefined;
      if (s?.state) {
        has = true;
        label = `${s.state.mode === 'career' ? 'Kariera' : 'Piaskownica'}, ${formatIsoDate(s.state.date).split('-').reverse().join('.')}, saldo ${fmtPln(s.state.balancePln)}`;
      }
    } catch {
      /* brak pamięci przeglądarki – tylko nowa gra */
    }
    this.start.show({ hasAutosave: has, autosaveLabel: label }, this.o.ep);
  }

  newGame(mode: GameMode): void {
    const o = this.o;
    const date = mode === 'career' ? parseIsoDate(o.ep.career.startDate) : o.sandboxDate;
    const state = newGameState({ mode, seed: o.seed, date, ep: o.ep });
    this.summaries.clear();
    this.traffic.clear();
    this.opsSaved.clear();
    this.preview = null;
    if (mode === 'career') {
      state.hour = 8;
      this.state = state;
      o.build.replaceLayout(emptyLayout(), 'Kariera: pusta góra. Zacznij od wyciągu, trasy i parkingu (pasek na dole).');
    } else {
      state.hour = 10;
      state.seasonOpen = true;
      this.state = state;
      const cur = o.build.current;
      markAllBuilt(state, objectCosts(cur.layout, cur.analysis, o.ep));
      o.build.replaceLayout(cur.layout, 'Piaskownica: budowa od razu i bez limitu pieniędzy.');
    }
    this.afterStateLoaded();
    o.toast(mode === 'career' ? `Kariera: ${fmtPln(state.balancePln)} na koncie, lato – czas budowy.` : 'Piaskownica: bez limitu pieniędzy.');
  }

  private afterStateLoaded(): void {
    const s = this.state!;
    this.finance.setVisible(true);
    this.o.guests.setManualGuests(s.mode === 'sandbox');
    this.o.guests.setResortOpen(s.seasonOpen);
    this.o.setDateTime(s.date, s.hour);
    this.target = { ...s.date };
    this.onLayoutChange(this.o.build.current.layout, this.o.build.current.analysis);
    void this.planToday();
    this.refreshPanel(true);
  }

  private save(): GameSave {
    const traffic = new Map<string, Float32Array>();
    const out = makeSave(this.state!, this.layout, traffic, this.o.mapName, new Date().toISOString());
    for (const [k, v] of this.traffic) out.traffic[k] = v;
    out.ops = {};
    for (const [k, v] of this.opsSaved) out.ops[k] = v;
    return out;
  }

  saveFile(): void {
    if (!this.state) return;
    const blob = new Blob([JSON.stringify(this.save())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pilsko-${this.state.mode === 'career' ? 'kariera' : 'piaskownica'}-${formatIsoDate(this.state.date)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  private async autosave(): Promise<void> {
    if (!this.state) return;
    try {
      await idbPut(`gra:${this.o.mapName}`, JSON.parse(JSON.stringify(this.save())));
    } catch (e) {
      console.warn('Autozapis nieudany', e);
    }
  }

  private async continueAutosave(): Promise<void> {
    try {
      const raw = await idbGet(`gra:${this.o.mapName}`);
      this.applySave(raw);
    } catch (e) {
      this.o.toast(`Nie udało się wczytać autozapisu: ${e instanceof Error ? e.message : String(e)}`);
      void this.showStart();
    }
  }

  private async loadFile(f: File): Promise<void> {
    try {
      this.applySave(JSON.parse(await f.text()));
      this.o.toast(`Wczytano grę: ${formatIsoDate(this.state!.date).split('-').reverse().join('.')}.`);
    } catch (e) {
      this.o.toast(`Nie udało się wczytać gry: ${e instanceof Error ? e.message : String(e)}`);
      if (!this.state) void this.showStart();
    }
  }

  private applySave(raw: unknown): void {
    const s = parseSave(raw);
    this.summaries.clear();
    this.traffic.clear();
    this.opsSaved.clear();
    for (const [k, v] of s.ops) {
      this.o.setOperations?.(parseIsoDate(k), v);
      this.opsSaved.set(k, encodeOps(v));
    }
    // Przejazdy z zapisu → model śniegu (zanim zapytamy o śnieg).
    for (const [k, v] of s.traffic) {
      this.o.setTraffic(parseIsoDate(k), v);
      this.traffic.set(k, encodeTraffic(v));
    }
    this.state = s.state;
    this.o.build.replaceLayout(s.layout, 'Wczytano zapis gry.');
    this.afterStateLoaded();
  }

  // ------------------------------------------------------------ budowa

  /** Przed zatwierdzeniem zmiany układu: czy nas stać (kariera). */
  beforeCommit(next: ResortLayout, analysis: ResortAnalysis): string | null {
    const s = this.state;
    if (!s || s.mode !== 'career') return null;
    if (s.bankrupt) return 'Ośrodek zbankrutował – nie można budować.';
    const charge = constructionChargePreview(s, objectCosts(next, analysis, this.o.ep), this.o.ep);
    if (charge > 0 && charge > s.balancePln) return `Brak pieniędzy: ta zmiana kosztuje ${fmtPln(charge)}, na koncie ${fmtPln(s.balancePln)}. Weź kredyt (panel „Finanse”).`;
    return null;
  }

  /** Po zmianie układu: opłaty i budowy, sieć gości bez obiektów w budowie. */
  onLayoutChange(layout: ResortLayout, analysis: ResortAnalysis): void {
    this.layout = layout;
    this.analysis = analysis;
    const s = this.state;
    if (!s) {
      this.o.guests.setNet(this.o.buildNet(layout, analysis));
      return;
    }
    const r = reconcileConstruction(s, objectCosts(layout, analysis, this.o.ep), this.o.ep);
    if (r.messages.length) this.o.toast(r.messages.join(' · '));
    this.refreshNet();
    // Nowy układ – plan dnia (goście, trasy zablokowane pryzmami) i podgląd naśnieżania od nowa.
    if (!this.running) void this.planToday();
    this.refreshPanel(true);
  }

  private refreshNet(): void {
    const s = this.state;
    if (!s || !this.analysis) return;
    const op = operationalLayout(this.layout, s, this.blocked);
    const net = this.o.buildNet(op, this.analysis);
    this.o.guests.setNet(net);
    this.facts = resortFacts(this.layout, this.analysis, net, s, this.o.lp, this.o.ep, this.blocked);
    const prog = new Map<string, number>();
    for (const [id, c] of Object.entries(s.construction)) prog.set(id, Math.max(0, Math.min(1, 1 - c.leftDays / Math.max(1, c.totalDays))));
    this.o.build.setConstruction(prog);
  }

  // ------------------------------------------------------------ decyzje

  setSeasonOpen(open: boolean): void {
    const s = this.state;
    if (!s) return;
    const err = setSeasonOpen(s, open, this.o.ep);
    if (err) {
      this.o.toast(err);
      this.o.guests.setResortOpen(s.seasonOpen);
      return;
    }
    this.o.build.setResortOpen(open);
    this.o.guests.setResortOpen(open);
    void this.planToday();
    this.refreshPanel(true);
  }

  private loan(amount: number, years: number): void {
    const s = this.state;
    if (!s || !this.facts) return;
    const err = takeLoan(s, amount, years, this.facts, this.o.ep);
    this.o.toast(err ?? `Kredyt ${fmtPln(amount)} wypłacony.`);
    this.refreshPanel(true);
  }

  private repay(id: number): void {
    const s = this.state;
    if (!s) return;
    const loan = s.loans.find((l) => l.id === id);
    const err = repayLoan(s, id, loan?.remainingPln ?? 0);
    this.o.toast(err ?? 'Kredyt spłacony (całość lub tyle, ile było na koncie).');
    this.refreshPanel(true);
  }

  showReport(): void {
    const s = this.state;
    if (!s) return;
    const r = seasonReport(s, this.o.ep);
    this.report.show(r, this.o.ep, false, { kmOpen: this.facts?.kmOpen ?? 0, dayPln: s.prices.dayPln });
  }

  // ------------------------------------------------------------ czas

  /** Dane z gości: koniec dnia (podsumowanie) i przejazdy. */
  onDaySummary(date: CalendarDate, summary: GuestEconomySummary): void {
    this.summaries.set(formatIsoDate(date), summary);
  }

  onDayTraffic(date: CalendarDate, passes: Float32Array): void {
    this.traffic.set(formatIsoDate(date), encodeTraffic(passes));
  }

  /**
   * Zegar przeszedł na datę `date`. Dni od stanu gry do `date` są zamykane po kolei (z gośćmi, jeśli
   * dzień był liczony, inaczej modelem zgrubnym). W karierze czas nie cofa się.
   */
  onDateChange(date: CalendarDate, hour: number): void {
    const s = this.state;
    if (!s) return;
    const diff = daysBetween(s.date, date);
    if (diff < 0) {
      if (s.mode === 'career') {
        this.o.toast('W karierze nie można cofać czasu.');
        this.o.setDateTime(s.date, hour);
        return;
      }
      // Piaskownica: skok wstecz bez przeliczania ekonomii.
      s.date = { ...date };
      this.target = { ...date };
      void this.planToday();
      return;
    }
    s.hour = hour;
    if (diff === 0) return;
    this.target = { ...date };
    if (!this.running) void this.catchUp();
  }

  /** Czy zegar ma poczekać (ekonomia jeszcze zamyka dni). */
  get busy(): boolean {
    return this.running;
  }

  private async catchUp(): Promise<void> {
    this.running = true;
    try {
      while (this.state && this.target && daysBetween(this.state.date, this.target) > 0) {
        this.catching = daysBetween(this.state.date, this.target);
        this.refreshPanel(false);
        await this.closeOneDay();
      }
      this.catching = null;
      await this.planToday();
      await this.autosave();
    } catch (e) {
      console.error(e);
      this.o.toast(`Błąd ekonomii: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
      this.catching = null;
      this.refreshPanel(true);
      this.o.onCaughtUp?.();
    }
  }

  private competitors(date: CalendarDate) {
    const y = skiSeasonYear(date);
    if (!this.comp || this.comp.startYear !== y) this.comp = competitorSeason(y, { ...this.o.competition, book: this.o.book, ep: this.o.ep });
    return competitorsOn(this.comp, date);
  }

  private readonly cellAt = (x: number, y: number): number => {
    const g = this.o.grid;
    const c = g.cellAt(x, y);
    return c ? g.index(c.i, c.j) : -1;
  };

  /** Śnieg na koniec dnia i (etap 7) trasy zablokowane pryzmami → sieć i fakty. */
  private async snowAndBlocked(date: CalendarDate): Promise<GameSnow | null> {
    const snow = date.month >= 5 && date.month <= 9 ? null : await this.snowSerial(date);
    this.todaySnow = { date: { ...date }, snow };
    const s = this.state;
    if (s && this.analysis && this.o.ep.snowmaking) {
      const b = blockedPistes(s, this.analysis, snow?.pileMm ? { pileMm: snow.pileMm } : null, this.cellAt, this.o.ep.snowmaking);
      const changed = b.size !== this.blocked.size || [...b].some((x) => !this.blocked.has(x));
      this.blocked = b;
      if (changed || !this.facts) this.refreshNet();
    }
    return snow;
  }

  private async context(date: CalendarDate, snowIn?: GameSnow | null): Promise<DayContext> {
    const snow = snowIn !== undefined ? snowIn : await this.snowAndBlocked(date);
    if (!this.facts) this.refreshNet();
    const cellAt = this.cellAt;
    const facts = this.facts!;
    return {
      date,
      facts,
      snow: resortSnow(this.analysis!, facts, snow, cellAt, this.o.riding, this.o.gp),
      weather: this.o.book.day(date),
      forecast: this.o.book.forecastFor(date),
      competitors: this.competitors(date),
    };
  }

  /** Pytania o śnieg po kolei (równoległe przerywałyby sobie liczenie w wątku). */
  private snowChain: Promise<unknown> = Promise.resolve();
  private snowSerial(date: CalendarDate): Promise<GameSnow | null> {
    const p = this.snowChain.then(() => this.o.snowOn(date));
    this.snowChain = p.catch(() => undefined);
    return p;
  }

  private async closeOneDay(): Promise<void> {
    const s = this.state!;
    const date = { ...s.date };
    const snow = await this.snowAndBlocked(date);
    const ctx = await this.context(date, snow);
    const plan = planDay(s, ctx, this.o.ep);
    const guestPlan = this.o.guests.dayPlan;
    if (guestPlan && sameDate(guestPlan.date, date)) plan.guests = guestPlan.guests; // ręczna liczba gości (piaskownica)
    const sum = this.summaries.get(formatIsoDate(date));
    const outcome: DayOutcome = sum && plan.open ? agentOutcome(sum, ctx.facts) : quickDayOutcome(s, plan, ctx, this.o.ep, this.o.gp);
    const ids = [...this.layout.lifts, ...this.layout.pistes, ...this.layout.bases, ...(this.layout.buildings ?? [])];
    // Etap 7: doba naśnieżania i noc ratraków.
    let extra = null;
    const opsSnow = this.opsSnow(snow);
    if (this.o.ep.snowmaking && this.analysis) {
      const res = runDayOperations({ ...this.opsInput(date, ctx.facts, opsSnow) });
      extra = res.extra;
      if (res.ops.addSweMm || res.ops.groomGroup) {
        this.o.setOperations?.(date, res.ops);
        this.opsSaved.set(formatIsoDate(date), encodeOps(res.ops));
      }
    }
    const r = closeDay(s, ctx, plan, outcome, this.o.ep, { ids: ids.map((x) => x.id), names: ids.map((x) => x.name) }, extra);
    this.summaries.delete(formatIsoDate(date));
    if (r.finishedConstruction.length) {
      this.o.toast(`Gotowe: ${r.finishedConstruction.map((id) => ids.find((x) => x.id === id)?.name ?? id).join(', ')}`);
      this.refreshNet();
    } else this.refreshNet();
    if (r.seasonReport) {
      this.traffic.clear();
      this.opsSaved.clear();
      this.o.guests.setResortOpen(false);
      this.report.show(r.seasonReport, this.o.ep, true, { kmOpen: this.facts?.kmOpen ?? 0, dayPln: s.prices.dayPln });
    }
    if (s.bankrupt) this.o.toast('Bankructwo – koniec kariery.');
  }

  private opsSnow(snow: GameSnow | null): OpsSnow | null {
    if (!snow || !snow.depthCm || !snow.pileMm || !snow.techMm || !snow.liquidMm) return null;
    return { sweMm: snow.sweMm, depthCm: snow.depthCm, pileMm: snow.pileMm, techMm: snow.techMm, liquidMm: snow.liquidMm };
  }

  private opsInput(date: CalendarDate, facts: ResortFacts, snow: OpsSnow | null) {
    return {
      state: this.state!,
      layout: this.layout,
      analysis: this.analysis!,
      facts,
      grid: this.o.grid,
      cellAt: this.cellAt,
      snow,
      book: this.o.book,
      ep: this.o.ep,
      riding: this.o.riding,
      date,
    };
  }

  /** Etap 7: infrastruktura naśnieżania (do paneli). */
  infra(): Infra | null {
    const sp = this.o.ep.snowmaking;
    if (!sp || !this.state || !this.analysis) return null;
    return infraFacts(this.layout, this.analysis, this.state, sp, this.o.grid);
  }

  /** Etap 7: przelicz podgląd doby (po zmianie planu, armatek, floty). */
  refreshPreview(): void {
    const s = this.state;
    if (!s || !this.o.ep.snowmaking || !this.analysis || !this.facts || this.running) return;
    const t = this.todaySnow;
    const snow = t && sameDate(t.date, s.date) ? t.snow : null;
    try {
      this.preview = previewDayOperations(this.opsInput({ ...s.date }, this.facts, this.opsSnow(snow)));
    } catch (e) {
      console.warn('Podgląd naśnieżania nieudany', e);
      this.preview = null;
    }
    this.o.onOps?.();
  }

  /** Etap 7: ratrak – zakup lub leasing. */
  acquireGroomer(typeId: string, leased: boolean): void {
    const s = this.state;
    const sp = this.o.ep.snowmaking;
    if (!s || !sp) return;
    const err = acquireGroomer(s, typeId, leased, this.infra()?.garageSlots ?? 0, sp);
    this.o.toast(err ?? (leased ? 'Ratrak w leasingu – rata co miesiąc.' : 'Ratrak kupiony.'));
    this.refreshPreview();
    this.refreshPanel(true);
  }

  /** Etap 7: ratrakowanie w dzień – trasa zamknięta dla gości do końca dnia. */
  setDayGroom(pisteId: string, on: boolean): void {
    const s = this.state;
    if (!s) return;
    const ops = s.ops;
    if (!ops) return;
    ops.dayGroom = ops.dayGroom.filter((x) => x !== pisteId);
    if (on) ops.dayGroom.push(pisteId);
    void this.planToday();
  }

  /** Etap 7: zmiana planów (naśnieżania, nocy, armatek) – podgląd od nowa. */
  opsChanged(): void {
    this.refreshPreview();
    this.refreshPanel(true);
  }

  /** Trasy zablokowane pryzmami (do mapy i paneli). */
  get blockedPistes(): ReadonlySet<string> {
    return this.blocked;
  }

  /** Plan bieżącego dnia → goście (liczba z popytu, skład, godziny). */
  private async planToday(): Promise<void> {
    const s = this.state;
    if (!s) return;
    const date = { ...s.date };
    const ctx = await this.context(date);
    if (!sameDate(date, s.date)) return;
    const p = planDay(s, ctx, this.o.ep);
    const f = p.factors;
    this.planNote = p.open
      ? `Dziś: ${p.info.label}. Popyt ${Math.round(p.demand)} gości${p.guests < Math.round(p.demand) ? `, parking mieści ${Math.round(p.parkingLimit)}` : ''} · śnieg ${ctx.snow.score.toFixed(2)} · prognoza ×${f.forecast.toFixed(2)} · udział w regionie ${(f.share * 100).toFixed(1)} %.`
      : s.seasonOpen
        ? 'Sezon otwarty, ale żaden wyciąg nie pracuje (budowa, brak otwartej trasy w dół).'
        : `Sezon zamknięty (${PHASE_NAMES[yearPhase(date, this.o.ep)]}). ${yearPhase(date, this.o.ep) === 'summer' ? 'Czas budowy – zegar latem idzie tygodniami.' : ''}`;
    this.o.guests.setDayPlan({ date, guests: p.guests, typeShares: p.typeShares, hours: p.hours, note: this.planNote });
    this.refreshPreview();
    this.refreshPanel(true);
  }

  // ------------------------------------------------------------ panel

  refreshPanel(force: boolean): void {
    const s = this.state;
    if (!s) return;
    const now = performance.now();
    if (!force && now - this.lastPanelMs < 500) return;
    this.lastPanelMs = now;
    this.finance.update({
      state: s,
      modeLabel: s.mode === 'career' ? 'Kariera' : 'Piaskownica',
      phaseLabel: PHASE_NAMES[yearPhase(s.date, this.o.ep)],
      reputation: reputationOf(s, this.o.ep),
      debtPln: debtOf(s),
      loanLimitPln: this.facts ? loanLimit(s, this.facts, this.o.ep) : 0,
      assetValuePln: this.facts?.assetValuePln ?? 0,
      planNote: this.planNote,
      marketPricePln: this.marketPrice(),
      catchingUp: this.catching,
    });
  }

  /** Przyspieszenie zegara latem (kroki tygodniowe). */
  speedFactor(date: CalendarDate): number {
    return this.state && yearPhase(date, this.o.ep) === 'summer' ? this.o.ep.calendar.summerWeekDays : 1;
  }

  /** Data stanu gry (do zegara). */
  get date(): CalendarDate | null {
    return this.state ? this.state.date : null;
  }

  nextDay(): CalendarDate | null {
    return this.state ? addDays(this.state.date, 1) : null;
  }
}
