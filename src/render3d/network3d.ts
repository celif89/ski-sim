/**
 * Etap 3D-1: w widoku 3D wszystko, co rysuje mapa 2D (`ResortLayer`): drogi publiczne i parkingi
 * z OSM, granica, potoki, szlaki PTTK (latem), nazwy miejsc; z układu ośrodka – drogi dojazdowe,
 * rurociągi i hydranty, rowy zbierające, trasy letnie, znaczki baz i budynków, place budowy;
 * zaznaczenie na pomarańczowo (jak w 2D) i podglądy rysowania (warstwa „za wzgórzem” przerywana).
 * Kolory i szerokości jak w 2D; dane z tego samego stanu rysowania (`ResortDrawState`).
 */
import * as THREE from 'three';
import type { SnowUniforms } from './terrain3d';
import type { ResortDrawState } from '../render/resortLayer';
import { liftPath } from '../sim/lifts';
import type { P2 } from './lines3d';
import { LineBatch } from './lines3d';

export interface NetworkStatic {
  /** Drogi publiczne z OSM (współrzędne lokalne) i szerokość jezdni [m]. */
  roads: { points: P2[]; widthM: number; track: boolean }[];
  parkings: P2[][];
  streams: { points: P2[]; meanFlowM3s: number[]; osm: boolean }[];
  hiking: { colour: string; points: P2[] }[];
  border: P2[][];
  places: { name: string; xM: number; yM: number; peak: boolean }[];
}

const SELECT = 0xff7a1a;
const PIPE = 0x1c7ed6;
const SUPPLY = 0x0c8599;
const HIKING: Record<string, number> = { red: 0xd62828, blue: 0x1d4ed8, green: 0x2b8a3e, yellow: 0xf2c200, black: 0x111111 };
const BIKE = [0x2f9e44, 0x1c7ed6, 0xe03131, 0x212529];
const PISTE = [0x2f9e44, 0x1c7ed6, 0xe03131, 0x212529];
const BADGE: Record<string, [number, string]> = {
  parking: [0x2563eb, 'P'],
  gastronomy: [0xd9480f, 'G'],
  bar: [0xe8590c, 'B'],
  rental: [0x7048e8, 'W'],
  school: [0x2b8a3e, 'S'],
  intake: [0x1971c2, 'U'],
  mains: [0x1864ab, 'Wd'],
  well100: [0x0b7285, 'St'],
  well200: [0x0b7285, 'St'],
  reservoir20: [0x1864ab, 'Z'],
  reservoir50: [0x1864ab, 'Z'],
  reservoir100: [0x1864ab, 'Z'],
  pump150: [0x0b7285, 'Pm'],
  pump300: [0x0b7285, 'Pm'],
  pump600: [0x0b7285, 'Pm'],
  grid500: [0xe67700, 'E'],
  grid1000: [0xe67700, 'E'],
  grid2000: [0xe67700, 'E'],
  garage: [0x495057, 'R'],
  anchor: [0x862e9c, 'K'],
};

