/**
 * Panele naśnieżania i ratraków (etap 7): zbiornik (stan, dopływ, zużycie), energia (moc chwilowa
 * wobec limitu przyłącza), armatki, flota ratraków (zakup, leasing), plan naśnieżania (docelowa baza
 * i priorytety tras, ręczne sterowanie armatek) i plan nocy (przydział tras do ratraków, kolejność,
 * przewidywany czas zakończenia, ratrakowanie w dzień).
 */
import type { GameState, OpsSummary } from '../sim/economy';
import { fmtPln } from '../sim/economy';
import type { DayOpsResult, Infra } from '../sim/operations';
import type { SnowmakingParams } from '../sim/snowmakingParams';
import { Modal } from './gamePanels';

const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const f1 = (v: number) => v.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hhmm = (h: number) => {
  const m = Math.round(((h % 24) + 24) % 24 * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const MODE_NAMES = ['', 'twarda (mróz)', 'mokra (odwilż)', 'lód (mokry śnieg przed mrozem)'];

export interface SnowPanelView {
  state: GameState;
  infra: Infra | null;
  preview: DayOpsResult | null;
  hour: number;
  sp: SnowmakingParams;
  pisteName(id: string): string;
  blocked: ReadonlySet<string>;
}

export interface SnowPanelHandlers {
  onSnowPlan(): void;
  onNightPlan(): void;
  onGroomer(typeId: string, leased: boolean): void;
  /** Etap 6b: zakup wody z wodociągu. */
  onMains?(on: boolean): void;
}

const KIND_NAMES: Record<string, string> = { intake: 'potok', catchment: 'zlewnia (rowy)', well: 'studnia', mains: 'wodociąg' };

/** Wykres mocy w ciągu doby: słupki (armatki, pompy, reszta) i linia limitu przyłącza. */
function powerChart(sum: OpsSummary, hour: number): string {
  const w = 300;
  const h = 70;
  const lim = Math.max(1, sum.gridLimitKw);
  const max = Math.max(lim, ...sum.hourly.map((x) => x.powerKw)) * 1.05;
  const bw = w / 24;
  const y = (v: number) => h - (v / max) * h;
  let svg = `<svg viewBox="0 0 ${w} ${h + 12}" class="sn-chart">`;
  for (const x of sum.hourly) {
    const x0 = x.hour * bw + 1;
    let base = 0;
    for (const [v, c] of [
      [x.otherKw, '#adb5bd'],
      [x.pumpKw, '#1971c2'],
      [x.gunKw, '#74c0fc'],
    ] as [number, string][]) {
      if (v > 0) svg += `<rect x="${x0}" y="${y(base + v)}" width="${bw - 2}" height="${y(base) - y(base + v)}" fill="${c}"/>`;
      base += v;
    }
  }
  svg += `<line x1="0" x2="${w}" y1="${y(lim)}" y2="${y(lim)}" stroke="#e03131" stroke-dasharray="4 3"/>`;
  svg += `<line x1="${(hour / 24) * w}" x2="${(hour / 24) * w}" y1="0" y2="${h}" stroke="#0f172a" stroke-width="1"/>`;
  for (const t of [0, 6, 12, 18]) svg += `<text x="${(t / 24) * w + 2}" y="${h + 10}" font-size="9" fill="#64748b">${t}:00</text>`;
  return `${svg}</svg>`;
}

export class SnowPanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private collapsed = false;
  private lastHtml = '';

  constructor(parent: HTMLElement, h: SnowPanelHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'build-panel snow-panel';
    this.root.innerHTML = `
      <button type="button" class="build-toggle">Naśnieżanie i ratraki ▾</button>
      <div class="build-content">
        <div class="sn-body"></div>
        <div class="build-row build-buttons">
          <button type="button" class="sn-plan" title="Docelowa grubość bazy i priorytety tras, ręczne włączanie armatek">Plan naśnieżania</button>
          <button type="button" class="sn-night" title="Które trasy, którym ratrakiem i w jakiej kolejności – z przewidywanym czasem zakończenia">Plan nocy</button>
        </div>
      </div>`;
    parent.insertBefore(this.root, parent.children[2] ?? null);
    this.body = this.root.querySelector('.sn-body')!;
    this.root.querySelector('.sn-plan')!.addEventListener('click', () => h.onSnowPlan());
    this.root.querySelector('.sn-night')!.addEventListener('click', () => h.onNightPlan());
    this.body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-groomer]');
      if (b) h.onGroomer(b.dataset.groomer!, b.dataset.leased === '1');
      const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mains]');
      if (m) h.onMains?.(m.dataset.mains === '1');
    });
    this.root.querySelector('.build-toggle')!.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
      this.root.querySelector('.build-toggle')!.textContent = this.collapsed ? 'Naśnieżanie i ratraki ▸' : 'Naśnieżanie i ratraki ▾';
    });
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  update(v: SnowPanelView): void {
    const ops = v.state.ops;
    const inf = v.infra;
    const pv = v.preview?.summary ?? null;
    const parts: string[] = [];
    if (!inf || (inf.reservoirCapacityM3 <= 0 && inf.guns.length === 0 && (ops?.groomers.length ?? 0) === 0 && inf.garageSlots === 0)) {
      parts.push(`<div class="muted small">Brak systemu naśnieżania. Kolejność budowy (latem – wykopy tylko V–X):
        1) <b>ujęcie wody</b>, <b>zbiornik</b> i <b>pompownia</b> (narzędzie „Budynek”, B),
        2) <b>przyłącze energetyczne</b>, 3) <b>rurociąg</b> od pompowni wzdłuż trasy (H) – hydranty co ${f0(v.sp.pipe.hydrantSpacingM)} m,
        4) <b>armatki</b> na hydrantach (J), 5) <b>garaż ratraków</b> i ratraki (tutaj), na stromych trasach – <b>punkt kotwienia</b> na górze stoku.</div>`);
    }
    if (inf) {
      // Zbiornik
      const cap = inf.reservoirCapacityM3;
      const res = ops?.reservoirM3 ?? 0;
      const fill = cap > 0 ? Math.min(1, res / cap) : 0;
      parts.push(`<div class="build-section">Zbiornik</div>
        ${cap > 0
          ? `<div class="sn-bar" title="${f0(res)} z ${f0(cap)} m³"><span style="width:${(fill * 100).toFixed(1)}%"></span></div>
             <div class="small">${f0(res)} / ${f0(cap)} m³ (${f0(fill * 100)} %) · dopływ dziś ${pv ? f0(pv.inflowM3) : '–'} m³ · zużycie dziś ${pv ? f0(pv.waterM3) : '–'} m³</div>`
          : '<div class="muted small">brak zbiornika</div>'}`);
      // Etap 6b: źródła wody osobno – dziś i od 1 V.
      if (inf.sources.length) {
        const today = new Map((pv?.sources ?? []).map((x) => [x.id, x]));
        const rows = inf.sources
          .map((src) => {
            const t = today.get(src.id);
            const bad = src.problem ? ` class="g-bad"` : '';
            return `<tr><td><b>${src.name}</b><div class="muted">${KIND_NAMES[src.kind]}</div></td><td${bad}>${t ? t.note : (src.problem ?? '')}</td><td>${t ? `${f0(t.m3)} m³` : '–'}</td><td>${t ? fmtPln(t.costPln) : '–'}</td></tr>`;
          })
          .join('');
        const season = ops?.waterSeason;
        const seasonRows = season
          ? Object.entries(season.byKind)
              .map(([k, b]) => `<tr><td>${KIND_NAMES[k] ?? k}</td><td>${f0(b.m3)} m³</td><td>${fmtPln(b.costPln)}</td><td>${b.m3 > 0 ? `${f1(b.costPln / b.m3)} zł/m³` : '–'}</td></tr>`)
              .join('')
          : '';
        const hasMains = inf.sources.some((x) => x.kind === 'mains');
        parts.push(`<div class="build-section">Źródła wody</div>
          <table class="sn-table small"><tr><th>źródło</th><th>dziś</th><th>do zbiornika</th><th>koszt</th></tr>${rows}</table>
          ${hasMains ? `<div class="small">Wodociąg: ${ops?.mainsOn ? '<b>kupujesz wodę</b>' : 'zakup wyłączony'} <button type="button" data-mains="${ops?.mainsOn ? '0' : '1'}">${ops?.mainsOn ? 'Wyłącz zakup' : 'Włącz zakup'}</button></div>` : ''}
          ${seasonRows ? `<div class="small muted">Od 1 maja:</div><table class="sn-table small"><tr><th>źródło</th><th>ilość</th><th>koszt</th><th>za m³</th></tr>${seasonRows}</table>` : ''}`);
      }
      // Energia
      const now = pv?.hourly[Math.min(23, Math.max(0, Math.floor(v.hour)))];
      parts.push(`<div class="build-section">Energia</div>
        ${inf.gridKw > 0 ? `<div class="small">Moc teraz <b>${now ? f0(now.powerKw) : '–'} kW</b> z ${f0(inf.gridKw)} kW przyłącza${now ? ` (armatki ${f0(now.gunKw)}, pompy ${f0(now.pumpKw)}, wyciągi ${f0(now.otherKw)})` : ''}</div>
        ${pv ? powerChart(pv, v.hour) : ''}<div class="muted small">słupki: <span style="color:#74c0fc">■</span> armatki <span style="color:#1971c2">■</span> pompy <span style="color:#adb5bd">■</span> wyciągi; czerwona linia – limit przyłącza; taryfa nocna ${hhmm(v.sp.energy.nightStartH)}–${hhmm(v.sp.energy.nightEndH)} (×${v.sp.energy.nightTariffFactor})</div>`
          : '<div class="muted small">brak przyłącza energetycznego – armatki i pompy nie ruszą</div>'}`);
      // Armatki
      const runningNow = pv ? Object.values(pv.gunHours).filter((hs) => hs.some((x) => x[0] === Math.floor(v.hour))).length : 0;
      parts.push(`<div class="build-section">Armatki</div>
        <div class="small">${inf.guns.length} gotowych do pracy · teraz pracuje ${runningNow}${pv ? ` · dziś ${f0(pv.snowM3)} m³ śniegu, ${f0(pv.energyKWh)} kWh${pv.offPisteShare > 0.05 ? `, ${f0(pv.offPisteShare * 100)} % zniosło poza trasę` : ''}` : ''}</div>
        ${v.blocked.size ? `<div class="g-bad small">Pryzmy – trasy zamknięte do rozepchnięcia ratrakiem: ${[...v.blocked].map(v.pisteName).join(', ')}</div>` : ''}`);
      // Ratraki
      const gr = ops?.groomers ?? [];
      const fleet = gr
        .map((g) => {
          const t = v.sp.groomers.types.find((x) => x.id === g.typeId);
          return `<tr><td><b>${g.id}</b></td><td>${t?.name ?? g.typeId}</td><td>${g.leased ? 'leasing' : 'własny'}</td><td>${g.brokenNights > 0 ? `<span class="g-bad">w naprawie (${g.brokenNights} n.)</span>` : 'sprawny'}</td></tr>`;
        })
        .join('');
      const buy = v.sp.groomers.types
        .map(
          (t) => `<div class="build-row g-row"><span class="small">${t.name}: ${fmtPln(t.pricePln)}</span>
            <button type="button" data-groomer="${t.id}" data-leased="0" ${gr.length >= inf.garageSlots ? 'disabled' : ''}>Kup</button>
            <button type="button" data-groomer="${t.id}" data-leased="1" ${gr.length >= inf.garageSlots ? 'disabled' : ''} title="Rata ${fmtPln(t.pricePln * v.sp.groomers.leaseMonthlyShare)} miesięcznie">Leasing</button></div>`,
        )
        .join('');
      parts.push(`<div class="build-section">Ratraki (garaż: ${gr.length}/${inf.garageSlots} miejsc)</div>
        ${fleet ? `<table class="build-list"><tbody>${fleet}</tbody></table>` : '<div class="muted small">brak ratraków – trasy nieratrakowane, pryzmy zostają</div>'}
        ${inf.garageSlots > 0 ? buy : '<div class="muted small">Najpierw zbuduj garaż ratraków (narzędzie „Budynek”).</div>'}`);
      // Noc
      if (pv && pv.jobs.length + pv.unfinished.length > 0) {
        parts.push(`<div class="build-section">Najbliższa noc</div>
          <div class="small">Przewidywany koniec pracy: <b>${hhmm(pv.finishH)}</b> · paliwo ${f0(pv.fuelL)} l
          ${pv.unfinished.length ? `<br><span class="g-bad">Nie zdążą / bez ratraka: ${pv.unfinished.map(v.pisteName).join(', ')}</span>` : ''}
          ${pv.steepSkipped.length ? `<br><span class="g-bad">Strome odcinki pominięte (brak wyciągarki lub kotwy): ${pv.steepSkipped.map(v.pisteName).join(', ')}</span>` : ''}</div>`);
      }
      const last = ops?.last;
      if (last) {
        parts.push(`<div class="muted small">Wczoraj (${last.date.slice(5).split('-').reverse().join('.')}): śnieg ${f0(last.snowM3)} m³, woda ${f0(last.waterM3)} m³, ${f0(last.energyKWh)} kWh, ratraki ${last.jobs.length} tras, ${f0(last.fuelL)} l${last.broken.length ? `, awaria: ${last.broken.join(', ')}` : ''}.</div>`);
      }
    }
    const html = parts.join('');
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.body.innerHTML = html;
    }
  }
}

