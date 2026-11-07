/**
 * Etap 7d: śnieg z bliska – rysowanie warstwy detalu 1 m (src/sim/detailLayer.ts) przez kartę
 * graficzną. Okno 1024 × 1024 m wokół widoku trafia do tekstur (wypełniane rzadko: przesunięcie
 * widoku, zmiana danych, co 20 min gry), shader liczy na każdy piksel:
 *  – mapę nierówności: sztruks (prążki wzdłuż przejazdu ratraka, bledną z wiekiem, zacierane
 *    śladami), ślady nart i rozjeżdżony puch, muldy z cieniem (światło ze Słońca z modelu),
 *    pryzmy z armatek, ziarno firnu, breja,
 *  – połysk lodu, przetarcia z trawą i kamieniami.
 * Dwie warstwy: mnożenie (cieniowanie rzeźby i barwa śniegu na kaflach terenu) i zwykła (trawa,
 * kamienie, połysk lodu). Płynne przejścia: tekstury filtrowane liniowo, próg przybliżenia
 * z przenikaniem (data/detail.json, sekcja „render”).
 */
import { BufferImageSource, Geometry, Mesh, Shader } from 'pixi.js';
import type { Container } from 'pixi.js';
import { readNumber, readSection } from '../sim/params';
import type { DetailLayer } from '../sim/detailLayer';
import { TERRAIN_VERTEX } from './terrainShader';

export interface DetailRenderParams {
  fadeStartMpp: number;
  fadeFullMpp: number;
  windowM: number;
  corduroyPeriodM: number;
  corduroyDepthM: number;
  corduroyFadeH: number;
  refreshGameMin: number;
}

export function parseDetailRenderParams(json: unknown): DetailRenderParams {
  const s = readSection(json as Record<string, unknown>, 'render', 'data/detail.json');
  const n = (k: string) => readNumber(s, k, 'data/detail.json', { min: 0 });
  return { fadeStartMpp: n('fadeStartMpp'), fadeFullMpp: n('fadeFullMpp'), windowM: n('windowM'), corduroyPeriodM: n('corduroyPeriodM'), corduroyDepthM: n('corduroyDepthM'), corduroyFadeH: n('corduroyFadeH'), refreshGameMin: n('refreshGameMin') };
}

const NOISE = /* glsl */ `
// Tani skrót całkowitoliczbowy (jedna runda mieszania) – szum tylko do faktur.
float hc(ivec2 c, uint salt) {
  uint h = uint(c.x) * 0x8da6b343u ^ uint(c.y) * 0xd8163841u ^ salt * 0xcb1ab31fu;
  h ^= h >> 13;
  h *= 0x5bd1e995u;
  h ^= h >> 15;
  return float(h & 0xFFFFu) / 65535.0;
}
float vnoise(vec2 p, uint salt) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  return mix(mix(hc(c, salt), hc(c + ivec2(1, 0), salt), u.x), mix(hc(c + ivec2(0, 1), salt), hc(c + ivec2(1, 1), salt), u.x), u.y);
}
`;

/**
 * Tekstury okna: uA – R widoczność sztruksu, G ślady nart, B maska korytarza, A puch;
 * uB – R muldy z warstwy 1 m [m/1] (zapas), G lód, B pryzmy [m/2], A przetarcia; uC – R breja, G firn,
 * B wysokość muld [m] (kształt liczy shader – mogulField);
 * uD (najbliższy sąsiad) – R kierunek sztruksu (0–π).
 */
