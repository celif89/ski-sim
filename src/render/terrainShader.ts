/**
 * Shader terenu w stylu A („ilustrowana mapa narciarska”): biały śnieg z niebieskawym cieniowaniem
 * rzeźby, trawa i kamienie tam, gdzie śniegu mało, faktury śniegu wg stanu z modelu (puch,
 * przewiany, osiadły, firn, breja, lód, sztruks, muldy, ślady nart), świerki rysowane z boku
 * (poziom 1 – gęsta faktura ikonek, poziom 2–3 – pojedyncze drzewa z cieniem), kosodrzewina,
 * przecinki o ostrych krawędziach, światło pory dnia i oświetlenie tras nocą.
 *
 * Skrót losujący drzewa (PCG) jest taki sam jak w illustration.ts (testy determinizmu).
 * Współrzędne: metry mapy (x na wschód, y na południe).
 */

export const TERRAIN_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vWorld;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vWorld = aPosition;
}
`;

export const TERRAIN_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
out vec4 fragColor;

uniform sampler2D uNormals;
uniform sampler2D uCells;
uniform sampler2D uMask;

uniform vec2 uMapSize;
uniform vec2 uGrid;
uniform float uCellM;
uniform float uMpp;
uniform vec2 uUp;
uniform vec2 uRight;
uniform vec3 uLight;
uniform vec2 uShadowDir;
uniform float uShadowLen;
uniform vec3 uTint;
uniform float uNight;
uniform float uTime;
uniform int uSeed;
uniform vec3 uLod;
uniform float uHasSnow;
uniform float uSummer;
uniform vec3 uSurfT;
uniform vec4 uTreeA;
uniform vec4 uTreeB;
uniform vec4 uShrub;
// Etap 7e: czytelność rzeźby (parametry: data/map-style.json, sekcja „relief”; wzory jak w relief.ts).
uniform sampler2D uAux;      // R – wklęsłość 0–1, G/B/A – wysokość względem uElevBase [cm] (24 bity)
uniform float uElevBase;
uniform float uNormZ;        // przewyższenie, z którym zapisano normalne w teksturze
uniform vec4 uL0;            // kierunek do światła (mapa) i waga – 4 światła związane z ekranem
uniform vec4 uL1;
uniform vec4 uL2;
uniform vec4 uL3;
uniform vec2 uShadeP;        // siła cieniowania kierunkowego, przewyższenie
uniform vec4 uSlopeA;        // jasność przy 25 %, 40 %, stromo; nachylenie „stromo” [%]
uniform vec4 uSlopeB;        // chłód, siła, próg trasy niebieskiej, czerwonej [%]
uniform float uConcS;
uniform vec4 uHachA;         // od [%], pełne [%], max [%], odstęp [m] (dla poziomu kafla)
uniform vec4 uHachB;         // długość min, max (× odstępu), grubość min, max [px]
uniform vec4 uHachC;         // gęstość min, siła, zanik z przybliżeniem, warstwa skrótu
uniform vec4 uContA;         // udział warstwic co 10 m, grubość cienkiej, grubej [px], siła cienkiej
uniform vec4 uContB;         // siła grubej, odstęp gęsty, rzadki, co 100 m [m]
uniform vec2 uForestP;       // cieniowanie drzew, gęstość ikon z daleka

// ---------------------------------------------------------------- skróty i szum
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
uint cellHash(int ix, int iy, uint seed, uint layer) {
  return pcg((uint(ix) * 73856093u) ^ pcg((uint(iy) * 19349663u) ^ pcg(seed + layer * 1013904223u)));
}
float hashUnit(uint h, uint k) {
  return float(pcg(h + k * 0x9e3779b9u) & 0xFFFFFFu) / 16777216.0;
}
float hc(ivec2 c, uint salt) {
  return float(pcg(uint(c.x + 65536) * 73856093u ^ pcg(uint(c.y + 65536) * 19349663u ^ salt)) & 0xFFFFu) / 65535.0;
}
float vnoise(vec2 p, uint salt) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = hc(c, salt);
  float b = hc(c + ivec2(1, 0), salt);
  float d = hc(c + ivec2(0, 1), salt);
  float e = hc(c + ivec2(1, 1), salt);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
float fbm(vec2 p, uint salt) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p, salt + uint(i) * 7u);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
// Siła wzoru o okresie periodM przy skali uMpp: znika, zanim zacząłby migotać (< 3 px na okres).
float detailAmp(float periodM) {
  return clamp((periodM / uMpp - 3.0) / 3.0, 0.0, 1.0);
}

vec4 cellAt(vec2 p) {
  ivec2 c = clamp(ivec2(floor(p / uCellM)), ivec2(0), ivec2(uGrid) - 1);
  return texelFetch(uCells, c, 0);
}

// Etap 7d: grubość śniegu [cm] i udział stanu „przetarty” interpolowane między środkami komórek
// (z bliska bez schodków 10 m na brzegach płatów).
vec2 depthThinAt(vec2 p) {
  vec2 g = p / uCellM - 0.5;
  ivec2 c0 = ivec2(floor(g));
  vec2 t = g - vec2(c0);
  ivec2 hi = ivec2(uGrid) - 1;
  vec4 a = texelFetch(uCells, clamp(c0, ivec2(0), hi), 0);
  vec4 b = texelFetch(uCells, clamp(c0 + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 c = texelFetch(uCells, clamp(c0 + ivec2(0, 1), ivec2(0), hi), 0);
  vec4 d = texelFetch(uCells, clamp(c0 + ivec2(1, 1), ivec2(0), hi), 0);
  vec4 th = vec4((int(a.g * 255.0 + 0.5) >> 4) == 7, (int(b.g * 255.0 + 0.5) >> 4) == 7, (int(c.g * 255.0 + 0.5) >> 4) == 7, (int(d.g * 255.0 + 0.5) >> 4) == 7);
  float dep = mix(mix(a.r, b.r, t.x), mix(c.r, d.r, t.x), t.y) * 255.0;
  float thin = mix(mix(th.x, th.y, t.x), mix(th.z, th.w, t.x), t.y);
  return vec2(dep, thin);
}

// ---------------------------------------------------------------- rzeźba (etap 7e)
float auxElev(vec4 t) {
  return uElevBase + (t.g * 255.0 * 65536.0 + t.b * 255.0 * 256.0 + t.a * 255.0) / 100.0;
}
// Wysokość [m] i wklęsłość (0–1) – dwuliniowo między środkami komórek (dokładnie, bez filtrowania 8 bitów).
vec2 elevConcAt(vec2 p) {
  vec2 g = p / uCellM - 0.5;
  ivec2 c0 = ivec2(floor(g));
  vec2 t = g - vec2(c0);
  ivec2 hi = ivec2(uGrid) - 1;
  vec4 a = texelFetch(uAux, clamp(c0, ivec2(0), hi), 0);
  vec4 b = texelFetch(uAux, clamp(c0 + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 c = texelFetch(uAux, clamp(c0 + ivec2(0, 1), ivec2(0), hi), 0);
  vec4 d = texelFetch(uAux, clamp(c0 + ivec2(1, 1), ivec2(0), hi), 0);
  float h = mix(mix(auxElev(a), auxElev(b), t.x), mix(auxElev(c), auxElev(d), t.x), t.y);
  float k = mix(mix(a.r, b.r, t.x), mix(c.r, d.r, t.x), t.y);
  return vec2(h, k);
}
// Gradient terenu [m/m] z tekstury normalnych (bez przewyższenia).
vec2 gradAt(vec2 p) {
  vec3 n = texture(uNormals, p / uMapSize).xyz * 2.0 - 1.0;
  return -n.xy / max(n.z, 0.05) / uNormZ;
}
float lightTerm(vec3 n, vec4 L) { return L.w * max(0.0, dot(n, L.xyz)); }
// Cieniowanie z 4 kierunków (1 = płasko) – multiShade w relief.ts.
float multiShade(vec2 g) {
  vec3 n = normalize(vec3(-g * uShadeP.y, 1.0));
  float sum = lightTerm(n, uL0) + lightTerm(n, uL1) + lightTerm(n, uL2) + lightTerm(n, uL3);
  float flat0 = uL0.w * uL0.z + uL1.w * uL1.z + uL2.w * uL2.z + uL3.w * uL3.z;
  float s = flat0 > 1e-6 ? sum / flat0 : 1.0;
  return 1.0 + (s - 1.0) * uShadeP.x;
}
// Jasność od samego nachylenia i udział chłodnej barwy – slopeTone w relief.ts.
vec2 slopeTone(float s) {
  float v;
  if (s <= uSlopeB.z) v = mix(1.0, uSlopeA.x, s / uSlopeB.z);
  else if (s <= uSlopeB.w) v = mix(uSlopeA.x, uSlopeA.y, (s - uSlopeB.z) / (uSlopeB.w - uSlopeB.z));
  else v = mix(uSlopeA.y, uSlopeA.z, min(1.0, (s - uSlopeB.w) / (uSlopeA.w - uSlopeB.w)));
  float light = 1.0 - (1.0 - v) * uSlopeB.y;
  return vec2(light, min(1.0, (1.0 - light) * uSlopeB.x * 3.0));
}
// Teren otwarty (0–1): bez lasu i kosodrzewiny; przecinki i trasy otwarte.
float openAt(vec2 c) {
  vec4 cl = cellAt(c);
  vec4 m = texture(uMask, c / uMapSize);
  float cleared = max(m.r, m.g);
  return clamp(1.0 - max(cl.b, cl.a) * (1.0 - cleared) * 1.6, 0.0, 1.0);
}
// Kreski spadku – hachureAt w relief.ts: oczko siatki, punkt ze skrótu, kreska wzdłuż spadku
// zwężona w dół stoku. Zwraca krycie 0–1.
float hachureCover(vec2 p) {
  float S = uHachA.w;
  vec2 cb = floor(p / S);
  float best = 0.0;
  float aa = 0.6 * uMpp;
  for (int dj = -1; dj <= 1; dj++) {
    for (int di = -1; di <= 1; di++) {
      ivec2 c = ivec2(cb) + ivec2(di, dj);
      if (c.x < 0 || c.y < 0) continue;
      uint hs = cellHash(c.x, c.y, uint(uSeed), uint(uHachC.w));
      vec2 ctr = (vec2(c) + vec2(0.2 + 0.6 * hashUnit(hs, 0u), 0.2 + 0.6 * hashUnit(hs, 1u))) * S;
      if (texture(uNormals, ctr / uMapSize).a < 0.5) continue;
      vec2 g = gradAt(ctr);
      float gl = length(g);
      float sl = gl * 100.0;
      float vis = smoothstep(uHachA.x, uHachA.y, sl);
      if (vis <= 0.0) continue;
      float t = clamp((sl - uHachA.y) / (uHachA.z - uHachA.y), 0.0, 1.0);
      if (hashUnit(hs, 2u) >= mix(uHachC.x, 1.0, t)) continue;
      vec2 dir = -g / gl;
      float len = S * mix(uHachB.x, uHachB.y, t);
      vec2 a = ctr - dir * len * 0.5;
      vec2 ap = p - a;
      float u = clamp(dot(ap, dir) / len, 0.0, 1.0);
      float d = length(ap - dir * u * len);
      float w = mix(uHachB.z, uHachB.w, t) * uMpp * (1.0 - 0.65 * u);
      float cov = 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, d);
      if (cov <= 0.0) continue;
      best = max(best, cov * vis * openAt(ctr));
    }
  }
  return best * uHachC.z;
}
// Warstwica co interval [m] o grubości widthPx (wygładzona na brzegu).
float contourLine(float h, float fw, float interval, float widthPx) {
  float d = abs(fract(h / interval + 0.5) - 0.5) * interval / fw;
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
}

// ---------------------------------------------------------------- faktury śniegu
// Ślady (sztruks, muldy, narty) rysuje osobna nakładka TRACKS_FRAGMENT – zmieniają się co chwilę.
vec3 surfaceDetail(vec3 col, vec2 p, int q, float shade) {
  // lód
  if (q == 6) {
    col = mix(col, vec3(0.80, 0.88, 0.97), 0.35);
    float streak = vnoise(vec2(dot(p, vec2(0.7, 0.7)) * 0.25, dot(p, vec2(-0.7, 0.7)) * 2.5), 41u);
    col += vec3(0.22) * smoothstep(0.62, 0.9, streak) * detailAmp(0.6);
    return col;
  }
  // breja
  if (q == 5) {
    float m = fbm(p * 1.3, 43u);
    col *= mix(vec3(0.93, 0.93, 0.91), vec3(0.80, 0.81, 0.80), smoothstep(0.4, 0.7, m));
    return col;
  }
  // puch: miękki, iskrzący się
  if (q == 1) {
    float sp = hc(ivec2(floor(p / 0.18)), 59u);
    col += vec3(0.10) * step(0.985, sp) * detailAmp(0.5);
    col *= 0.985 + 0.03 * vnoise(p * 2.0, 61u);
    return col;
  }
  // przewiany: zastrugi
  if (q == 2) {
    col *= 0.95 + 0.07 * vnoise(vec2(p.x * 0.4 + p.y * 0.4, (p.y - p.x) * 2.2), 67u) * detailAmp(0.5) + 0.0;
    return col;
  }
  // firn: grube ziarno, lekko szarożółty
  if (q == 4) {
    col *= mix(vec3(1.0), vec3(0.96, 0.95, 0.90), 0.6) * (0.93 + 0.08 * vnoise(p * 5.0, 71u) * detailAmp(0.25) + 0.04);
    return col;
  }
  // osiadły
  col *= 0.975 + 0.04 * vnoise(p * 1.2, 73u);
  return col;
}

// ---------------------------------------------------------------- drzewa (świerki z boku)
// Zwraca kolor i krycie; do shadowAcc dopisuje cień drzew na ziemi.
vec4 treeLayer(vec2 p, vec4 prm, float shade, float snowCover, float withShadow, inout float shadowAcc) {
  float S = prm.x;
  float H = prm.y;
  float wr = prm.z;
  uint layer = uint(prm.w);
  uint seed = uint(uSeed);
  vec4 best = vec4(0.0);
  float bestKey = -1e9;
  int steps = int(ceil(1.3 * H / S)) + 1;
  for (int k = 0; k <= steps; k++) {
    vec2 q = p - uUp * (float(k) * S);
    for (int lat = -1; lat <= 1; lat++) {
      vec2 qq = q + uRight * (float(lat) * S * 0.5);
      ivec2 c = ivec2(floor(qq / S));
      if (c.x < 0 || c.y < 0) continue;
      uint h = cellHash(c.x, c.y, seed, layer);
      vec2 base = (vec2(c) + vec2(0.15 + 0.7 * hashUnit(h, 0u), 0.15 + 0.7 * hashUnit(h, 1u))) * S;
      vec2 jit = (vec2(vnoise(base * 0.11, 1u), vnoise(base * 0.11, 2u)) - 0.5) * 6.0;
      vec4 cl = cellAt(base + jit);
      float dens = cl.b * (1.0 - texture(uMask, base / uMapSize).r) * (layer == 2u ? 0.8 * uForestP.y : 1.0);
      if (hashUnit(h, 2u) >= dens) continue;
      float th = H * (0.75 + 0.5 * hashUnit(h, 3u));
      float tone = hashUnit(h, 4u);
      vec2 d = p - base;
      float y = dot(d, uUp);
      float x = dot(d, uRight);
      float hw = th * wr * 0.5;
      if (y < -0.1 * th || y > th) continue;
      float t = clamp(y / th, 0.0, 1.0);
      float tier = fract(t * 3.0);
      float w = hw * (1.0 - t) * (0.62 + 0.38 * (1.0 - tier));
      float aa = uMpp * 0.75;
      float inside = 1.0 - smoothstep(w - aa, w + aa, abs(x));
      if (y < 0.0) inside = (1.0 - smoothstep(hw * 0.1 - aa, hw * 0.1 + aa, abs(x))) * step(-0.1 * th, y);
      if (inside <= 0.01) continue;
      float key = -dot(base, uUp);
      if (key <= bestKey) continue;
      bestKey = key;
      vec3 dark = mix(vec3(0.09, 0.24, 0.18), vec3(0.12, 0.30, 0.22), tone);
      vec3 light = mix(vec3(0.18, 0.42, 0.31), vec3(0.24, 0.49, 0.35), tone);
      vec3 c3 = mix(dark, light, step(x, 0.0) * 0.75);
      // ciemniejszy brzeg sylwetki (jak rysunek)
      c3 *= mix(0.72, 1.0, smoothstep(w - aa * 2.0, w - aa * 3.5, abs(x)));
      // Etap 7e: drzewa przyciemnione zgodnie z cieniowaniem terenu (stok w cieniu – ciemniejsze).
      c3 *= mix(1.0, clamp(0.5 + 0.55 * shade, 0.4, 1.15), uForestP.x);
      if (y < 0.0) c3 = vec3(0.30, 0.22, 0.16);
      // śnieg na gałęziach: dolne brzegi pięter i czubek
      float snowy = (step(tier, 0.16) * step(w * 0.55, abs(x)) + step(0.86, t)) * snowCover;
      c3 = mix(c3, vec3(0.96, 0.97, 1.0), clamp(snowy, 0.0, 1.0) * 0.85);
      best = vec4(c3, inside);
    }
  }
  // cień na ziemi (elipsa wzdłuż kierunku cienia)
  if (withShadow > 0.5 && uShadowLen > 0.0) {
    vec2 perp = vec2(-uShadowDir.y, uShadowDir.x);
    int sSteps = int(ceil(H * uShadowLen / S)) + 1;
    for (int k = 0; k <= sSteps; k++) {
      vec2 q = p - uShadowDir * (float(k) * S);
      ivec2 c = ivec2(floor(q / S));
      if (c.x < 0 || c.y < 0) continue;
      uint h = cellHash(c.x, c.y, seed, layer);
      vec2 base = (vec2(c) + vec2(0.15 + 0.7 * hashUnit(h, 0u), 0.15 + 0.7 * hashUnit(h, 1u))) * S;
      vec2 jit = (vec2(vnoise(base * 0.11, 1u), vnoise(base * 0.11, 2u)) - 0.5) * 6.0;
      float dens = cellAt(base + jit).b * (1.0 - texture(uMask, base / uMapSize).r) * (layer == 2u ? 0.8 * uForestP.y : 1.0);
      if (hashUnit(h, 2u) >= dens) continue;
      float th = H * (0.75 + 0.5 * hashUnit(h, 3u));
      float len = th * uShadowLen;
      vec2 d = p - (base + uShadowDir * len * 0.5);
      float a = dot(d, uShadowDir) / (len * 0.5 + 0.5);
      float b = dot(d, perp) / (th * wr * 0.4 + 0.3);
      float e = a * a + b * b;
      shadowAcc = max(shadowAcc, 1.0 - smoothstep(0.6, 1.0, e));
    }
  }
  return best;
}

// Kosodrzewina: ciemne, zaokrąglone kępy.
vec4 shrubLayer(vec2 p, vec4 prm, float shade, float snowCover) {
  float S = prm.x;
  uint seed = uint(uSeed);
  vec2 cbase = floor(p / S);
  vec4 best = vec4(0.0);
  float bestKey = -1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 c = ivec2(cbase) + ivec2(i, j);
      if (c.x < 0 || c.y < 0) continue;
      uint h = cellHash(c.x, c.y, seed, uint(prm.w));
      vec2 ctr = (vec2(c) + vec2(0.2 + 0.6 * hashUnit(h, 0u), 0.2 + 0.6 * hashUnit(h, 1u))) * S;
      float dens = cellAt(ctr).a * (1.0 - texture(uMask, ctr / uMapSize).r);
      if (hashUnit(h, 2u) >= dens) continue;
      float r = S * prm.y * (0.7 + 0.6 * hashUnit(h, 3u));
      vec2 d = p - ctr;
      float wob = 1.0 + 0.18 * (vnoise(p * (2.0 / S), 79u) - 0.5);
      float dist = length(d) / (r * wob);
      float inside = 1.0 - smoothstep(1.0 - uMpp / r, 1.0 + uMpp / r, dist);
      if (inside <= 0.01) continue;
      float key = -dot(ctr, uUp);
      if (key <= bestKey) continue;
      bestKey = key;
      float lit = clamp(0.5 - 0.5 * dot(normalize(d + 1e-4), uRight - uUp), 0.0, 1.0);
      vec3 c3 = mix(vec3(0.17, 0.27, 0.20), vec3(0.27, 0.38, 0.28), lit) * clamp(0.6 + 0.45 * shade, 0.55, 1.1);
      c3 = mix(c3, vec3(0.95, 0.96, 0.99), snowCover * 0.55 * step(0.55, lit));
      best = vec4(c3, inside);
    }
  }
  return best;
}

void main() {
  vec2 p = vWorld;
  vec2 uv = p / uMapSize;
  vec4 nrm = texture(uNormals, uv);
  if (nrm.a < 0.5) {
    float hatch = step(mod(p.x + p.y, 40.0), 6.0);
    vec3 c = mix(vec3(0.88, 0.90, 0.93), vec3(0.80, 0.83, 0.87), hatch);
    fragColor = vec4(c * uTint, 1.0);
    return;
  }
  // Etap 7e: cieniowanie z 4 kierunków (światło związane z ekranem), z przewyższeniem.
  vec2 grad = gradAt(p);
  float slopePct = length(grad) * 100.0;
  float shade = multiShade(grad);
  vec2 tone = slopeTone(slopePct);
  vec2 ec = elevConcAt(p);
  // Jasność rzeźby niezależna od kierunku: nachylenie i wklęsłość (dolina – mniej nieba).
  float reliefB = tone.x * (1.0 - uConcS * ec.y);

  vec2 jit = (vec2(fbm(p * 0.06, 1u), fbm(p * 0.06, 2u)) - 0.5) * 22.0;
  vec4 cell = cellAt(p + jit);
  vec2 dt = uHasSnow > 0.5 && uSummer < 0.5 ? depthThinAt(p + jit) : vec2(0.0);
  float depthCm = uSummer > 0.5 ? 0.0 : uHasSnow > 0.5 ? dt.x : 120.0;
  // Kanał G: stan śniegu × 16 + muldy (0–15) – stan w górnych 4 bitach.
  int q = uSummer > 0.5 ? 0 : uHasSnow > 0.5 ? (int(cell.g * 255.0 + 0.5) >> 4) : 3;
  vec4 msk = texture(uMask, uv);

  // Pokrycie śniegiem: gruby – biały, cienki – płaty, brak – trawa.
  float n1 = fbm(p * 0.08, 11u);
  float cover = (uSummer > 0.5 || depthCm < 0.5) ? 0.0 : smoothstep(1.0, 14.0, depthCm + (n1 - 0.5) * 12.0);
  // Przetarty: płaty trawy – udział przenika się między komórkami.
  cover = min(cover, mix(1.0, smoothstep(0.38, 0.62, fbm(p * 0.14, 13u)), dt.y));
  vec3 snowLit = vec3(1.0);
  vec3 snowShade = vec3(0.68, 0.76, 0.89);
  vec3 snow = mix(snowShade, snowLit, clamp(shade * 0.9, 0.0, 1.0));
  vec3 grass = mix(vec3(0.66, 0.65, 0.48), vec3(0.55, 0.57, 0.40), fbm(p * 0.25, 17u)) * clamp(0.72 + 0.32 * shade, 0.5, 1.2);
  float rock = smoothstep(0.70, 0.76, fbm(p * 0.3, 19u));
  grass = mix(grass, vec3(0.55, 0.53, 0.50) * clamp(shade, 0.6, 1.2), rock * 0.85);
  // Lato (etap 7b): soczysta łąka (styl A), na trasach koszona – jaśniejsze pasy.
  if (uSummer > 0.5) {
    vec3 meadow = mix(vec3(0.56, 0.72, 0.38), vec3(0.44, 0.62, 0.30), fbm(p * 0.22, 17u)) * clamp(0.74 + 0.30 * shade, 0.5, 1.2);
    meadow = mix(meadow, vec3(0.62, 0.66, 0.42) * clamp(shade, 0.6, 1.2), smoothstep(0.66, 0.8, fbm(p * 0.05, 23u)) * 0.35);
    meadow = mix(meadow, vec3(0.58, 0.58, 0.54) * clamp(shade, 0.6, 1.2), rock * 0.85);
    float mown = msk.g * (0.85 + 0.15 * step(0.5, fract((p.x + p.y) * 0.08)));
    grass = mix(meadow, vec3(0.70, 0.82, 0.50) * clamp(0.78 + 0.25 * shade, 0.5, 1.2), mown * 0.6);
  }
  vec3 col = mix(grass, snow, cover);

  // Faktury śniegu (poziom 3, częściowo 2).
  float detail = clamp(uLod.z + 0.35 * uLod.y, 0.0, 1.0);
  if (detail > 0.01 && cover > 0.02) {
    vec3 dcol = surfaceDetail(col, p, q, shade);
    col = mix(col, dcol, detail * cover);
  }

  // Dno lasu (cień koron) i trasy (gładki śnieg).
  float forest = cellAt(p + jit * 0.6).b * (1.0 - msk.r);
  float shrub = cellAt(p + jit * 0.6).a * (1.0 - msk.r);
  // Dno lasu: ze śniegiem – szaroniebieskie (cień koron), bez śniegu – brązowe (igliwie).
  vec3 floorSnow = col * vec3(0.80, 0.85, 0.91);
  vec3 floorBare = mix(vec3(0.45, 0.38, 0.29), vec3(0.37, 0.31, 0.24), fbm(p * 0.4, 29u)) * clamp(0.7 + 0.35 * shade, 0.5, 1.2);
  if (uSummer > 0.5) floorBare = mix(vec3(0.30, 0.40, 0.22), vec3(0.24, 0.33, 0.18), fbm(p * 0.4, 29u)) * clamp(0.7 + 0.35 * shade, 0.5, 1.2);
  col = mix(col, mix(floorBare, floorSnow, cover), forest * 0.85);
  col = mix(col, mix(col, vec3(0.98, 0.99, 1.0), 0.3), msk.g * cover);
  // Etap 7e: stromo – ciemniej i chłodniej (niebieskoszaro), dno doliny ciemniejsze.
  col *= reliefB;
  col = mix(col, col * vec3(0.80, 0.87, 1.0), tone.y);
  // Kreski spadku (teren otwarty i trasy; stałe położenie w świecie).
  if (uHachC.z > 0.001 && slopePct > uHachA.x * 0.6) {
    float hc = hachureCover(p);
    col = mix(col, col * vec3(0.42, 0.48, 0.60), hc * uHachC.y);
  }

  // Kosodrzewina i świerki.
  float shadowAcc = 0.0;
  float wA = uLod.x;
  float wB = uLod.y + uLod.z;
  if (shrub > 0.0 || cellAt(p + uUp * 6.0).a > 0.0) {
    vec4 sh = wB > 0.01 ? shrubLayer(p, vec4(uShrub.x, uShrub.y, 0.0, 7.0), shade, cover) : vec4(0.0);
    vec4 shA = wA > 0.01 ? shrubLayer(p, vec4(uShrub.z, uShrub.w, 0.0, 8.0), shade, cover) : vec4(0.0);
    col = mix(col, sh.rgb, sh.a * wB);
    col = mix(col, shA.rgb, shA.a * wA);
  }
  float nearForest = max(max(forest, cellAt(p - uUp * 12.0).b), cellAt(p - uUp * 24.0).b);
  if (nearForest > 0.0 || forest > 0.0) {
    vec4 tB = wB > 0.01 ? treeLayer(p, uTreeB, shade, cover, 1.0, shadowAcc) : vec4(0.0);
    float dummy = 0.0;
    vec4 tA = wA > 0.01 ? treeLayer(p, uTreeA, shade, cover, 0.0, dummy) : vec4(0.0);
    col *= 1.0 - shadowAcc * 0.32 * wB * (1.0 - tB.a);
    col = mix(col, tB.rgb, tB.a * wB);
    col = mix(col, tA.rgb, tA.a * wA);
  }

  // Etap 7e: delikatne warstwice (co 10 m z bliska, co 50 m z daleka, grubsze co 100 m).
  if (uContA.w > 0.0 || uContB.x > 0.0) {
    float fw = max(fwidth(ec.x), 1e-4);
    float minor = max(contourLine(ec.x, fw, uContB.y, uContA.y) * uContA.x, contourLine(ec.x, fw, uContB.z, uContA.y));
    float major = contourLine(ec.x, fw, uContB.w, uContA.z);
    float ca = max(minor * uContA.w, major * uContB.x);
    col = mix(col, col * vec3(0.46, 0.50, 0.62), ca);
  }

  // Światło pory dnia; nocą oświetlone trasy.
  col *= uTint;
  float glow = msk.g * uNight * (0.75 + 0.25 * fbm(p * 0.04, 23u));
  col += glow * vec3(1.0, 0.86, 0.6) * 0.5;
  fragColor = vec4(col, 1.0);
}
`;