export interface PlanPiste {
  id: string;
  name: string;
  /** Średnia baza teraz [cm] (null – brak danych). */
  baseCm: number | null;
  hasGuns: boolean;
  areaHa: number;
}

/** Plan naśnieżania: docelowa baza, priorytet, włączone; ręczne sterowanie armatek. */
export class SnowPlanDialog extends Modal {
  constructor(parent: HTMLElement, private readonly onChange: () => void) {
    super(parent, 'snow-plan-dialog');
    this.body.addEventListener('change', this.handler);
  }

  show(state: GameState, pistes: PlanPiste[], guns: { id: string; name: string; pisteName: string }[]): void {
    const ops = state.ops!;
    const rows = pistes
      .map((p) => {
        const pl = ops.snowPlan[p.id] ?? { targetCm: 50, priority: 2, enabled: true };
        return `<tr data-piste="${p.id}"><td><b>${p.name}</b>${p.hasGuns ? '' : ' <span class="muted small">(bez armatek)</span>'}</td>
          <td><input type="checkbox" name="en" ${pl.enabled ? 'checked' : ''}></td>
          <td><input type="number" name="target" min="10" max="150" step="5" value="${pl.targetCm}" style="width:4.5em"> cm</td>
          <td><select name="prio">${[1, 2, 3].map((x) => `<option value="${x}" ${x === pl.priority ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          <td>${p.baseCm === null ? '–' : `${f0(p.baseCm)} cm`}</td><td>${f1(p.areaHa)} ha</td></tr>`;
      })
      .join('');
    const gunRows = guns
      .map((g) => {
        const m = ops.gunModes[g.id] ?? 'auto';
        return `<tr data-gun="${g.id}"><td>${g.name}</td><td>${g.pisteName}</td><td><select name="mode">${[
          ['auto', 'automat'],
          ['on', 'włączona'],
          ['off', 'wyłączona'],
        ]
          .map(([k, t]) => `<option value="${k}" ${k === m ? 'selected' : ''}>${t}</option>`)
          .join('')}</select></td></tr>`;
      })
      .join('');
    this.body.innerHTML = `
      <div class="gc-title">Plan naśnieżania</div>
      <div class="gc-sub">Automat włącza armatki, gdy temperatura mokra jest poniżej progu, a baza na trasie jest cieńsza niż docelowa – najpierw priorytet 1, potem 2 i 3, w ramach priorytetu najzimniejsze miejsca. Ogranicza go woda w zbiorniku, wydajność pompowni i moc przyłącza. Na otwartej trasie w godzinach pracy wyciągów automat nie naśnieża (ręcznie – można).</div>
      <table class="build-list"><tr><th>trasa</th><th>naśnieżać</th><th>docelowa baza</th><th>priorytet</th><th>baza teraz</th><th>pow.</th></tr>${rows || '<tr><td colspan="6" class="muted">brak zbudowanych tras</td></tr>'}</table>
      ${gunRows ? `<h4>Armatki – sterowanie ręczne</h4><table class="build-list"><tr><th>armatka</th><th>trasa</th><th>tryb</th></tr>${gunRows}</table>` : ''}
      <div class="muted small">Docelowa baza dotyczy śniegu ubitego (SWE / 420 kg/m³). Śnieg z armatek ląduje w pryzmach – trasa jest zamknięta na tym odcinku, dopóki ratrak go nie rozepchnie (plan nocy).</div>`;
    this.state = state;
    this.showRoot();
  }

  private state: GameState | null = null;
  private readonly handler = (e: Event): void => {
    const ops = this.state?.ops;
    if (!ops) return;
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const tr = el.closest<HTMLElement>('tr');
    if (!tr) return;
    if (tr.dataset.piste) {
      const id = tr.dataset.piste;
      const q = (n: string) => tr.querySelector<HTMLInputElement>(`[name="${n}"]`)!;
      ops.snowPlan[id] = { enabled: q('en').checked, targetCm: Math.max(0, Number(q('target').value) || 0), priority: Number(q('prio').value) || 2 };
    } else if (tr.dataset.gun) {
      ops.gunModes[tr.dataset.gun] = el.value as 'auto' | 'on' | 'off';
    }
    this.onChange();
  };
}

/** Plan nocy: priorytet (kolejność), włączone, ratrak (automat lub konkretny), ratrakowanie w dzień. */
export class NightPlanDialog extends Modal {
  private state: GameState | null = null;
  private preview: () => DayOpsResult | null = () => null;
  private pisteName: (id: string) => string = (id) => id;

  constructor(
    parent: HTMLElement,
    private readonly onChange: () => void,
    private readonly onDayGroom: (pisteId: string, on: boolean) => void,
  ) {
    super(parent, 'night-plan-dialog');
    this.body.addEventListener('change', this.handler);
  }

  show(state: GameState, pistes: PlanPiste[], sp: SnowmakingParams, preview: () => DayOpsResult | null, pisteName: (id: string) => string): void {
    this.state = state;
    this.preview = preview;
    this.pisteName = pisteName;
    const ops = state.ops!;
    const opts = (sel: string | null) =>
      `<option value="">automat</option>${ops.groomers.map((g) => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${g.id} ${sp.groomers.types.find((t) => t.id === g.typeId)?.winch ? '(wyciągarka)' : ''}</option>`).join('')}`;
    const rows = pistes
      .map((p) => {
        const pl = ops.groomPlan[p.id] ?? { priority: 2, enabled: true, groomerId: null };
        return `<tr data-piste="${p.id}"><td><b>${p.name}</b></td>
          <td><input type="checkbox" name="en" ${pl.enabled ? 'checked' : ''}></td>
          <td><select name="prio">${[1, 2, 3, 4, 5].map((x) => `<option value="${x}" ${x === pl.priority ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          <td><select name="groomer">${opts(pl.groomerId)}</select></td>
          <td><input type="checkbox" name="day" ${ops.dayGroom.includes(p.id) ? 'checked' : ''} title="Ratrakowanie w dzień – trasa zamknięta dla gości do końca dnia"></td>
          <td>${f1(p.areaHa)} ha</td></tr>`;
      })
      .join('');
    this.body.innerHTML = `
      <div class="gc-title">Plan nocy – ratraki</div>
      <div class="gc-sub">Ratraki pracują od ${hhmm(sp.groomers.windowStartH)} do ${hhmm(sp.groomers.windowEndH)} (najwyżej ${sp.groomers.maxShiftH} h zmiany). Trasy po kolei wg priorytetu (1 – najpierw); „automat” daje trasę ratrakowi, który najwcześniej skończy poprzednią, a strome odcinki (≥ ${sp.groomers.winchSlopePercent} %) – ratrakowi z wyciągarką, jeśli lina sięga z punktu kotwienia. Czas = powierzchnia / (szerokość × prędkość), dłużej na stromiznach, w świeżym śniegu i przy pryzmach.</div>
      <table class="build-list"><tr><th>trasa</th><th>ratrakować</th><th>kolejność</th><th>ratrak</th><th>w dzień</th><th>pow.</th></tr>${rows || '<tr><td colspan="6" class="muted">brak zbudowanych tras</td></tr>'}</table>
      <div class="np-result"></div>
      <div class="muted small">Skutek: przy mrozie trasa twarda i trwała; w odwilży – mokra; mokry śnieg ubity tuż przed mrozem zamarza w lód. Ratrakowanie w dzień zamyka trasę dla gości.</div>`;
    this.renderResult();
    this.showRoot();
  }

  /** Wynik podglądu: zadania ratraków z godzinami i przewidywany koniec. */
  renderResult(): void {
    const box = this.body.querySelector('.np-result');
    if (!box) return;
    const pv = this.preview()?.summary;
    if (!pv) {
      box.innerHTML = '<div class="muted small">Podgląd nocy niedostępny (latem lub brak śniegu).</div>';
      return;
    }
    const jobs = pv.jobs
      .map((j) => `<tr><td>${j.groomerId}</td><td>${this.pisteName(j.pisteId)}</td><td>${hhmm(j.startH)}–${hhmm(j.endH)}</td><td>${j.complete ? 'cała' : '<span class="g-bad">nie zdąży</span>'}${j.steepDone ? ' · z wyciągarką' : ''}</td><td>${MODE_NAMES[j.mode] ?? ''}</td></tr>`)
      .join('');
    box.innerHTML = `<h4>Przewidywany przebieg nocy – koniec ${hhmm(pv.finishH)}${pv.finishH > 24 + 7.5 - 1e-6 ? ' (do rana)' : ''}</h4>
      ${jobs ? `<table class="build-list"><tr><th>ratrak</th><th>trasa</th><th>godziny</th><th>zakres</th><th>wynik</th></tr>${jobs}</table>` : '<div class="muted small">żaden ratrak nie pracuje</div>'}
      ${pv.unfinished.length ? `<div class="g-bad small">Nieratrakowane do rana (całe lub część): ${pv.unfinished.map(this.pisteName).join(', ')}</div>` : ''}
      ${pv.steepSkipped.length ? `<div class="g-bad small">Strome odcinki pominięte: ${pv.steepSkipped.map(this.pisteName).join(', ')} – potrzebny ratrak z wyciągarką i punkt kotwienia w zasięgu liny.</div>` : ''}
      <div class="muted small">Paliwo ${f0(pv.fuelL)} l.</div>`;
  }

  private readonly handler = (e: Event): void => {
    const ops = this.state?.ops;
    if (!ops) return;
    const el = e.target as HTMLInputElement;
    const tr = el.closest<HTMLElement>('tr');
    const id = tr?.dataset.piste;
    if (!tr || !id) return;
    if (el.name === 'day') {
      this.onDayGroom(id, el.checked);
    } else {
      const q = (n: string) => tr.querySelector<HTMLInputElement>(`[name="${n}"]`)!;
      ops.groomPlan[id] = { enabled: q('en').checked, priority: Number(q('prio').value) || 2, groomerId: q('groomer').value || null };
    }
    this.onChange();
    this.renderResult();
  };
}
