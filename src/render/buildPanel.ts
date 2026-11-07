/**
 * Panel budowy (po prawej): narzędzia, typ wyciągu, szerokość trasy, cofnij/ponów/usuń, zapis
 * i wczytanie układu, przełączniki nakładek (sieć, rzeczywistość), lista obiektów ze statystykami,
 * ostrzeżenia sieci i porównanie z prawdziwymi trasami Pilska.
 */
import type { LiftParams } from '../sim/lifts';
import type { PisteParams } from '../sim/pistes';
import type { RealPisteComparison, ResortAnalysis, ResortLayout } from '../sim/resort';
import type { ThinSegment } from '../sim/snowRiding';

export type BuildTool = 'select' | 'lift' | 'pisteBrush' | 'pisteAxis' | 'base' | 'pipeline' | 'supply' | 'gun' | 'road' | 'catwalk' | 'bikeTrail' | 'walkTrail' | 'toboggan';

export interface BuildPanelHandlers {
  onTool(tool: BuildTool): void;
  onLiftType(typeId: string): void;
  onWidth(widthM: number): void;
  onUndo(): void;
  onRedo(): void;
  onDelete(): void;
  onExport(): void;
  onImport(file: File): void;
  onClearAll(): void;
  onToggleNetwork(): void;
  onToggleReality(): void;
  onSelect(kind: 'lift' | 'piste' | 'base' | 'pipeline' | 'gun' | 'road' | 'trail', id: string): void;
  /** Nowe trasy z wyrównaniem terenu (koszt, łąka wyrównana – mniej śniegu potrzeba). */
  onGradeNew(on: boolean): void;
  /** Etap 6: typ budynku do postawienia. */
  onBuildingType(id: string): void;
  /** Etap 7: typ stawianej armatki. */
  onGunType(id: string): void;
}

export interface BuildPanelState {
  tool: BuildTool;
  liftTypeId: string;
  widthM: number;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  showNetwork: boolean;
  showReality: boolean;
  layout: ResortLayout;
  analysis: ResortAnalysis;
  selection: { kind: 'lift' | 'piste' | 'base' | 'pipeline' | 'gun' | 'road' | 'trail'; id: string } | null;
  real: RealPisteComparison[] | null;
  message: string;
  gradeNew: boolean;
  /** Odcinki tras ze zbyt cienką bazą. */
  thin: Map<string, ThinSegment[]>;
  buildingTypeId: string;
  /** Budowy w toku: postęp 0–1. */
  construction: Map<string, number>;
  gunTypeId: string;
}

const fmt0 = (x: number) => Math.round(x).toLocaleString('pl-PL');
const money = (x: number) => (x >= 1e6 ? `${(x / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mln zł` : `${fmt0(x / 1000)} tys. zł`);