/** Wspólne funkcje skrótu i szumu (kopie z TERRAIN_FRAGMENT) dla lekkich nakładek. */
const NOISE_GLSL = /* glsl */ `
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float hc(ivec2 c, uint salt) {
  return float(pcg(uint(c.x + 65536) * 73856093u ^ pcg(uint(c.y + 65536) * 19349663u ^ salt)) & 0xFFFFu) / 65535.0;
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
 * Nakładka śladów (mnożenie barw): sztruks po ratraku, muldy, ślady nart – zmienia się co chwilę,
 * więc nie jest „wypalana” w kafle terenu. Poza śladami daje biel (bez zmiany).
 */
export const TRACKS_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
out vec4 fragColor;
uniform sampler2D uCells;
uniform sampler2D uGroom;
uniform sampler2D uSki;
uniform vec2 uMapSize;
uniform vec2 uGrid;
uniform float uCellM;
uniform float uMpp;
uniform vec3 uLight;
uniform vec3 uSurfT;
uniform vec2 uCord;
uniform float uDetailFade;
${NOISE_GLSL}
float detailAmp(float periodM) { return clamp((periodM / uMpp - 2.0) / 2.0, 0.0, 1.0); }
void main() {
  vec2 p = vWorld;
  vec2 uv = p / uMapSize;
  vec2 g = (texture(uGroom, uv).rg - 0.5) * 2.0;
  vec2 sk = (texture(uSki, uv).rg - 0.5) * 2.0;
  float gi = length(g);
  float si = length(sk);
  vec4 cell = texelFetch(uCells, clamp(ivec2(floor(p / uCellM)), ivec2(0), ivec2(uGrid) - 1), 0);
  int gv = int(cell.g * 255.0 + 0.5);
  int q = gv >> 4;
  // Muldy z modelu śniegu (przejazdy gości z poprzednich dni), wygładzone między komórkami.
  vec2 cf = p / uCellM - 0.5;
  ivec2 c0 = ivec2(floor(cf));
  vec2 ff = fract(cf);
  ivec2 hi = ivec2(uGrid) - 1;
  float m00 = float(int(texelFetch(uCells, clamp(c0, ivec2(0), hi), 0).g * 255.0 + 0.5) & 15);
  float m10 = float(int(texelFetch(uCells, clamp(c0 + ivec2(1, 0), ivec2(0), hi), 0).g * 255.0 + 0.5) & 15);
  float m01 = float(int(texelFetch(uCells, clamp(c0 + ivec2(0, 1), ivec2(0), hi), 0).g * 255.0 + 0.5) & 15);
  float m11 = float(int(texelFetch(uCells, clamp(c0 + ivec2(1, 1), ivec2(0), hi), 0).g * 255.0 + 0.5) & 15);
  float mog = mix(mix(m00, m10, ff.x), mix(m01, m11, ff.x), ff.y) / 15.0;
  if (gi < 0.03 && si < 0.03 && mog < 0.05) { fragColor = vec4(1.0); return; }
  if (q == 0 || q == 7 || cell.r * 255.0 < 3.0) { fragColor = vec4(1.0); return; }
  // Progi z płynnym przejściem (bufor śladów ma 2 m/px – twardy próg dawałby schodki).
  float kg = (q == 6 || q == 5) ? 0.0 : smoothstep(uSurfT.x - 0.12, uSurfT.x + 0.12, gi);
  float km = q == 6 ? 0.0 : max(smoothstep(uSurfT.z - 0.12, uSurfT.z + 0.12, si), smoothstep(0.1, 0.6, mog)) * (1.0 - kg);
  float kt = smoothstep(uSurfT.y - 0.08, uSurfT.y + 0.08, si) * (1.0 - kg) * (1.0 - km);
  float f = 1.0;
  if (kg > 0.0) {
    // Kierunek zaokrąglony do 1/32 półobrotu: prążki liczone od początku mapy (km) – drobne wahania
    // kierunku po interpolacji przesuwałyby je o cały okres (falowanie).
    float ang = floor(atan(g.y, g.x) * 0.5 / 0.0981748 + 0.5) * 0.0981748;
    vec2 dir = vec2(cos(ang), sin(ang));
    float s = dot(p, vec2(-dir.y, dir.x));
    float stripe = 0.5 + 0.5 * cos(s * 6.2831853 / uCord.x);
    float lane = smoothstep(0.0, 0.06, abs(fract(s / uCord.y) - 0.5) * 2.0 - 0.92);
    // Wyrównany śnieg odrobinę ciemniejszy (gładki, bez iskrzenia) + prążki i styki pasów.
    f -= (0.03 + 0.11 * stripe * detailAmp(uCord.x) + 0.07 * lane * detailAmp(uCord.y)) * kg;
  }
  if (km > 0.0) {
    float e = 0.6;
    float h0 = vnoise(p * 0.33, 47u);
    float hx = vnoise((p + vec2(e, 0.0)) * 0.33, 47u);
    float hy = vnoise((p + vec2(0.0, e)) * 0.33, 47u);
    vec3 nn = normalize(vec3(-(hx - h0) * 6.0, -(hy - h0) * 6.0, 1.0));
    f *= mix(1.0, 0.82 + 0.25 * clamp(dot(nn, uLight), 0.0, 1.0), detailAmp(3.0) * km);
  }
  if (kt > 0.0) {
    float ang = floor(atan(sk.y, sk.x) * 0.5 / 0.0981748 + 0.5) * 0.0981748;
    vec2 dir = vec2(cos(ang), sin(ang));
    float s = dot(p, vec2(-dir.y, dir.x)) + (vnoise(p * 0.15, 53u) - 0.5) * 3.0;
    float line = 1.0 - smoothstep(0.03, 0.08, abs(fract(s / 1.7) - 0.5) - 0.38);
    f *= 1.0 - 0.12 * line * detailAmp(1.7) * min(1.0, si * 2.0) * kt;
  }
  // Etap 7d: z bliska ślady, sztruks i muldy rysuje warstwa detalu 1 m.
  fragColor = vec4(vec3(mix(min(f, 1.0), 1.0, uDetailFade)), 1.0);
}
`;

/** Nakładka nocna (dodawanie barw): ciepłe światło nad trasami. */
export const GLOW_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
out vec4 fragColor;
uniform sampler2D uMask;
uniform vec2 uMapSize;
uniform float uNight;
${NOISE_GLSL}
void main() {
  float g = texture(uMask, vWorld / uMapSize).g;
  vec3 c = vec3(1.0, 0.86, 0.6) * 0.45 * g * uNight * (0.8 + 0.2 * vnoise(vWorld * 0.05, 23u));
  fragColor = vec4(c, 0.0);
}
`;
