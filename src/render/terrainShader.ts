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
uniform sampler2D uGroom;
uniform sampler2D uSki;

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
uniform vec3 uSurfT;
uniform vec4 uTreeA;
uniform vec4 uTreeB;
uniform vec4 uShrub;

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

// ---------------------------------------------------------------- faktury śniegu
vec3 surfaceDetail(vec3 col, vec2 p, int q, vec2 groomV, vec2 skiV, float shade) {
  float groomed = length(groomV);
  float skied = length(skiV);
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
  // sztruks po ratraku: prążki w kierunku przejazdu, pasy co szerokość ratraka
  if (groomed >= uSurfT.x) {
    float ang = atan(groomV.y, groomV.x) * 0.5;
    vec2 dir = vec2(cos(ang), sin(ang));
    float s = dot(p, vec2(-dir.y, dir.x));
    float stripe = 0.5 + 0.5 * cos(s * 6.2831853 / 0.45);
    float lane = smoothstep(0.0, 0.06, abs(fract(s / 4.6) - 0.5) * 2.0 - 0.92);
    col *= 1.0 - 0.07 * stripe * detailAmp(0.45) * min(1.0, groomed * 1.5) - 0.05 * lane * detailAmp(4.6);
    return col;
  }
  // muldy (rozjeżdżony śnieg bez ratraka)
  if (skied >= uSurfT.z) {
    float e = 0.6;
    float h0 = vnoise(p * 0.33, 47u);
    float hx = vnoise((p + vec2(e, 0.0)) * 0.33, 47u);
    float hy = vnoise((p + vec2(0.0, e)) * 0.33, 47u);
    vec3 nn = normalize(vec3(-(hx - h0) * 6.0, -(hy - h0) * 6.0, 1.0));
    col *= mix(1.0, 0.8 + 0.4 * clamp(dot(nn, uLight), 0.0, 1.0), detailAmp(3.0));
    return col;
  }
  // ślady nart na puchu
  if (q == 1 && skied >= uSurfT.y) {
    float ang = atan(skiV.y, skiV.x) * 0.5;
    vec2 dir = vec2(cos(ang), sin(ang));
    float s = dot(p, vec2(-dir.y, dir.x)) + (vnoise(p * 0.15, 53u) - 0.5) * 3.0;
    float line = 1.0 - smoothstep(0.03, 0.08, abs(fract(s / 1.7) - 0.5) - 0.38);
    col *= 1.0 - 0.10 * line * detailAmp(1.7) * min(1.0, skied * 2.0);
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
      float dens = cl.b * (1.0 - texture(uMask, base / uMapSize).r) * (layer == 2u ? 0.8 : 1.0);
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
      c3 *= clamp(0.55 + 0.5 * shade, 0.55, 1.1);
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
      float dens = cellAt(base + jit).b * (1.0 - texture(uMask, base / uMapSize).r);
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
  vec3 n = normalize(nrm.xyz * 2.0 - 1.0);
  float relief = clamp(dot(n, uLight), 0.0, 1.0);
  float shade = relief / max(uLight.z, 0.05);

  vec2 jit = (vec2(fbm(p * 0.06, 1u), fbm(p * 0.06, 2u)) - 0.5) * 22.0;
  vec4 cell = cellAt(p + jit);
  float depthCm = uHasSnow > 0.5 ? cell.r * 255.0 : 120.0;
  int q = uHasSnow > 0.5 ? int(cell.g * 255.0 / 16.0 + 0.5) : 3;
  vec4 msk = texture(uMask, uv);
  vec2 groomV = (texture(uGroom, uv).rg - 0.5) * 2.0;
  vec2 skiV = (texture(uSki, uv).rg - 0.5) * 2.0;

  // Pokrycie śniegiem: gruby – biały, cienki – płaty, brak – trawa.
  float n1 = fbm(p * 0.08, 11u);
  float cover = q == 0 ? 0.0 : smoothstep(1.0, 14.0, depthCm + (n1 - 0.5) * 12.0);
  if (q == 7) cover = min(cover, smoothstep(0.38, 0.62, fbm(p * 0.14, 13u)));
  vec3 snowLit = vec3(1.0);
  vec3 snowShade = vec3(0.68, 0.76, 0.89);
  vec3 snow = mix(snowShade, snowLit, clamp(shade * 0.9, 0.0, 1.0));
  vec3 grass = mix(vec3(0.66, 0.65, 0.48), vec3(0.55, 0.57, 0.40), fbm(p * 0.25, 17u)) * clamp(0.72 + 0.32 * shade, 0.5, 1.2);
  float rock = smoothstep(0.70, 0.76, fbm(p * 0.3, 19u));
  grass = mix(grass, vec3(0.55, 0.53, 0.50) * clamp(shade, 0.6, 1.2), rock * 0.85);
  vec3 col = mix(grass, snow, cover);

  // Faktury śniegu (poziom 3, częściowo 2).
  float detail = clamp(uLod.z + 0.35 * uLod.y, 0.0, 1.0);
  if (detail > 0.01 && cover > 0.02) {
    vec3 dcol = surfaceDetail(col, p, q, groomV, skiV, shade);
    col = mix(col, dcol, detail * cover);
  }

  // Dno lasu (cień koron) i trasy (gładki śnieg).
  float forest = cellAt(p + jit * 0.6).b * (1.0 - msk.r);
  float shrub = cellAt(p + jit * 0.6).a * (1.0 - msk.r);
  // Dno lasu: ze śniegiem – szaroniebieskie (cień koron), bez śniegu – brązowe (igliwie).
  vec3 floorSnow = col * vec3(0.80, 0.85, 0.91);
  vec3 floorBare = mix(vec3(0.45, 0.38, 0.29), vec3(0.37, 0.31, 0.24), fbm(p * 0.4, 29u)) * clamp(0.7 + 0.35 * shade, 0.5, 1.2);
  col = mix(col, mix(floorBare, floorSnow, cover), forest * 0.85);
  col = mix(col, mix(col, vec3(0.98, 0.99, 1.0), 0.3), msk.g * cover);

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
${NOISE_GLSL}
float detailAmp(float periodM) { return clamp((periodM / uMpp - 3.0) / 3.0, 0.0, 1.0); }
void main() {
  vec2 p = vWorld;
  vec2 uv = p / uMapSize;
  vec2 g = (texture(uGroom, uv).rg - 0.5) * 2.0;
  vec2 sk = (texture(uSki, uv).rg - 0.5) * 2.0;
  float gi = length(g);
  float si = length(sk);
  if (gi < 0.03 && si < 0.03) { fragColor = vec4(1.0); return; }
  vec4 cell = texelFetch(uCells, clamp(ivec2(floor(p / uCellM)), ivec2(0), ivec2(uGrid) - 1), 0);
  int q = int(cell.g * 255.0 / 16.0 + 0.5);
  if (q == 0 || q == 7 || cell.r * 255.0 < 3.0) { fragColor = vec4(1.0); return; }
  float f = 1.0;
  if (gi >= uSurfT.x && q != 6 && q != 5) {
    float ang = atan(g.y, g.x) * 0.5;
    vec2 dir = vec2(cos(ang), sin(ang));
    float s = dot(p, vec2(-dir.y, dir.x));
    float stripe = 0.5 + 0.5 * cos(s * 6.2831853 / 0.45);
    float lane = smoothstep(0.0, 0.06, abs(fract(s / 4.6) - 0.5) * 2.0 - 0.92);
    float k = min(1.0, (gi - uSurfT.x) / (1.0 - uSurfT.x) * 2.0 + 0.3);
    f = 1.0 - (0.09 * stripe * detailAmp(0.45) + 0.06 * lane * detailAmp(4.6)) * k;
  } else if (si >= uSurfT.z && q != 6) {
    float e = 0.6;
    float h0 = vnoise(p * 0.33, 47u);
    float hx = vnoise((p + vec2(e, 0.0)) * 0.33, 47u);
    float hy = vnoise((p + vec2(0.0, e)) * 0.33, 47u);
    vec3 nn = normalize(vec3(-(hx - h0) * 6.0, -(hy - h0) * 6.0, 1.0));
    f = mix(1.0, 0.82 + 0.25 * clamp(dot(nn, uLight), 0.0, 1.0), detailAmp(3.0));
  } else if (si >= uSurfT.y) {
    float ang = atan(sk.y, sk.x) * 0.5;
    vec2 dir = vec2(cos(ang), sin(ang));
    float s = dot(p, vec2(-dir.y, dir.x)) + (vnoise(p * 0.15, 53u) - 0.5) * 3.0;
    float line = 1.0 - smoothstep(0.03, 0.08, abs(fract(s / 1.7) - 0.5) - 0.38);
    f = 1.0 - 0.12 * line * detailAmp(1.7) * min(1.0, si * 2.0);
  }
  fragColor = vec4(vec3(min(f, 1.0)), 1.0);
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