const TOOLS: { tool: BuildTool; key: string; label: string; title: string }[] = [
  { tool: 'select', key: 'V', label: 'Wybierz', title: 'Kliknij obiekt na mapie, żeby zobaczyć jego profil i liczby' },
  { tool: 'lift', key: 'L', label: 'Wyciąg', title: 'Kliknij dolną stację, potem górną. Esc – anuluj' },
  { tool: 'pisteBrush', key: 'T', label: 'Trasa – pędzel', title: 'Przeciągnij myszą od góry do dołu (przesuwanie mapy: prawy przycisk albo klawisze). [ ] – szerokość' },
  { tool: 'pisteAxis', key: 'O', label: 'Trasa – oś', title: 'Klikaj kolejne punkty osi trasy; podwójne kliknięcie lub Enter – koniec, Backspace – cofnij punkt, Esc – anuluj' },
  { tool: 'catwalk', key: 'U', label: 'Nartostrada', title: 'Łatwa trasa łącznikowa (wąska, łagodna) – klikaj punkty osi, Enter – koniec' },
  { tool: 'road', key: 'E', label: 'Droga', title: 'Droga dojazdowa do parkingu: od drogi publicznej (szarej) albo innej drogi; koszt za metr, zimą odśnieżanie' },
  { tool: 'pipeline', key: 'H', label: 'Rurociąg', title: 'Rurociąg naśnieżania z hydrantami: klikaj punkty od pompowni wzdłuż trasy, Enter – koniec. Wykop tylko latem' },
  { tool: 'supply', key: 'F', label: 'Rura zasilająca', title: 'Rura zasilająca: od źródła wody (ujęcie, studnia, wodociąg) do zbiornika; pod górę – pompa (energia). Wykop tylko latem' },
  { tool: 'gun', key: 'J', label: 'Armatka', title: 'Armatka lub lanca na hydrancie: kliknij kropkę na rurociągu' },
  { tool: 'bikeTrail', key: 'X', label: 'Trasa rowerowa', title: 'Bike park (lato): klikaj punkty od górnej stacji kolei z wieszakami w dół; trudność z nachylenia, Enter – koniec' },
  { tool: 'walkTrail', key: 'Q', label: 'Ścieżka', title: 'Ścieżka spacerowa (lato): klikaj punkty; łączy się ze szlakami, Enter – koniec' },
  { tool: 'toboggan', key: 'C', label: 'Tor saneczkowy', title: 'Tor całoroczny: od góry do dolnej stacji, nachylenie w granicach toru; Enter – koniec' },
  { tool: 'base', key: 'B', label: 'Budynek', title: 'Parking (baza – tu przyjeżdżają goście), gastronomia, wypożyczalnia, szkółka – wybierz typ i kliknij na mapie' },
];

export class BuildPanel {
  private readonly root: HTMLElement;
  private readonly toolButtons = new Map<BuildTool, HTMLButtonElement>();
  private readonly typeSelect: HTMLSelectElement;
  private readonly width: HTMLInputElement;
  private readonly widthLabel: HTMLElement;
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;
  private readonly del: HTMLButtonElement;
  private readonly netBtn: HTMLButtonElement;
  private readonly realBtn: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly grade: HTMLInputElement;
  private readonly buildingSelect: HTMLSelectElement | null;
  private readonly gunSelect: HTMLSelectElement | null;
  private collapsed = false;

