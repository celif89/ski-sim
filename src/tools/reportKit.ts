/**
 * Wspólne elementy raportów HTML (klimat, zima): formatowanie liczb, PNG bez bibliotek,
 * proste wykresy SVG.
 */
import { deflateSync } from 'node:zlib';

export const MONTH_NAMES = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
export const MONTH_SHORT = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export const fmt = (x: number, digits = 1) => x.toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ------------------------------------------------------------------ PNG (bez bibliotek)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(width: number, height: number, rgba: Uint8Array): string {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ------------------------------------------------------------------ wykresy SVG

export interface Series {
  name: string;
  values: number[];
  color: string;
  kind: 'bar' | 'line';
  errors?: number[];
}

export function niceStep(range: number, target: number): number {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Wykres kategorii (miesięcy): słupki obok siebie i/lub linie z punktami. */
export function categoryChart(categories: string[], series: Series[], unit: string, opts: { width?: number; height?: number; zeroBased?: boolean } = {}): string {
  const W = opts.width ?? 420;
  const H = opts.height ?? 250;
  const pad = { l: 50, r: 12, t: 20, b: 30 };
  const all = series.flatMap((s) => s.values.map((v, i) => [v - (s.errors?.[i] ?? 0), v + (s.errors?.[i] ?? 0)]).flat());
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (opts.zeroBased) lo = Math.min(0, lo);
  const step = niceStep(hi - lo || 1, 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const y = (v: number) => pad.t + ph * (1 - (v - lo) / (hi - lo));
  const cw = pw / categories.length;
  const bars = series.filter((s) => s.kind === 'bar');
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    svg += `<text x="${pad.l - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${fmt(v, step < 1 ? 1 : 0)}</text>`;
  }
  if (lo < 0 && hi > 0) svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" class="zero"/>`;
  categories.forEach((c, i) => {
    svg += `<text x="${pad.l + cw * (i + 0.5)}" y="${H - 8}" class="tick" text-anchor="middle">${c}</text>`;
  });
  const bw = (cw * 0.7) / Math.max(1, bars.length);
  bars.forEach((s, si) => {
    s.values.forEach((v, i) => {
      const x = pad.l + cw * i + cw * 0.15 + bw * si;
      const y0 = y(Math.max(lo, Math.min(0, hi)));
      const yv = y(v);
      svg += `<rect x="${x}" y="${Math.min(y0, yv)}" width="${bw - 2}" height="${Math.abs(y0 - yv)}" rx="2" fill="${s.color}"><title>${s.name}: ${fmt(v)} ${unit}</title></rect>`;
      if (s.errors) {
        const cx = x + (bw - 2) / 2;
        svg += `<line x1="${cx}" x2="${cx}" y1="${y(v - s.errors[i])}" y2="${y(v + s.errors[i])}" class="err"/>`;
      }
    });
  });
  for (const s of series.filter((x) => x.kind === 'line')) {
    const pts = s.values.map((v, i) => `${pad.l + cw * (i + 0.5)},${y(v)}`);
    svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
    s.values.forEach((v, i) => {
      const cx = pad.l + cw * (i + 0.5);
      if (s.errors) svg += `<line x1="${cx}" x2="${cx}" y1="${y(v - s.errors[i])}" y2="${y(v + s.errors[i])}" stroke="${s.color}" stroke-width="1.5"/>`;
      svg += `<circle cx="${cx}" cy="${y(v)}" r="4" fill="${s.color}" stroke="var(--bg)" stroke-width="2"><title>${s.name}: ${fmt(v)} ${unit}</title></circle>`;
    });
  }
  svg += `<text x="${pad.l}" y="${pad.t - 2}" class="unit">${unit}</text></svg>`;
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
  return `<div class="legend">${legend}</div>${svg}`;
}
