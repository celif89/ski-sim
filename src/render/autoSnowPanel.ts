/**
 * Etap 7f: okno „Naśnież trasę” – podsumowanie propozycji (rury, hydranty, armatki, połączenie
 * z pompownią), koszt, wydajność i czas pierwszego zaśnieżenia; „Zbuduj” albo „Anuluj”.
 * Samą propozycję liczy src/sim/autoSnowmaking.ts, rysuje ją kontroler budowy (nakładka).
 */
import type { AutoSnowPlan } from '../sim/autoSnowmaking';
import { icon } from './ui/icons';
import { tipAttrs } from './ui/shell';

export interface AutoSnowView {
  pistes: string[];
  plan: AutoSnowPlan;
  /** Do zapłaty teraz (kariera; null – piaskownica). */
  chargePln: number | null;
  gunNames: Record<string, string>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const money = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mln zł` : `${f0(v / 1000)} tys. zł`);

export class AutoSnowPanel {
  readonly el: HTMLElement;

  constructor(parent: HTMLElement, private readonly h: { onBuild(): void; onCancel(): void }) {
    this.el = document.createElement('section');
    this.el.className = 'u-panel u-autosnow hidden';
    this.el.setAttribute('aria-label', 'Naśnież trasę');
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-as]');
      if (!b) return;
      if (b.dataset.as === 'build') this.h.onBuild();
      else this.h.onCancel();
    });
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  show(v: AutoSnowView): void {
    const p = v.plan;
    const fans = p.perPiste.reduce((a, x) => a + x.fans, 0);
    const lances = p.perPiste.reduce((a, x) => a + x.lances, 0);
    const pipeM = p.perPiste.reduce((a, x) => a + x.edgeM + x.connectorM, 0);
    const conn = p.perPiste.reduce((a, x) => a + x.connectorM, 0);
    const hyd = p.perPiste.reduce((a, x) => a + x.hydrants, 0);
    const days = Number.isFinite(p.firstCoverDays) ? (p.firstCoverDays < 1 ? 'niecała doba' : `ok. ${f0(Math.ceil(p.firstCoverDays))} ${Math.ceil(p.firstCoverDays) === 1 ? 'doba' : 'doby'}`) : '–';
    this.el.innerHTML = `<div class="u-card-head"><div class="u-head-icon">${icon('snow', 22)}</div><div class="u-stack"><span class="u-card-title">Naśnież trasę</span><span class="u-sub">${esc(v.pistes.join(', '))}</span></div><button type="button" class="u-icon-btn u-close" data-as="cancel" ${tipAttrs('Anuluj', 'Esc')}>${icon('close', 18, 2)}</button></div>
      <div class="u-tiles">
        <div class="u-tile"><span class="u-label">Koszt</span><span class="u-tile-val">${money(p.costPln)}</span></div>
        <div class="u-tile"><span class="u-label">Wydajność</span><span class="u-tile-val">${f0(p.snowM3h)} m³/h</span></div>
        <div class="u-tile"><span class="u-label">Pierwsze zaśnieżenie</span><span class="u-tile-val">${days}</span></div>
      </div>
      <table class="u-table u-rows"><tbody>
        <tr><th>rurociąg</th><td>${f0(pipeM)} m${conn > 0 ? ` (z tego ${f0(conn)} m dojścia od sieci)` : ''} · ${money(p.cost.pipesPln)}</td></tr>
        <tr><th>hydranty</th><td>${f0(hyd)} · ${money(p.cost.hydrantsPln)}</td></tr>
        <tr><th>armatki</th><td>${fans} śmigłowych, ${lances} lanc · ${money(p.cost.gunsPln)}</td></tr>
        <tr><th>woda</th><td>${f0(p.waterM3h)} m³/h przy −6 °C temp. mokrej${p.pumpLimited ? ' – więcej niż da pompownia' : ''}</td></tr>
        <tr><th>powierzchnia tras</th><td>${(p.areaM2 / 1e4).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha</td></tr>
        ${v.chargePln !== null ? `<tr><th>do zapłaty teraz</th><td>${money(Math.max(0, v.chargePln))}</td></tr>` : ''}
        <tr><th>budowa</th><td>ok. ${f0(p.buildDays)} dni, wykop tylko V–X</td></tr>
      </tbody></table>
      ${p.issues.length ? `<div class="u-advice">${p.issues.map(esc).join('<br>')}</div>` : ''}
      <p class="u-note-dim">Śmigłowe na szerokich, łagodnych odcinkach; lance na wąskich, stromych i przy lesie. Kliknij inną trasę, aby ją dodać albo zdjąć.</p>
      <div class="u-actions"><div class="u-grid2"><button type="button" class="u-btn" data-as="cancel">Anuluj</button><button type="button" class="u-btn primary" data-as="build" ${p.pipelines.length ? '' : 'disabled'} ${tipAttrs('Zbuduj całą propozycję', 'Enter')}>Zbuduj</button></div></div>`;
    this.el.classList.remove('hidden');
  }
}
