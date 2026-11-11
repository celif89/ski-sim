/**
 * Etap 7g: widok danych „Działki” – granice kwadratów z nazwą i ceną (twoje: zielone, dzierżawione:
 * niebieskie, do wyboru na start: pomarańczowa obwódka, brakujące pod rysowanym obiektem: czerwone)
 * i karta działki (wysokości, przewyższenie, nachylenia, las, potoki, cena; kupno / dzierżawa / start).
 * Rysowane na ekranie (warstwa ekranu nad mapą), karta jako okno DOM.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { Parcel, ParcelGrid } from '../sim/parcels';
import type { ViewCamera } from './camera';
import { icon } from './ui/icons';
import { tipAttrs } from './ui/shell';

const FONT_COND = '"Barlow Condensed", Barlow, sans-serif';
const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const money = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} mln zł` : `${f0(v / 1000)} tys. zł`);

export interface ParcelViewState {
  /** Widok „Działki” włączony. */
  active: boolean;
  /** Wybór działki startowej (kariera). */
  choosing: boolean;
  /** Działki gracza: id → kupiona / dzierżawiona; null – piaskownica (wszystkie). */
  owned: Record<string, 'buy' | 'lease'> | null;
  /** Brakujące działki pod rysowanym obiektem. */
  missing: string[];
  selected: string | null;
}

export class ParcelLayer {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly labels: Text[] = [];
  private key = '';

  constructor(private readonly pg: ParcelGrid) {
    this.root.eventMode = 'none';
    this.root.addChild(this.g);
    for (const p of pg.parcels) {
      const t = new Text({ text: '', style: { fontFamily: FONT_COND, fontSize: 15, fontWeight: '700', fill: 0x0f172a, stroke: { color: 0xffffff, width: 4 }, align: 'center' } });
      t.anchor.set(0.5);
      this.labels.push(t);
      this.root.addChild(t);
      void p;
    }
  }