/** Znaczek (kółko z literą) – rysunek na płótnie, rozmiar stały na ekranie. */
export function badgeSprite(text: string, color: number, sizeNdc = 0.03, ring = 0xffffff): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.strokeStyle = `#${ring.toString(16).padStart(6, '0')}`;
  g.lineWidth = 9;
  g.beginPath();
  g.roundRect(8, 8, 80, 80, 20);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `bold ${text.length > 1 ? 40 : 52}px "Barlow Condensed", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 48, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  s.scale.set(sizeNdc, sizeNdc, 1);
  s.renderOrder = 20;
  return s;
}

/** Napis (nazwa miejsca) z białą obwódką. */
function textSprite(text: string, size: number, color = '#1e293b'): THREE.Sprite {
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d')!;
  const font = `600 44px "Barlow Condensed", sans-serif`;
  g0.font = font;
  const w = Math.ceil(g0.measureText(text).width) + 24;
  c.width = w;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#ffffff';
  g.strokeText(text, w / 2, 34);
  g.fillStyle = color;
  g.fillText(text, w / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  s.scale.set((size * w) / 64, size, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 19;
  return s;
}

export class Network3D {
  readonly group = new THREE.Group();
  private readonly fixed: LineBatch;
  private readonly layoutLines: LineBatch;
  private readonly draft: LineBatch;
  private readonly hikingLines: LineBatch;
  private readonly badges = new THREE.Group();
  private readonly hydrants: THREE.InstancedMesh;
  private lastVersion = -1;
  private lastDraw = -1;
  private summer = false;

  constructor(
    private readonly groundAt: (x: number, z: number) => number,
    data: NetworkStatic,
    snowU?: SnowUniforms,
  ) {
    this.fixed = new LineBatch(groundAt, false, 1, snowU);
    this.hikingLines = new LineBatch(groundAt, false, 2, snowU);
    this.layoutLines = new LineBatch(groundAt, false, 3, snowU);
    this.draft = new LineBatch(groundAt, true, 4, snowU);
    this.group.add(this.fixed.group, this.hikingLines.group, this.layoutLines.group, this.draft.group, this.badges);
    const hg = new THREE.CylinderGeometry(0.25, 0.3, 1.2, 6);
    hg.translate(0, 0.6, 0);
    this.hydrants = new THREE.InstancedMesh(hg, new THREE.MeshStandardMaterial({ color: 0x1c7ed6, roughness: 0.6 }), 2000);
    this.hydrants.count = 0;
    this.hydrants.frustumCulled = false;
    this.group.add(this.hydrants);
    this.buildStatic(data);
  }

  private buildStatic(d: NetworkStatic): void {
    const f = this.fixed;
    f.clear();
    for (const p of d.parkings) f.addFill(p, 0xc9d2dc);
    for (const r of [...d.roads].sort((a, b) => a.widthM - b.widthM)) {
      f.addLine(r.points, { color: r.track ? 0xa7b1bb : 0x7d8792, widthM: r.widthM, minPx: r.track ? 1.2 : 2 }, 8);
    }
    for (const s of d.streams) {
      const q = s.meanFlowM3s.reduce((a, b) => a + b, 0) / Math.max(1, s.meanFlowM3s.length);
      f.addLine(s.points, { color: s.osm ? 0x3b8fd9 : 0x74b4ec, widthM: Math.min(5, 1.2 + 25 * q), minPx: 1.5 + Math.min(1.5, 12 * q) }, 8);
    }
    for (const b of d.border) f.addLine(b, { color: 0xb91c1c, widthM: 2, minPx: 2, dashPx: [8, 6] }, 10);
    f.commit();
    const h = this.hikingLines;
    h.clear();
    for (const l of d.hiking) h.addLine(l.points, { color: 0xffffff, widthM: 2.5, minPx: 4 }, 8);
    for (const l of d.hiking) h.addLine(l.points, { color: HIKING[l.colour] ?? 0xd62828, widthM: 1.5, minPx: 2.2, dashPx: [7, 5] }, 8);
    h.commit();
    h.group.visible = false;
    for (const p of d.places) {
      const y = this.groundAt(p.xM, p.yM);
      if (!Number.isFinite(y)) continue;
      const s = textSprite(p.name, p.peak ? 0.022 : 0.019);
      s.position.set(p.xM, y + 25, p.yM);
      this.group.add(s);
    }
  }

  setSummer(on: boolean): void {
    this.summer = on;
    this.hikingLines.group.visible = on;
  }

  setFrame(pxScale: number, mppTarget: number, fog: THREE.FogExp2 | null): void {
    for (const b of [this.fixed, this.hikingLines, this.layoutLines, this.draft]) b.setFrame(pxScale, mppTarget, fog);
  }

  /** Co klatkę: przebudowa warstwy układu przy zmianie wersji, podglądów – przy zmianie rysunku. */
  update(st: ResortDrawState | null): void {
    if (!st) return;
    if (st.version !== this.lastVersion) {
      this.lastVersion = st.version;
      this.lastDraw = -1;
      this.buildLayout(st);
    }
    if (st.drawVersion !== this.lastDraw) {
      this.lastDraw = st.drawVersion;
      this.buildDraft(st);
    }
  }

  private buildLayout(st: ResortDrawState): void {
    const L = this.layoutLines;
    L.clear();
    const lay = st.layout;
    for (const r of lay.roads ?? []) {
      L.addLine(r.points, { color: 0xffffff, widthM: 7, minPx: 4.5 });
      L.addLine(r.points, { color: 0x6b7280, widthM: 5, minPx: 3 });
    }
    for (const d of lay.ditches ?? []) L.addLine(d.points, { color: 0x2563eb, widthM: 1.5, minPx: 2.5, dashPx: [7, 4] }, 4);
    for (const t of lay.trails ?? []) {
      const a = st.analysis.trails?.get(t.id);
      const pts = a && a.axis.length > 1 ? a.axis : t.points;
      if (t.kind === 'bike') {
        L.addLine(pts, { color: 0xffffff, widthM: 3, minPx: 5 }, 4);
        L.addLine(pts, { color: BIKE[Math.max(0, a?.classIndex ?? 1)], widthM: 1.8, minPx: 3, dashPx: [9, 5] }, 4);
      } else if (t.kind === 'walk') {
        L.addLine(pts, { color: 0xffffff, widthM: 2.5, minPx: 4.5 }, 4);
        L.addLine(pts, { color: 0x8d5524, widthM: 1.4, minPx: 2.5, dashPx: [4, 4] }, 4);
      } else {
        L.addLine(pts, { color: 0x64748b, widthM: 2.4, minPx: 6 }, 4);
        L.addLine(pts, { color: 0xe2e8f0, widthM: 1.6, minPx: 4 }, 4);
        L.addLine(pts, { color: 0xdc2626, widthM: 0.4, minPx: 1.5 }, 4);
      }
    }
    for (const p of lay.pipelines ?? []) {
      L.addLine(p.points, { color: 0xffffff, widthM: 1.6, minPx: 4.5 }, 6);
      L.addLine(p.points, { color: p.supply ? SUPPLY : PIPE, widthM: 0.9, minPx: 2.5 }, 6);
    }
    L.commit();
    // Hydranty (słupki) i znaczki baz / budynków.
    const hyd = st.snowNet?.hydrants ?? [];
    const m = new THREE.Matrix4();
    let n = 0;
    for (const h of hyd) {
      if (h.gunId || n >= 2000) continue;
      const y = this.groundAt(h.xM, h.yM);
      if (!Number.isFinite(y)) continue;
      m.makeTranslation(h.xM, y, h.yM);
      this.hydrants.setMatrixAt(n++, m);
    }
    this.hydrants.count = n;
    this.hydrants.instanceMatrix.needsUpdate = true;
    for (const c of [...this.badges.children]) {
      this.badges.remove(c);
      const s = c as THREE.Sprite;
      s.material.map?.dispose();
      s.material.dispose();
    }
    for (const b of [...lay.bases, ...(lay.buildings ?? [])] as { id: string; xM: number; yM: number; typeId?: string }[]) {
      const [color, letter] = BADGE[b.typeId ?? 'parking'] ?? BADGE.parking;
      const y = this.groundAt(b.xM, b.yM);
      if (!Number.isFinite(y)) continue;
      const s = badgeSprite(letter, color, 0.026);
      s.position.set(b.xM, y + 12, b.yM);
      s.userData = { kind: 'base', id: b.id };
      this.badges.add(s);
    }
    // Place budowy (etap 6): pomarańczowy znaczek z postępem.
    for (const [id, prog] of st.construction ?? []) {
      const at = constructionPoint(st, id);
      if (!at) continue;
      const y = this.groundAt(at.xM, at.yM);
      if (!Number.isFinite(y)) continue;
      const s = badgeSprite(`${Math.round(prog * 100)}%`, 0xf59f00, 0.032);
      s.position.set(at.xM, y + 20, at.yM);
      this.badges.add(s);
    }
  }

  private buildDraft(st: ResortDrawState): void {
    const D = this.draft;
    D.clear();
    const sel = st.selection;
    const lay = st.layout;
    // Zaznaczenie – pomarańczowa obwódka obiektu (jak w 2D).
    if (sel) {
      const S = { color: SELECT, widthM: 3, minPx: 5 };
      if (sel.kind === 'road') {
        const r = lay.roads?.find((x) => x.id === sel.id);
        if (r) D.addLine(r.points, { ...S, widthM: 9 });
      } else if (sel.kind === 'pipeline') {
        const p = lay.pipelines?.find((x) => x.id === sel.id);
        if (p) D.addLine(p.points, S, 6);
      } else if (sel.kind === 'ditch') {
        const p = lay.ditches?.find((x) => x.id === sel.id);
        if (p) D.addLine(p.points, S, 4);
      } else if (sel.kind === 'trail') {
        const p = lay.trails?.find((x) => x.id === sel.id);
        if (p) D.addLine(st.analysis.trails?.get(p.id)?.axis ?? p.points, S, 4);
      } else if (sel.kind === 'piste') {
        const a = st.analysis.pistes.get(sel.id);
        const p = lay.pistes.find((x) => x.id === sel.id);
        if (p) D.addLine(a?.axis.length ? a.axis : p.points, { color: SELECT, widthM: 4, minPx: 5 }, 6);
      } else if (sel.kind === 'lift') {
        const l = lay.lifts.find((x) => x.id === sel.id);
        if (l) D.addLine(liftPath(l), { color: SELECT, widthM: 3, minPx: 5 }, 6);
      } else if (sel.kind === 'base') {
        const b = [...lay.bases, ...(lay.buildings ?? [])].find((x) => x.id === sel.id);
        if (b) D.addRing(b.xM, b.yM, 18, { color: SELECT, widthM: 2.5, minPx: 4 });
      } else if (sel.kind === 'gun') {
        const h = st.snowNet?.hydrants.find((x) => x.gunId === sel.id);
        if (h) D.addRing(h.xM, h.yM, 6, { color: SELECT, widthM: 1.5, minPx: 4 });
      }
    }
    // Podglądy rysowania (etap 3D-2 używa tych samych danych co 2D).
    const draftStyle = (color: number) => ({ color, widthM: 2.5, minPx: 4 });
    if (st.draftPiste?.points.length) {
      // Trasa w budowie: pas o szerokości trasy w kolorze klasy (z analizy) i jaśniejsza oś.
      const a = st.draftPiste.analysis;
      const pts = st.draftPiste.points;
      const w = pts.reduce((acc, q) => acc + (q.widthM || 0), 0) / pts.length || 20;
      const col = a ? (PISTE[a.classIndex] ?? 0x1c7ed6) : 0x1c7ed6;
      D.addLine(pts, { color: col, widthM: w, minPx: 6 }, 5);
      D.addLine(pts, { color: 0xffffff, widthM: 0.8, minPx: 1.5, dashPx: [6, 6] }, 5);
    }
    if (st.draftLift) D.addLine(liftPath(st.draftLift.design), draftStyle(st.draftLift.analysis.ok ? 0xffffff : 0xdc2626), 5);
    if (st.roadDraft?.points.length) D.addLine(st.roadDraft.points, draftStyle(0x6b7280), 5);
    if (st.trailDraft?.points.length) D.addLine(st.trailDraft.points, draftStyle(st.trailDraft.kind === 'bike' ? 0x1c7ed6 : st.trailDraft.kind === 'walk' ? 0x8d5524 : 0xdc2626), 5);
    if (st.snowNet?.draftPipe.length) D.addLine(st.snowNet.draftPipe, draftStyle(PIPE), 5);
    D.commit();
  }

  /** Zaznaczony / najbliższy znaczek budynku (wybór kliknięciem). */
  get badgeSprites(): THREE.Object3D[] {
    return this.badges.children;
  }

  get summerOn(): boolean {
    return this.summer;
  }
}

/** Położenie znaczka placu budowy dla obiektu z identyfikatorem `id`. */
function constructionPoint(st: ResortDrawState, id: string): P2 | null {
  const lay = st.layout;
  const b = [...lay.bases, ...(lay.buildings ?? [])].find((x) => x.id === id);
  if (b) return b;
  const l = lay.lifts.find((x) => x.id === id);
  if (l) return l.bottom;
  const p = lay.pistes.find((x) => x.id === id);
  if (p) return p.points[0];
  for (const arr of [lay.roads ?? [], lay.pipelines ?? [], lay.ditches ?? [], lay.trails ?? []] as { id: string; points: P2[] }[][]) {
    const x = arr.find((q) => q.id === id);
    if (x) return x.points[Math.floor(x.points.length / 2)];
  }
  return null;
}
