/**
 * Etap 7f: przy kursorze w trakcie budowy – znacznik przyciągnięcia (koło na punkcie sieci, romb na
 * odcinku), linia pomocnicza (przerywana, z opisem: „90° do: trasa 3”, „przedłużenie”, „wzdłuż trasy”)
 * i okienko z długością, kosztem narastająco i nachyleniem odcinka; ostrzeżenia na czerwono.
 * Dane liczy BuildController (snapView), tu tylko rysowanie na ekranie (stała wielkość).
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { SnapView } from './buildController';
import type { Camera } from './camera';

const FONT = 'Barlow, sans-serif';
const FONT_COND = '"Barlow Condensed", Barlow, sans-serif';
const ACCENT = 0xff7a1a;
const BAD = 0xff6b6b;

export class SnapOverlay {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly box = new Graphics();
  private readonly guideText: Text;
  private readonly infoText: Text;
  private readonly warnText: Text;

  constructor() {
    this.root.eventMode = 'none';
    this.guideText = new Text({ text: '', style: { fontFamily: FONT_COND, fontSize: 14, fontWeight: '700', fill: ACCENT, stroke: { color: 0xffffff, width: 4 } } });
    this.infoText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 13, fontWeight: '600', fill: 0xeef3f8, lineHeight: 17 } });
    this.warnText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 13, fontWeight: '700', fill: BAD, lineHeight: 17 } });
    this.root.addChild(this.g, this.box, this.guideText, this.infoText, this.warnText);
    this.root.visible = false;
  }

  update(camera: Camera, cursor: { xPx: number; yPx: number } | null, v: SnapView | null): void {
    if (!cursor || !v) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const g = this.g.clear();
    const S = (x: number, y: number) => camera.worldToScreen(x, y);
    // Linia pomocnicza: przerywana, przez cały ekran wzdłuż kierunku.
    if (v.guide) {
      const a = S(v.guide.from.xM, v.guide.from.yM);
      const b = S(v.guide.to.xM, v.guide.to.yM);
      const L = Math.hypot(b.xPx - a.xPx, b.yPx - a.yPx);
      if (L > 1) {
        const ux = (b.xPx - a.xPx) / L;
        const uy = (b.yPx - a.yPx) / L;
        const ext = v.guide.kind === 'parallel' ? 0 : 400;
        const x0 = v.guide.kind === 'angle' ? a.xPx : a.xPx - ux * ext;
        const y0 = v.guide.kind === 'angle' ? a.yPx : a.yPx - uy * ext;
        const total = L + ext * (v.guide.kind === 'angle' ? 1 : 2);
        for (let d = 0; d < total; d += 12) {
          const d1 = Math.min(total, d + 7);
          g.moveTo(x0 + ux * d, y0 + uy * d).lineTo(x0 + ux * d1, y0 + uy * d1);
        }
        g.stroke({ width: 2, color: ACCENT, alpha: 0.95 });
        if (v.guide.kind === 'angle') {
          g.circle(a.xPx, a.yPx, 4).fill({ color: 0xffffff }).stroke({ width: 2, color: ACCENT });
        }
      }
      this.guideText.text = v.guide.label;
      const p = S(v.point.xM, v.point.yM);
      this.guideText.position.set(p.xPx + 14, p.yPx - 30);
      this.guideText.visible = true;
    } else this.guideText.visible = false;
    // Znacznik przyciągnięcia.
    const p = S(v.point.xM, v.point.yM);
    if (v.hit) {
      if (v.hit.kind === 'point') {
        g.circle(p.xPx, p.yPx, 10).stroke({ width: 5, color: 0xffffff, alpha: 0.9 });
        g.circle(p.xPx, p.yPx, 10).stroke({ width: 2.5, color: ACCENT });
        g.circle(p.xPx, p.yPx, 3).fill({ color: ACCENT });
      } else {
        g.poly([p.xPx, p.yPx - 9, p.xPx + 9, p.yPx, p.xPx, p.yPx + 9, p.xPx - 9, p.yPx]).fill({ color: ACCENT, alpha: 0.35 }).stroke({ width: 2.5, color: ACCENT });
      }
      if (!v.guide) {
        this.guideText.text = v.hit.label;
        this.guideText.position.set(p.xPx + 14, p.yPx - 30);
        this.guideText.visible = true;
      }
    }
    // Okienko z długością, kosztem, nachyleniem i ostrzeżeniami.
    const info = v.info.join('\n');
    const warn = v.warn.join('\n');
    this.infoText.text = info;
    this.warnText.text = warn;
    const box = this.box.clear();
    if (!info && !warn) {
      this.infoText.visible = this.warnText.visible = false;
      return;
    }
    this.infoText.visible = !!info;
    this.warnText.visible = !!warn;
    const x = cursor.xPx + 22;
    const y = cursor.yPx + 22;
    const w = Math.max(info ? this.infoText.width : 0, warn ? this.warnText.width : 0) + 16;
    const h = (info ? this.infoText.height : 0) + (warn ? this.warnText.height + (info ? 4 : 0) : 0) + 12;
    // Poza ekranem – na lewo / w górę od kursora.
    const bx = x + w > camera.viewportWidthPx ? cursor.xPx - 22 - w : x;
    const by = y + h > camera.viewportHeightPx ? cursor.yPx - 22 - h : y;
    box.roundRect(bx, by, w, h, 8).fill({ color: 0x141f2b, alpha: 0.92 }).stroke({ width: 1, color: warn ? BAD : 0xffffff, alpha: warn ? 0.9 : 0.12 });
    this.infoText.position.set(bx + 8, by + 6);
    this.warnText.position.set(bx + 8, by + 6 + (info ? this.infoText.height + 4 : 0));
  }
}
