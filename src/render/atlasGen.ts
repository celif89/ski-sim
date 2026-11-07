/**
 * Etap 7d: generator atlasu postaci, maszyn i części wyciągów z opisu data/atlas.json.
 * Uruchamiany przy budowaniu (wtyczka Vite „virtual:sprite-atlas” w vite.config.ts) – w grze
 * gotowy obraz SVG zamieniany jest na teksturę. Bez DOM i PixiJS (liczony też w testach).
 *
 * Dla każdego obiektu, fazy (np. skręt), kierunku (8 co 45°) i poziomu szczegółowości (3 rozmiary
 * komórki) powstają warstwy: s – cień (sylwetka), b – rysunek, j – kurtka (biała, barwiona kolorem
 * z ziarna; zasłonięta tym, co leży nad kurtką: kask, plecak). Podmiana na rysunki ręczne: wystarczy
 * zmienić opis albo podać gotowy obraz o tym samym układzie klatek.
 */

export interface AtlasShape {
  d: string;
  fill?: string;
  stroke?: string;
  sw?: string;
  minLod?: string;
  over?: boolean;
  group?: string;
  sign?: string;
}

interface Num {
  value: number;
}

export interface AtlasSprite {
  id: string;
  sizeM: Num;
  shadowM: Num;
  lodPx: number[];
  phases: Record<string, string>[];
  shapes: AtlasShape[];
  /** Ile jednostek rysunku mieści się w komórce (domyślnie 115 – kształty w ±50 po obrocie). */
  fit?: Num;
}

export interface AtlasDesc {
  directions: Num;
  lods: Num;
  shadowColor: string;
  outline: string;
  sprites: AtlasSprite[];
}

export interface SpriteMeta {
  sizeM: number;
  shadowM: number;
  lodPx: number[];
  phases: number;
  fit: number;
  hasJacket: boolean;
}

export interface GeneratedAtlas {
  width: number;
  height: number;
  svg: string;
  directions: number;
  lods: number;
  sprites: Record<string, SpriteMeta>;
  /** Klatki: klucz frameKey → [x, y, rozmiar] w pikselach atlasu. */
  frames: Record<string, [number, number, number]>;
}

export type AtlasLayer = 's' | 'b' | 'j';

export function frameKey(id: string, layer: AtlasLayer, phase: number, dir: number, lod: number): string {
  return `${id}|${layer}|${phase}|${dir}|${lod}`;
}

/** Kierunek klatki (0–7, 0 – w górę ekranu, zgodnie z ruchem wskazówek) z kąta ruchu na ekranie (oś y w dół). */
export function directionIndex(screenHeadingRad: number, directions = 8): number {
  const step = (2 * Math.PI) / directions;
  const a = screenHeadingRad + Math.PI / 2;
  return (((Math.round(a / step) % directions) + directions) % directions) | 0;
}

const DEFAULT_FIT = 115;
const ATLAS_WIDTH = 2048;
const PAD = 1;

function shapeSvg(s: AtlasShape, mode: 'shadow' | 'base' | 'jacket' | 'mask', outline: string): string {
  const sw = s.sw ?? '0';
  if (mode === 'shadow') {
    const fill = s.fill && s.fill !== 'none' ? '#000' : 'none';
    return `<path d="${s.d}" fill="${fill}"${s.stroke ? ` stroke="#000" stroke-width="${sw}" stroke-linecap="round"` : ''}/>`;
  }
  if (mode === 'mask') return `<path d="${s.d}" fill="black"${s.stroke ? ` stroke="black" stroke-width="${sw}"` : ''}/>`;
  if (mode === 'jacket') return `<path d="${s.d}" fill="#ffffff"/>`;
  const jacket = s.fill === 'jacket';
  const fill = jacket ? '#cbd5e1' : (s.fill ?? 'none');
  const stroke = jacket ? outline : s.stroke;
  const w = jacket ? '2' : sw;
  return `<path d="${s.d}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`;
}

/** Przekształcenie kształtu w fazie: narty – obrót, tułów – przesunięcie w bok, nogi – wzdłuż. */
function phaseTransform(s: AtlasShape, ph: Record<string, string>): string {
  const g = s.group;
  if (!g || ph[g] === undefined) return '';
  const v = Number(ph[g]) || 0;
  if (g === 'skis') return ` transform="rotate(${v})"`;
  if (g === 'body') return ` transform="translate(${v} 0)"`;
  if (g === 'legs') return ` transform="translate(0 ${v * (Number(s.sign ?? '1') || 1)})"`;
  return '';
}

