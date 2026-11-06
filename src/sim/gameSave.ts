/**
 * Zapis gry (etap 6): pełny stan świata – stan ekonomii (GameState), układ ośrodka i przejazdy gości
 * z kolejnych dni bieżącego sezonu (model śniegu liczy się od nowa z tej samej pogody i tych samych
 * przejazdów, więc dalszy przebieg jest identyczny). Przejazdy zapisane rzadko (tylko komórki z ruchem).
 */
import type { GameState } from './economy';
import type { ResortLayout } from './resort';
import { parseLayout } from './resort';
import type { SnowOps } from './snowOps';

export interface GameSave {
  kind: 'ski-sim-save';
  version: 1;
  savedAt: string;
  mapName: string;
  state: GameState;
  layout: ResortLayout;
  /** Przejazdy dnia (RRRR-MM-DD → zakodowane komórki i wartości). */
  traffic: Record<string, string>;
  /** Etap 7: naśnieżanie i ratrakowanie z kolejnych dni (zakodowane jak przejazdy). */
  ops?: Record<string, { add: string | null; density: number; liquid: number; group: string | null; mode: string | null }>;
}

export function encodeOps(o: SnowOps): NonNullable<GameSave['ops']>[string] {
  return {
    add: o.addSweMm ? encodeTraffic(o.addSweMm) : null,
    density: o.addDensityKgM3,
    liquid: o.addLiquidFraction,
    group: o.groomGroup ? encodeTraffic(Float32Array.from(o.groomGroup)) : null,
    mode: o.groomMode ? encodeTraffic(Float32Array.from(o.groomMode)) : null,
  };
}

export function decodeOps(e: NonNullable<GameSave['ops']>[string]): SnowOps {
  return {
    addSweMm: e.add ? decodeTraffic(e.add) : null,
    addDensityKgM3: e.density,
    addLiquidFraction: e.liquid,
    groomGroup: e.group ? Int16Array.from(decodeTraffic(e.group)) : null,
    groomMode: e.mode ? Uint8Array.from(decodeTraffic(e.mode)) : null,
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=') + (i + 2 < bytes.length ? B64[c & 63] : '=');
  }
  return out;
}

function b64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Przejazdy: pary (indeks komórki, wartość) tylko dla komórek z ruchem – Uint32 + Float32. */
export function encodeTraffic(passes: Float32Array): string {
  let n = 0;
  for (let k = 0; k < passes.length; k++) if (passes[k] !== 0) n++;
  const idx = new Uint32Array(n);
  const val = new Float32Array(n);
  let j = 0;
  for (let k = 0; k < passes.length; k++) {
    if (passes[k] !== 0) {
      idx[j] = k;
      val[j] = passes[k];
      j++;
    }
  }
  const bytes = new Uint8Array(4 + n * 8);
  new DataView(bytes.buffer).setUint32(0, passes.length, true);
  bytes.set(new Uint8Array(idx.buffer), 4);
  bytes.set(new Uint8Array(val.buffer), 4 + n * 4);
  return bytesToB64(bytes);
}

export function decodeTraffic(s: string): Float32Array {
  const bytes = b64ToBytes(s);
  const len = new DataView(bytes.buffer).getUint32(0, true);
  const n = (bytes.length - 4) / 8;
  const idx = new Uint32Array(bytes.slice(4, 4 + n * 4).buffer);
  const val = new Float32Array(bytes.slice(4 + n * 4, 4 + n * 8).buffer);
  const out = new Float32Array(len);
  for (let j = 0; j < n; j++) out[idx[j]] = val[j];
  return out;
}

export function makeSave(state: GameState, layout: ResortLayout, traffic: Map<string, Float32Array>, mapName: string, savedAt: string, ops: Map<string, SnowOps> | null = null): GameSave {
  const t: Record<string, string> = {};
  for (const [k, v] of traffic) t[k] = encodeTraffic(v);
  const o: NonNullable<GameSave['ops']> = {};
  if (ops) for (const [k, v] of ops) o[k] = encodeOps(v);
  return { kind: 'ski-sim-save', version: 1, savedAt, mapName, state: JSON.parse(JSON.stringify(state)) as GameState, layout: JSON.parse(JSON.stringify(layout)) as ResortLayout, traffic: t, ops: o };
}

/** Odczyt zapisu z kontrolą formatu. */
export function parseSave(raw: unknown): { state: GameState; layout: ResortLayout; traffic: Map<string, Float32Array>; ops: Map<string, SnowOps>; mapName: string } {
  const r = raw as Partial<GameSave>;
  if (!r || r.kind !== 'ski-sim-save' || r.version !== 1 || !r.state || !r.layout) throw new Error('To nie jest plik zapisu gry (ski-sim-save, wersja 1).');
  const st = r.state;
  if (st.version !== 1 || (st.mode !== 'career' && st.mode !== 'sandbox') || typeof st.balancePln !== 'number' || !st.date) throw new Error('Plik zapisu gry: uszkodzony stan.');
  const traffic = new Map<string, Float32Array>();
  for (const [k, v] of Object.entries(r.traffic ?? {})) traffic.set(k, decodeTraffic(v));
  const ops = new Map<string, SnowOps>();
  for (const [k, v] of Object.entries(r.ops ?? {})) ops.set(k, decodeOps(v));
  return { state: JSON.parse(JSON.stringify(st)) as GameState, layout: parseLayout(r.layout), traffic, ops, mapName: r.mapName ?? 'pilsko' };
}