  constructor(
    parent: HTMLElement,
    liftParams: LiftParams,
    private readonly pisteParams: PisteParams,
    h: BuildPanelHandlers,
    buildingTypes: { id: string; name: string; costPln: number }[] | null = null,
    gunTypes: { id: string; name: string; costPln: number }[] | null = null,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'build-panel';
    this.root.innerHTML = `
      <button type="button" class="build-toggle">Budowa ośrodka ▾</button>
      <div class="build-content">
        <div class="build-tools"></div>
        <div class="build-row"><label>Typ wyciągu <select class="build-type"></select></label></div>
        <div class="build-row"><label>Szerokość trasy <input type="range" class="build-width"> <span class="build-width-label"></span></label></div>
        ${buildingTypes ? '<div class="build-row"><label>Budynek <select class="build-building"></select></label></div>' : ''}
        ${gunTypes ? '<div class="build-row"><label>Armatka <select class="build-gun"></select></label></div>' : ''}
        <div class="build-row"><label title="Usunięcie kamieni i pniaków, niwelacja – kosztuje, ale na łące wyrównanej wystarczy mniej śniegu"><input type="checkbox" class="build-grade"> wyrównaj teren pod nowymi trasami</label></div>
        <div class="build-row build-buttons">
          <button type="button" class="b-undo" title="Cofnij (Ctrl+Z)">↶ Cofnij</button>
          <button type="button" class="b-redo" title="Ponów (Ctrl+Y)">↷ Ponów</button>
          <button type="button" class="b-del" title="Usuń zaznaczony obiekt (Delete)">Usuń</button>
        </div>
        <div class="build-row build-buttons">
          <button type="button" class="b-net" title="Strzałki kierunku zjazdu, numery, połączenia (klawisz N)"><kbd>N</kbd> Sieć</button>
          <button type="button" class="b-real" title="Prawdziwe wyciągi i trasy Pilska z OpenStreetMap (klawisz R)"><kbd>R</kbd> Rzeczywistość</button>
        </div>
        <div class="build-row build-buttons">
          <button type="button" class="b-export" title="Zapisz układ ośrodka do pliku JSON">Zapisz plik</button>
          <label class="file-button" title="Wczytaj układ ośrodka z pliku JSON">Wczytaj plik<input type="file" accept=".json,application/json" class="b-import"></label>
          <button type="button" class="b-clear" title="Usuń wszystkie obiekty (można cofnąć)">Wyczyść</button>
        </div>
        <div class="build-message"></div>
        <div class="build-body"></div>
      </div>`;
    parent.appendChild(this.root);
    const tools = this.root.querySelector('.build-tools')!;
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<kbd>${t.key}</kbd> ${t.label}`;
      b.title = `${t.title} (klawisz ${t.key})`;
      b.addEventListener('click', () => h.onTool(t.tool));
      tools.appendChild(b);
      this.toolButtons.set(t.tool, b);
    }
    this.typeSelect = this.root.querySelector('.build-type')!;
    for (const t of liftParams.types) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = `${t.name} – ${fmt0(t.capacityPerHour)} os./h`;
      this.typeSelect.appendChild(o);
    }
    this.typeSelect.addEventListener('change', () => h.onLiftType(this.typeSelect.value));
    this.width = this.root.querySelector('.build-width')!;
    this.width.min = String(pisteParams.minWidthM);
    this.width.max = String(pisteParams.maxWidthM);
    this.width.step = '1';
    this.widthLabel = this.root.querySelector('.build-width-label')!;
    this.width.addEventListener('input', () => h.onWidth(Number(this.width.value)));
    this.undo = this.root.querySelector('.b-undo')!;
    this.redo = this.root.querySelector('.b-redo')!;
    this.del = this.root.querySelector('.b-del')!;
    this.netBtn = this.root.querySelector('.b-net')!;
    this.realBtn = this.root.querySelector('.b-real')!;
    this.undo.addEventListener('click', () => h.onUndo());
    this.redo.addEventListener('click', () => h.onRedo());
    this.del.addEventListener('click', () => h.onDelete());
    this.netBtn.addEventListener('click', () => h.onToggleNetwork());
    this.realBtn.addEventListener('click', () => h.onToggleReality());
    this.root.querySelector('.b-export')!.addEventListener('click', () => h.onExport());
    this.root.querySelector('.b-clear')!.addEventListener('click', () => h.onClearAll());
    const file = this.root.querySelector<HTMLInputElement>('.b-import')!;
    file.addEventListener('change', () => {
      if (file.files?.[0]) h.onImport(file.files[0]);
      file.value = '';
    });
    this.buildingSelect = this.root.querySelector('.build-building');
    if (this.buildingSelect && buildingTypes) {
      for (const t of buildingTypes) {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = `${t.name} – ${money(t.costPln)}`;
        this.buildingSelect.appendChild(o);
      }
      const plain = document.createElement('option');
      plain.value = 'base';
      plain.textContent = 'Baza bez parkingu (miejsce przyjazdu) – 0 zł';
      this.buildingSelect.appendChild(plain);
      this.buildingSelect.addEventListener('change', () => h.onBuildingType(this.buildingSelect!.value));
    }
    this.gunSelect = this.root.querySelector('.build-gun');
    if (this.gunSelect && gunTypes) {
      for (const t of gunTypes) {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = `${t.name} – ${money(t.costPln)}`;
        this.gunSelect.appendChild(o);
      }
      this.gunSelect.addEventListener('change', () => h.onGunType(this.gunSelect!.value));
    }
    this.grade = this.root.querySelector('.build-grade')!;
    this.grade.addEventListener('change', () => h.onGradeNew(this.grade.checked));
    this.msg = this.root.querySelector('.build-message')!;
    this.body = this.root.querySelector('.build-body')!;
    this.root.querySelector('.build-toggle')!.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
    });
    this.body.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
      if (row) h.onSelect(row.dataset.kind as 'lift' | 'piste' | 'base', row.dataset.id!);
    });
  }

  update(s: BuildPanelState): void {
    for (const [tool, b] of this.toolButtons) b.classList.toggle('active', tool === s.tool);
    this.typeSelect.value = s.liftTypeId;
    this.width.value = String(s.widthM);
    this.widthLabel.textContent = `${fmt0(s.widthM)} m`;
    this.undo.disabled = !s.canUndo;
    this.redo.disabled = !s.canRedo;
    this.del.disabled = !s.hasSelection;
    this.netBtn.classList.toggle('active', s.showNetwork);
    this.realBtn.classList.toggle('active', s.showReality);
    this.grade.checked = s.gradeNew;
    if (this.buildingSelect) this.buildingSelect.value = s.buildingTypeId;
    if (this.gunSelect) this.gunSelect.value = s.gunTypeId;
    const building = (id: string) => {
      const p = s.construction.get(id);
      return p === undefined ? '' : ` <span class="g-warn" title="plac budowy">🚧 ${fmt0(p * 100)} %</span>`;
    };
    this.msg.textContent = s.message;
    this.msg.classList.toggle('empty', !s.message);
    const sel = (kind: string, id: string) => (s.selection?.kind === kind && s.selection.id === id ? ' selected' : '');
    const lifts = s.layout.lifts
      .map((l) => {
        const a = s.analysis.lifts.get(l.id);
        if (!a) return '';
        return `<tr data-kind="lift" data-id="${l.id}" class="${a.ok ? '' : 'bad'}${sel('lift', l.id)}${l.closed ? ' g-closed' : ''}"><td><b>${l.name}</b>${building(l.id)}${l.closed ? ' <span class="muted">zamkn.</span>' : ''}${l.bends?.length ? ` <span class="muted">${l.bends.length}×∠</span>` : ''}</td><td>${a.type.name}</td><td>${fmt0(a.horizontalLengthM)} m</td><td>↑ ${fmt0(a.riseM)} m</td><td>${fmt0(a.capacityPerHour)} os./h</td><td>${money(a.cost.totalPln)}</td></tr>`;
      })
      .join('');
    const pistes = s.layout.pistes
      .map((p) => {
        const a = s.analysis.pistes.get(p.id);
        if (!a) return '';
        const c = this.pisteParams.classes[a.classIndex];
        const thin = s.thin.get(p.id);
        const flag = p.closed ? ' <span class="muted">zamkn.</span>' : thin ? ` <span class="g-bad" title="za mało śniegu: ${thin.map((t) => `${fmt0(t.fromM)}–${fmt0(t.toM)} m (${fmt0(t.baseCm)}/${fmt0(t.neededCm)} cm)`).join(', ')}">⚠ śnieg</span>` : '';
        return `<tr data-kind="piste" data-id="${p.id}" class="${a.ok ? '' : 'bad'}${sel('piste', p.id)}${p.closed ? ' g-closed' : ''}"><td><b>${p.name}</b>${building(p.id)}${flag}${p.graded ? ' <span class="muted">wyr.</span>' : ''}</td><td><span class="piste-class" style="background:${c.color}">${c.name}</span></td><td>${fmt0(a.lengthM)} m</td><td>↓ ${fmt0(a.dropM)} m</td><td>maks. ${fmt0(a.maxSlopePercent)} %</td><td>${money(a.cost.totalPln)}</td></tr>`;
      })
      .join('');
    const bases = [...s.layout.bases, ...(s.layout.buildings ?? [])]
      .map((b) => `<tr data-kind="base" data-id="${b.id}" class="${sel('base', b.id)}"><td><b>${b.typeId === 'parking' || !b.typeId ? 'P' : b.typeId === 'gastronomy' ? 'G' : b.typeId === 'rental' ? 'W' : 'S'}</b></td><td colspan="5">${b.name}${building(b.id)}</td></tr>`)
      .join('');
    const pipes = (s.layout.pipelines ?? [])
      .map((pp) => {
        let L = 0;
        for (let i = 1; i < pp.points.length; i++) L += Math.hypot(pp.points[i].xM - pp.points[i - 1].xM, pp.points[i].yM - pp.points[i - 1].yM);
        const guns = (s.layout.snowGuns ?? []).filter((g) => g.pipelineId === pp.id).length;
        return `<tr data-kind="pipeline" data-id="${pp.id}" class="${sel('pipeline', pp.id)}"><td><b>${pp.name}</b>${building(pp.id)}</td><td colspan="5">${fmt0(L)} m · armatek: ${guns}</td></tr>`;
      })
      .join('');
    const issues = s.analysis.network.issues.map((i) => `<li class="warning">⚠ ${i.message}</li>`).join('');
    const empty = !lifts && !pistes && !bases;
    let real = '';
    if (s.showReality && s.real) {
      const agree = s.real.filter((r) => r.agree).length;
      const name = (id: string | null) => (id ? this.pisteParams.classes.find((c) => c.id === id) : undefined);
      real = `<div class="build-section">Prawdziwe trasy Pilska (OSM) – nasza klasyfikacja: <b>${agree} z ${s.real.length}</b> zgodnych</div>
        <table class="build-list"><thead><tr><th>trasa</th><th>oficjalnie</th><th>nasza</th><th>50 m</th><th>długość</th></tr></thead><tbody>${s.real
          .map((r) => {
            const o = name(r.officialClass);
            const w = name(r.ourClass);
            return `<tr class="${r.agree ? '' : 'bad'}"><td><b>${r.label}</b></td><td>${o ? `<span class="piste-class" style="background:${o.color}">${o.name}</span>` : '–'}</td><td>${w ? `<span class="piste-class" style="background:${w.color}">${w.name}</span>` : '–'}</td><td>${fmt0(r.maxSlopePercent)} %</td><td>${fmt0(r.lengthM)} m</td></tr>`;
          })
          .join('')}</tbody></table>`;
    }
    this.body.innerHTML = `
      ${empty ? '<div class="muted">Ośrodek jest pusty. Wybierz „Wyciąg” (L) i kliknij dolną, potem górną stację; potem „Trasa” (T lub O).</div>' : ''}
      ${lifts ? `<div class="build-section">Wyciągi</div><table class="build-list"><tbody>${lifts}</tbody></table>` : ''}
      ${pistes ? `<div class="build-section">Trasy</div><table class="build-list"><tbody>${pistes}</tbody></table>` : ''}
      ${bases ? `<div class="build-section">Budynki</div><table class="build-list"><tbody>${bases}</tbody></table>` : ''}
      ${pipes ? `<div class="build-section">Naśnieżanie – rurociągi</div><table class="build-list"><tbody>${pipes}</tbody></table>` : ''}
      ${!empty ? `<div class="build-total">Razem: ${money(s.analysis.totals.costPln)} · ${fmt0(s.analysis.totals.buildDays)} dni pracy · wycinka ${(s.analysis.totals.clearedForestM2 / 10_000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha lasu</div>` : ''}
      ${issues ? `<div class="build-section">Sieć – ostrzeżenia</div><ul class="build-issues">${issues}</ul>` : !empty ? '<div class="build-ok">✓ sieć: wszystkie trasy i wyciągi połączone</div>' : ''}
      ${real}`;
  }
}