const DETAIL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
out vec4 fragColor;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform sampler2D uD;
uniform sampler2D uNormals;
uniform vec2 uMapSize;
uniform vec4 uWin;
uniform vec3 uSun;
uniform float uDay;
uniform float uFade;
uniform float uMpp;
uniform float uPeriod;
uniform float uDepth;
uniform vec3 uTint;
uniform float uMogulS;
uniform float uPass;
${NOISE}
vec2 wuv(vec2 p) { return (p - uWin.xy) / uWin.z; }
// Muldy: garby na przemian (pole cos · cos w układzie mapy, odstęp uMogulS – ten sam wzór co
// shapeMoguls w src/sim/detailLayer.ts), lekko zaburzone szumem, żeby nie wyglądały jak kratka.
// Wysokość A [m] z warstwy detalu (płynnie między komórkami 10 m). Zwraca wysokość i gradient.
vec3 mogulField(vec2 p, float A) {
  if (A < 0.005) return vec3(0.0);
  float k = 6.2831853 / uMogulS;
  // Zaburzenie położenia (do ok. 2 m) i wysokości pojedynczych garbów – bez regularnej kratki.
  vec2 w = p + 2.0 * (vec2(vnoise(p * 0.11, 61u), vnoise(p * 0.11, 67u)) - 0.5) * 2.0;
  float amp = A * (1.0 + 0.7 * (vnoise(p * 0.21, 71u) - 0.5));
  float cu = cos(w.x * k), su = sin(w.x * k), cv = cos(w.y * k), sv = sin(w.y * k);
  float h = amp * (0.5 + 0.5 * cu * cv);
  vec2 g = amp * 0.5 * k * vec2(-su * cv, -cu * sv);
  return vec3(h, g);
}
// Wysokość nierówności [m] bez sztruksu i muld (pryzmy, ślady nart, puch, firn, breja). Szum
// liczony tylko tam, gdzie dany stan występuje – piksel czystego, ubitego śniegu jest tani.
float relief(vec2 p, vec2 fall, vec4 a, vec4 b, vec4 c) {
  float h = b.b * 2.0;
  if (a.g > 0.02) {
    // Ślady nart: rowki wzdłuż linii spadku, falujące (skręty).
    float along = dot(p, fall);
    float across = dot(p, vec2(-fall.y, fall.x)) + 1.6 * sin(along * 0.45 + vnoise(p * 0.05, 11u) * 6.0);
    float lane = abs(fract(across / 1.1) - 0.5);
    h -= a.g * (1.0 - smoothstep(0.03, 0.12, lane)) * 0.03;
  }
  // Puch: miękkie fale, rozjeżdżony – grudy.
  float pw = a.a * (1.0 - a.r);
  if (pw > 0.02) h += pw * (0.05 * vnoise(p * 0.35, 3u) + a.g * 0.04 * vnoise(p * 2.2, 9u));
  // Firn – ziarno; breja – nierówne placki.
  if (c.g > 0.02) h += c.g * 0.012 * vnoise(p * 6.0, 21u);
  if (c.r > 0.02) h += c.r * 0.03 * vnoise(p * 1.4, 33u);
  return h;
}
void main() {
  vec2 p = vWorld;
  vec2 uv = wuv(p);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 a = texture(uA, uv);
  float mask = a.b * uFade;
  if (mask < 0.01) discard;
  vec4 b = texture(uB, uv);
  // Warstwa zwykła rysuje tylko trawę, kamienie, połysk lodu i iskrzenie puchu – reszta od razu odpada.
  // Iskrzenie puchu: najpierw tani los (1,5 % punktów), dopiero potem reszta.
  float sparkleOn = a.a * uDay * step(0.985, hc(ivec2(floor(p * 6.0)), 41u));
  if (uPass > 0.5 && b.a < 0.3 && b.g < 0.02 && sparkleOn < 0.01) discard;
  vec4 c = texture(uC, uv);
  vec3 tn = texture(uNormals, p / uMapSize).xyz * 2.0 - 1.0;
  vec2 fall = length(tn.xy) > 0.02 ? normalize(tn.xy) : vec2(0.0, 1.0);
  // Sztruks: prążki w poprzek kierunku ostatniego przejazdu ratraka; pochylenie liczone wprost
  // (pochodna cosinusa), reszta rzeźby – z pochodnych ekranowych (jedno liczenie na piksel).
  float ang = texture(uD, uv).r * 3.14159265;
  vec2 perp = vec2(-sin(ang), cos(ang));
  float kc = 6.2831853 / uPeriod;
  float sc = dot(p, perp) * kc;
  float cordAmt = a.r * (1.0 - a.g) * smoothstep(2.0, 3.5, uPeriod / uMpp);
  float cord = cordAmt * (0.5 + 0.5 * cos(sc));
  vec2 gCord = -cordAmt * 0.5 * kc * sin(sc) * uDepth * perp;
  float h = relief(p, fall, a, b, c);
  vec2 dpx = dFdx(p);
  vec2 dpy = dFdy(p);
  mat2 M = mat2(dpx.x, dpy.x, dpx.y, dpy.y);
  float det = determinant(M);
  vec2 gRel = abs(det) > 1e-12 ? inverse(M) * vec2(dFdx(h), dFdy(h)) : vec2(0.0);
  float mA = c.b;
  vec3 mog = mogulField(p, mA);
  vec2 grad = gRel + gCord + mog.yz;
  vec3 n = normalize(vec3(-grad, 1.0));
  vec3 L = normalize(uSun);
  // Cień muld i pryzm: krótki marsz w stronę Słońca (muldy ze wzoru, pryzmy z tekstury) – miękki.
  float shadow = 1.0;
  float hb = mog.x + b.b * 2.0;
  if (L.z > 0.05 && L.z < 0.9) {
    vec2 sd = normalize(L.xy);
    vec4 probe = texture(uB, wuv(p + sd * 1.8));
    if (mA > 0.02 || b.b > 0.005 || probe.b > 0.005) {
      float rise = L.z / max(0.05, length(L.xy));
      float occ = 0.0;
      for (int i = 1; i <= 5; i++) {
        float t = float(i) * 0.6;
        vec2 q = p + sd * t;
        vec4 bb = texture(uB, wuv(q));
        float hq = mogulField(q, mA).x + bb.b * 2.0;
        occ = max(occ, smoothstep(0.0, 0.1, hq - hb - t * rise));
      }
      shadow = 1.0 - 0.4 * occ;
    }
  }
  float lit = max(0.0, dot(n, L)) * shadow;
  float flat0 = max(0.0, L.z);
  float day = uDay;
  if (uPass < 0.5) {
    // Mnożenie: cieniowanie nierówności względem płaskiego śniegu + barwa stanu śniegu.
    float ratio = mix(1.0, (0.3 + 0.7 * lit) / max(0.2, 0.3 + 0.7 * flat0), day);
    // Bez Słońca (noc, pochmurno) – rzeźba z rozproszonego światła: rowki sztruksu i dna między
    // muldami ciemniejsze (zasłonięte niebo).
    float trough = cordAmt - cord;
    // Dna między muldami – mniej nieba (ciemniej także w cieniu i przy pochmurnym niebie).
    float mTrough = mA > 0.005 ? (1.0 - mog.x / mA) * min(1.0, mA / 0.5) : 0.0;
    float amb = (0.8 + 0.2 * n.z) * (1.0 - 0.10 * trough) * (1.0 - 0.12 * mTrough);
    float f = clamp(mix(amb, ratio * (1.0 - 0.05 * trough), 0.7), 0.45, 1.05);
    vec3 tint = vec3(1.0);
    tint *= mix(vec3(1.0), vec3(0.80, 0.86, 0.88), c.r);       // breja – szaro-niebieska, mokra
    tint *= mix(vec3(1.0), vec3(0.985, 0.975, 0.95), c.g);    // firn – ledwie żółtawy (ziarno w rzeźbie)
    tint *= mix(vec3(1.0), vec3(0.86, 0.92, 0.98), b.g * 0.7); // lód – szklisty
    tint *= mix(vec3(1.0), vec3(0.93, 0.95, 0.99), a.g * 0.5); // ślady – lekko szarawe
    vec3 col = f * tint;
    fragColor = vec4(mix(vec3(1.0), col, mask), 1.0);
    return;
  }
  // Zwykła warstwa: trawa i kamienie w przetarciach, połysk lodu w słońcu.
  float worn = b.a;
  float aBase = 0.0;
  vec3 base = vec3(0.0);
  if (worn > 0.3) {
    // Plamy kształtuje warstwa 1 m (gładki szum) – tu tylko poszarpany brzeg.
    float grass = smoothstep(0.42, 0.58, worn + 0.18 * (vnoise(p * 1.3, 77u) - 0.5));
    float stone = smoothstep(0.7, 0.9, vnoise(p * 1.7, 91u)) * smoothstep(0.5, 0.9, worn);
    vec3 g = mix(vec3(0.42, 0.50, 0.30), vec3(0.55, 0.53, 0.40), vnoise(p * 3.0, 13u));
    vec3 st = mix(vec3(0.45, 0.45, 0.47), vec3(0.62, 0.61, 0.60), vnoise(p * 5.0, 17u));
    base = mix(g, st, stone) * (0.75 + 0.35 * lit);
    aBase = grass * 0.92;
  }
  // Połysk lodu: odbicie Słońca w płaskich, wyślizganych miejscach.
  vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = b.g > 0.02 ? pow(max(0.0, dot(n, hv)), 48.0) * b.g * day * shadow : 0.0;
  float sparkle = sparkleOn * max(0.0, dot(n, L));
  vec3 col = (base * aBase + vec3(1.0, 0.98, 0.93) * (spec * 0.8 + sparkle * 0.7)) * uTint;
  float alpha = clamp(aBase + spec * 0.8 + sparkle * 0.7, 0.0, 1.0);
  if (alpha < 0.01) discard;
  fragColor = vec4(col / max(alpha, 1e-3) * alpha, alpha) * mask;
}
`;

export class DetailRenderer {
  readonly mulMesh: Mesh<Geometry, Shader>;
  readonly overMesh: Mesh<Geometry, Shader>;
  private readonly size: number;
  private readonly a: Uint8Array;
  private readonly b: Uint8Array;
  private readonly c: Uint8Array;
  private readonly d: Uint8Array;
  private readonly srcA: BufferImageSource;
  private readonly srcB: BufferImageSource;
  private readonly srcC: BufferImageSource;
  private readonly srcD: BufferImageSource;
  private winX = -1e9;
  private winY = -1e9;
  private filledVersion = -1;
  private filledGameH = -1e9;
  private filledReal = -1e9;
  private blk = new Float32Array(0);
  /** Pomiar: ostatnie wypełnienie okna [ms]. */
  fillMs = 0;

  constructor(
    world: Container,
    afterIndex: number,
    normals: BufferImageSource,
    mapW: number,
    mapH: number,
    private readonly rp: DetailRenderParams,
  ) {
    this.size = Math.round(rp.windowM);
    const n = this.size * this.size * 4;
    this.a = new Uint8Array(n);
    this.b = new Uint8Array(n);
    this.c = new Uint8Array(n);
    this.d = new Uint8Array(n);
    const src = (data: Uint8Array, nearest = false) => new BufferImageSource({ resource: data, width: this.size, height: this.size, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha', scaleMode: nearest ? 'nearest' : 'linear' });
    this.srcA = src(this.a);
    this.srcB = src(this.b);
    this.srcC = src(this.c);
    this.srcD = src(this.d, true);
    const geom = () =>
      new Geometry({
        attributes: { aPosition: new Float32Array([0, 0, mapW, 0, mapW, mapH, 0, mapH]) },
        indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
      });
    const mk = (pass: number) =>
      new Mesh({
        geometry: geom(),
        shader: Shader.from({
          gl: { vertex: TERRAIN_VERTEX, fragment: DETAIL_FRAGMENT, name: `detail-${pass}` },
          resources: {
            uA: this.srcA,
            uB: this.srcB,
            uC: this.srcC,
            uD: this.srcD,
            uNormals: normals,
            detailUniforms: {
              uMapSize: { value: new Float32Array([mapW, mapH]), type: 'vec2<f32>' },
              uWin: { value: new Float32Array([0, 0, this.size, 1 / this.size]), type: 'vec4<f32>' },
              uSun: { value: new Float32Array([0.3, 0.3, 0.6]), type: 'vec3<f32>' },
              uDay: { value: 1, type: 'f32' },
              uFade: { value: 0, type: 'f32' },
              uMpp: { value: 1, type: 'f32' },
              uPeriod: { value: rp.corduroyPeriodM, type: 'f32' },
              uDepth: { value: rp.corduroyDepthM, type: 'f32' },
              uTint: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
              uMogulS: { value: 5, type: 'f32' },
              uPass: { value: pass, type: 'f32' },
            },
          },
        }),
      });
    this.mulMesh = mk(0);
    this.mulMesh.blendMode = 'multiply';
    this.overMesh = mk(1);
    world.addChildAt(this.mulMesh, afterIndex);
    world.addChildAt(this.overMesh, afterIndex + 1);
    this.mulMesh.visible = false;
    this.overMesh.visible = false;
  }

  private uni(m: Mesh<Geometry, Shader>): Record<string, unknown> {
    return (m.shader!.resources.detailUniforms as { uniforms: Record<string, unknown> }).uniforms;
  }

  get visible(): boolean {
    return this.mulMesh.visible;
  }

  /** Udział detalu przy danym przybliżeniu (0 – brak, 1 – pełny). */
  fadeFor(mpp: number): number {
    const t = (this.rp.fadeStartMpp - mpp) / Math.max(1e-6, this.rp.fadeStartMpp - this.rp.fadeFullMpp);
    return Math.max(0, Math.min(1, t));
  }

  /**
   * Co klatkę: widoczność, światło, a gdy trzeba – nowe okno tekstur (środek widoku, wersja danych,
   * czas gry). sunDir – kierunek do Słońca na mapie (x w prawo, y w dół = na południe, z w górę).
   */
  update(layer: DetailLayer, centerXM: number, centerYM: number, mpp: number, gameH: number, sunDir: [number, number, number], day: number, tint: number): void {
    const fade = this.fadeFor(mpp);
    const show = fade > 0 && layer.blockCount > 0;
    this.mulMesh.visible = show;
    this.overMesh.visible = show;
    if (!show) return;
    const half = this.size / 2;
    const moved = Math.abs(centerXM - (this.winX + half)) > this.size * 0.2 || Math.abs(centerYM - (this.winY + half)) > this.size * 0.2;
    const stale = layer.version !== this.filledVersion && Math.abs(gameH - this.filledGameH) * 60 >= Math.min(2, this.rp.refreshGameMin);
    const realOk = performance.now() - this.filledReal > 400;
    if (moved || (realOk && (stale || Math.abs(gameH - this.filledGameH) * 60 >= this.rp.refreshGameMin))) {
      this.filledReal = performance.now();
      this.fill(layer, Math.round(centerXM - half), Math.round(centerYM - half), gameH);
    }
    for (const m of [this.mulMesh, this.overMesh]) {
      const u = this.uni(m);
      (u.uWin as Float32Array).set([this.winX, this.winY, this.size, 1 / this.size]);
      (u.uSun as Float32Array).set(sunDir);
      u.uDay = day;
      u.uFade = fade;
      u.uMpp = mpp;
      u.uMogulS = layer.p.mogulSpacingM;
    }
    // Mnożenie jest względne (kafle terenu mają już barwę światła); trawa i połysk – w barwie światła.
    (this.uni(this.mulMesh).uTint as Float32Array).set([1, 1, 1]);
    (this.uni(this.overMesh).uTint as Float32Array).set([((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255]);
  }

  /** Wypełnienie okna tekstur z warstwy 1 m (tylko bloki korytarzy w oknie). */
  private fill(layer: DetailLayer, x0: number, y0: number, gameH: number): void {
    const t0 = performance.now();
    this.winX = x0;
    this.winY = y0;
    this.filledVersion = layer.version;
    this.filledGameH = gameH;
    this.a.fill(0);
    this.b.fill(0);
    this.c.fill(0);
    this.d.fill(0);
    const S = this.size;
    const g = layer.grid;
    const cs = g.cellSizeM;
    const sub = layer.sub;
    const cm = layer.p.cellM;
    const fadeH = this.rp.corduroyFadeH;
    const W = g.widthCells;
    const H = g.heightCells;
    // Wartości komórek 10 m (stan powierzchni, lód) przenikają się dwuliniowo między środkami
    // komórek – bez kwadratów; brzeg korytarza wygasa w pasie pierścienia.
    const nb = layer.cells.length;
    if (this.blk.length !== nb * 6) this.blk = new Float32Array(nb * 6);
    const blk = this.blk;
    for (let bi = 0; bi < nb; bi++) {
      const q = layer.surface[bi];
      blk[bi * 6] = 1;
      blk[bi * 6 + 1] = q === 1 ? 1 : q === 2 ? 0.47 : 0;
      blk[bi * 6 + 2] = q === 5 ? 1 : 0;
      blk[bi * 6 + 3] = q === 4 ? 1 : 0;
      blk[bi * 6 + 4] = layer.ice[bi * layer.per] / 255;
      // Wysokość muld [m] (garb) = indeks · maks. wysokość – kształt rysuje shader.
      blk[bi * 6 + 5] = layer.mogulIndex[bi] * layer.p.mogulMaxHeightM;
    }
    const out = [0, 0, 0, 0, 0, 0];
    const bil = (xM: number, yM: number, own: number) => {
      const gx = xM / cs - 0.5;
      const gy = yM / cs - 0.5;
      const ia = Math.floor(gx);
      const ja = Math.floor(gy);
      const tx = gx - ia;
      const ty = gy - ja;
      out.fill(0);
      for (let c = 0; c < 4; c++) {
        const ii = ia + (c & 1);
        const jj = ja + (c >> 1);
        const w = ((c & 1) ? tx : 1 - tx) * ((c >> 1) ? ty : 1 - ty);
        const nbk = ii < 0 || jj < 0 || ii >= W || jj >= H ? -1 : layer.blockOf[jj * W + ii];
        // Poza korytarzem: maska 0, stan jak w komórce własnej (bez ciemnych/jasnych obwódek).
        const src = nbk >= 0 ? nbk : own;
        out[0] += w * (nbk >= 0 ? 1 : 0);
        for (let ch = 1; ch < 6; ch++) out[ch] += w * blk[src * 6 + ch];
      }
    };
    for (let bi = 0; bi < nb; bi++) {
      const k = layer.cells[bi];
      const bx = (k % W) * cs;
      const by = Math.floor(k / W) * cs;
      if (bx + cs < x0 || by + cs < y0 || bx >= x0 + S || by >= y0 + S) continue;
      for (let r = 0; r < layer.per; r++) {
        const wx = bx + ((r % sub) + 0.5) * cm;
        const wy = by + (Math.floor(r / sub) + 0.5) * cm;
        const px = Math.floor(wx) - x0;
        const py = Math.floor(wy) - y0;
        if (px < 0 || py < 0 || px >= S || py >= S) continue;
        bil(wx, wy, bi);
        const idx = bi * layer.per + r;
        const o = (py * S + px) * 4;
        const age = gameH - layer.groomT[idx];
        const vis = age >= 0 && age < 1e8 ? Math.exp(-age / fadeH) : 0;
        const fresh = layer.fresh[idx] / 255;
        this.a[o] = Math.round(255 * vis * (1 - fresh));
        this.a[o + 1] = layer.tracks[idx];
        // Maska: pełna w środku korytarza, wygasa do zera na zewnętrznej krawędzi bloku brzegowego.
        const mk = Math.min(1, Math.max(0, (out[0] - 0.5) / 0.4));
        this.a[o + 2] = Math.round(255 * mk * mk * (3 - 2 * mk));
        this.a[o + 3] = Math.max(Math.round(255 * out[1]), layer.fresh[idx]);
        this.b[o] = Math.min(255, Math.round(layer.mogul[idx] * 255));
        this.b[o + 1] = Math.round(255 * out[4]);
        // Pryzma: mm wody → wysokość śniegu technicznego (ok. 500 kg/m³) [m], skala 0–2 m.
        this.b[o + 2] = Math.min(255, Math.round(((layer.pile[idx] / 500) / 2) * 255));
        this.b[o + 3] = layer.worn[idx];
        this.c[o] = Math.round(255 * out[2]);
        this.c[o + 1] = Math.round(255 * out[3]);
        this.c[o + 2] = Math.min(255, Math.round(255 * out[5]));
        this.d[o] = layer.groomDir[idx];
      }
    }
    this.srcA.update();
    this.srcB.update();
    this.srcC.update();
    this.srcD.update();
    this.fillMs = performance.now() - t0;
  }
}