export function generateAtlas(desc: AtlasDesc): GeneratedAtlas {
  const dirs = desc.directions.value;
  const lods = desc.lods.value;
  type Job = { key: string; size: number; body: string; mask: string | null };
  const jobs: Job[] = [];
  const sprites: Record<string, SpriteMeta> = {};
  for (const sp of desc.sprites) {
    const fit = sp.fit?.value ?? DEFAULT_FIT;
    const hasJacket = sp.shapes.some((s) => s.fill === 'jacket');
    sprites[sp.id] = { sizeM: sp.sizeM.value, shadowM: sp.shadowM.value, lodPx: sp.lodPx.slice(0, lods), phases: sp.phases.length, fit, hasJacket };
    sp.phases.forEach((ph, pi) => {
      for (let lod = 0; lod < lods; lod++) {
        const size = sp.lodPx[Math.min(lod, sp.lodPx.length - 1)];
        const shapes = sp.shapes.filter((s) => Number(s.minLod ?? '0') <= lod);
        // Na najmniejszym poziomie linie grubsze – bez migotania.
        const thick = lod === 0 ? 1.6 : 1;
        const draw = (mode: 'shadow' | 'base' | 'jacket' | 'mask', list: AtlasShape[]) =>
          list.map((s) => `<g${phaseTransform(s, ph)}>${shapeSvg({ ...s, sw: s.sw ? String(Number(s.sw) * thick) : s.sw }, mode, desc.outline)}</g>`).join('');
        for (let d = 0; d < dirs; d++) {
          const rot = (d * 360) / dirs;
          const t = (inner: string) => `<g transform="rotate(${rot}) scale(${(size / fit).toFixed(5)})">${inner}</g>`;
          jobs.push({ key: frameKey(sp.id, 's', pi, d, lod), size, body: `<g fill-opacity="1">${t(draw('shadow', shapes))}</g>`, mask: null });
          jobs.push({ key: frameKey(sp.id, 'b', pi, d, lod), size, body: t(draw('base', shapes)), mask: null });
          if (hasJacket) {
            const over = shapes.filter((s) => s.over);
            jobs.push({ key: frameKey(sp.id, 'j', pi, d, lod), size, body: t(draw('jacket', shapes.filter((s) => s.fill === 'jacket'))), mask: over.length ? t(draw('mask', over)) : null });
          }
        }
      }
    });
  }
  // Pakowanie półkami: najpierw największe komórki.
  jobs.sort((a, b) => b.size - a.size);
  const frames: Record<string, [number, number, number]> = {};
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const j of jobs) {
    const s = j.size + 2 * PAD;
    if (x + s > ATLAS_WIDTH) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    frames[j.key] = [x + PAD, y + PAD, j.size];
    x += s;
    rowH = Math.max(rowH, s);
  }
  const height = y + rowH;
  let defs = '';
  let body = '';
  let m = 0;
  for (const j of jobs) {
    const [fx, fy, s] = frames[j.key];
    const cx = fx + s / 2;
    const cy = fy + s / 2;
    const clip = `<rect x="${fx}" y="${fy}" width="${s}" height="${s}"/>`;
    void clip;
    const isShadow = j.key.split('|')[1] === 's';
    const inner = `<g transform="translate(${cx} ${cy})">${j.body}</g>`;
    if (j.mask) {
      defs += `<mask id="m${m}" maskUnits="userSpaceOnUse" x="${fx}" y="${fy}" width="${s}" height="${s}"><rect x="${fx}" y="${fy}" width="${s}" height="${s}" fill="white"/><g transform="translate(${cx} ${cy})">${j.mask}</g></mask>`;
      body += `<g mask="url(#m${m})">${inner}</g>`;
      m++;
    } else body += isShadow ? `<g opacity="1">${inner}</g>` : inner;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ATLAS_WIDTH}" height="${height}" viewBox="0 0 ${ATLAS_WIDTH} ${height}"><defs>${defs}</defs>${body}</svg>`;
  return { width: ATLAS_WIDTH, height, svg, directions: dirs, lods, sprites, frames };
}