  update(camera: ViewCamera, st: ParcelViewState): void {
    const show = st.active || st.choosing || st.missing.length > 0;
    this.root.visible = show;
    if (!show) return;
    const key = `${camera.centerXM}|${camera.centerYM}|${camera.metersPerPixel}|${camera.rotated}|${camera.viewportWidthPx}|${camera.viewKey ?? ''}|${JSON.stringify(st)}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g.clear();
    const S = (x: number, y: number) => camera.worldToScreen(x, y);
    const full = st.active || st.choosing;
    this.pg.parcels.forEach((p, n) => {
      const mine = st.owned ? st.owned[p.id] : 'buy';
      const missing = st.missing.includes(p.id);
      const startable = st.choosing && p.touchesRoad;
      const lab = this.labels[n];
      if (!full && !missing) {
        lab.visible = false;
        return;
      }
      // Boki co 50 m – w widoku 3D obrys idzie po terenie (w 2D bez różnicy).
      const poly: number[] = [];
      const corners: [number, number][] = [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]];
      for (let e = 0; e < 4; e++) {
        const [x0, y0] = corners[e];
        const [x1, y1] = corners[(e + 1) % 4];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 50));
        for (let k = 0; k < n; k++) {
          const q = S(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
          poly.push(q.xPx, q.yPx);
        }
      }
      const fill = missing ? 0xff6b6b : st.owned && mine === 'buy' ? 0x5fd39a : mine === 'lease' ? 0x7cc4f2 : startable ? 0xff7a1a : 0x0f172a;
      const alpha = missing ? 0.3 : st.owned && mine ? 0.18 : startable ? 0.16 : st.choosing ? 0.28 : 0.04;
      g.poly(poly).fill({ color: fill, alpha });
      g.poly(poly).stroke({ width: p.id === st.selected ? 4 : startable || missing ? 3 : 1.5, color: p.id === st.selected ? 0xff7a1a : missing ? 0xff6b6b : startable ? 0xff7a1a : 0xffffff, alpha: 0.9 });
      const ctr = S(p.cx, p.cy);
      lab.visible = full || missing;
      lab.position.set(ctr.xPx, ctr.yPx);
      const status = !st.owned ? '' : mine === 'buy' ? '\nTwoja' : mine === 'lease' ? '\ndzierżawa' : p.pricePln === null ? `\ndzierż. ${money(p.leasePlnPerYear)}/rok` : `\n${money(p.pricePln)}`;
      lab.text = `${p.id}${status}`;
      const sc = Math.max(0.7, Math.min(1.2, 1.6 / Math.max(0.5, camera.metersPerPixel)));
      lab.scale.set(sc);
    });
  }
}

export interface ParcelCardHandlers {
  onBuy(id: string): void;
  onLease(id: string): void;
  onStart(id: string): void;
  onClose(): void;
}

export class ParcelCard {
  private readonly el: HTMLElement;
  private parcel: Parcel | null = null;

  constructor(parent: HTMLElement, private readonly h: ParcelCardHandlers) {
    this.el = document.createElement('section');
    this.el.className = 'u-panel u-parcel-card hidden';
    this.el.setAttribute('aria-label', 'Karta działki');
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-pc]')?.dataset.pc;
      const p = this.parcel;
      if (!a || !p) return;
      if (a === 'close') {
        this.hide();
        this.h.onClose();
      } else if (a === 'buy') this.h.onBuy(p.id);
      else if (a === 'lease') this.h.onLease(p.id);
      else if (a === 'start') this.h.onStart(p.id);
    });
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  get currentId(): string | null {
    return this.visible ? (this.parcel?.id ?? null) : null;
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.parcel = null;
  }

  /** owned – stan działki gracza (null – piaskownica); count / limit – ile ma i ile wolno. */
  show(p: Parcel, o: { owned: 'buy' | 'lease' | null | 'all'; choosing: boolean; count: number; limit: number; balancePln: number }): void {
    this.parcel = p;
    const rows: [string, string][] = [
      ['powierzchnia', `${p.areaHa.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha (część polska)`],
      ['wysokość', `${f0(p.zMinM)}–${f0(p.zMaxM)} m n.p.m. (przewyższenie ${f0(p.zMaxM - p.zMinM)} m)`],
      ['nachylenie', `średnio ${f0(p.meanSlopePercent)} %, 90 % terenu do ${f0(p.p90SlopePercent)} %`],
      ['las', `${f0(p.forestShare * 100)} %${p.leaseOnly ? ' – Lasy Państwowe: tylko dzierżawa' : ''}`],
      ['zabudowa', `${f0(p.builtShare * 100)} %${p.builtShare > 0.02 ? ' (droższy grunt)' : ''}`],
      ['potoki', p.streamKm > 0.05 ? `${p.streamKm.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} km – woda do naśnieżania` : 'brak'],
      ['droga publiczna', p.touchesRoad ? 'tak – dojazd' : 'nie'],
      ['cena zakupu', p.pricePln === null ? '— (tylko dzierżawa)' : money(p.pricePln)],
      ['dzierżawa', `${money(p.leasePlnPerYear)} rocznie (1 maja)`],
    ];
    let actions = '';
    let status = '';
    if (o.owned === 'all') status = 'Piaskownica – wszystkie działki są Twoje.';
    else if (o.owned === 'buy') status = 'Twoja działka (kupiona).';
    else if (o.owned === 'lease') status = `Dzierżawisz – ${money(p.leasePlnPerYear)} co roku.`;
    else if (o.choosing) {
      if (p.touchesRoad) {
        const price = p.pricePln === null ? p.leasePlnPerYear : p.pricePln;
        actions = `<button type="button" class="u-btn primary wide" data-pc="start" ${price > o.balancePln ? 'disabled' : ''}>Zacznij tutaj (${p.pricePln === null ? `dzierżawa ${money(price)}/rok` : money(price)})</button>`;
        status = 'Działka przy drodze publicznej – można tu zacząć.';
      } else status = 'Na start wybierz działkę przy drodze publicznej (pomarańczowe).';
    } else if (o.count >= o.limit) status = `Masz ${o.count} z ${o.limit} działek – następne po kolejnym kamieniu milowym.`;
    else {
      status = `Masz ${o.count} z ${o.limit === Infinity ? '∞' : o.limit} działek.`;
      actions = `<div class="u-grid2">${p.pricePln !== null ? `<button type="button" class="u-btn primary" data-pc="buy" ${p.pricePln > o.balancePln ? 'disabled' : ''} ${tipAttrs('Zakup – jednorazowo')}>Kup – ${money(p.pricePln)}</button>` : ''}<button type="button" class="u-btn" data-pc="lease" ${p.leasePlnPerYear > o.balancePln ? 'disabled' : ''} ${tipAttrs('Dzierżawa – czynsz co roku 1 maja (pierwszy rok od razu)')}>Dzierżaw – ${money(p.leasePlnPerYear)}/rok</button></div>`;
    }
    this.el.innerHTML = `<div class="u-card-head"><div class="u-head-icon">${icon('layers', 22)}</div><div class="u-stack"><span class="u-card-title">Działka ${p.id}</span><span class="u-sub">${status}</span></div><button type="button" class="u-icon-btn u-close" data-pc="close" ${tipAttrs('Zamknij', 'Esc')}>${icon('close', 18, 2)}</button></div>
      <table class="u-table u-rows"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
      ${actions ? `<div class="u-actions">${actions}</div>` : ''}`;
    this.el.classList.remove('hidden');
  }
}
