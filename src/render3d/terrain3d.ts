/**
 * Etap 3D-0: teren 3D – kawałki siatki gry (10 m) z poziomami szczegółowości, teren okolicy (Copernicus,
 * strona słowacka i dalsze góry) jako tło, materiał zasilany modelem śniegu: grubość i stan (puch, ubity,
 * firn, breja, lód, przetarcia z trawą i kamieniami) z tekstur danych, latem łąki; na trasach sztruks
 * (prążki wzdłuż linii spadku) i muldy jako nierówność powierzchni przy zbliżeniu, nocą oświetlone trasy.
 */
import * as THREE from 'three';
import type { HorizonDem } from '../sim/horizon';
import type { Render3DParams } from './params';
import type { ChunkDef, HeightField } from './terrainMesh';
import { buildChunk, chunkGrid, lodLevel, sampleHeight } from './terrainMesh';
import type { DepthField } from './snowSurface';
import { SNOW_DEPTH_GLSL, snowSurfaceAt } from './snowSurface';
import type { DetailRelief } from './snowPatch';
import { buildPatch, patchOrigin, reliefFrom } from './snowPatch';

/** Warstwa detalu 1 m (podzbiór DetailLayer z src/sim/detailLayer.ts) do łaty przy kamerze. */
export interface DetailSource {
  sub: number;
  per: number;
  p: { cellM: number };
  blockOf: Int32Array;
  cells: Int32Array;
  mogul: Float32Array;
  pile: Float32Array;
  groomDir: Uint8Array;
  groomT: Float32Array;
  tracks: Uint8Array;
  fresh: Uint8Array;
  version: number;
}

/** Etap 3D-3: wspólne uniformy grubości śniegu (teren, drzewa, dachy, linie). */
export interface SnowUniforms {
  uDepthTex: { value: THREE.Texture | null };
  uDepthGrid: { value: THREE.Vector2 };
  uDepthCell: { value: number };
  uSnowExag: { value: number };
  uHasSnow: { value: number };
}

export interface TerrainInputs {
  hf: HeightField;
  forest: Float32Array | null;
  shrub: Float32Array | null;
  built: Float32Array | null;
  /** Teren okolicy i przeliczenie PUWG → lokalne (x = E − zachód, y = północ − N). */
  dem: HorizonDem | null;
  mapWestE: number;
  mapNorthN: number;
}

/** Kody stanu śniegu jak SNOW_QUALITY_CODES (none, powder, windPacked, settled, firn, slush, icy, thin). */
const GLSL_COMMON = /* glsl */ `
uniform sampler2D uSnowTex;   // liniowo: R – grubość [cm]/255, G – trasa (0,5) / oświetlona (1), B – las, A – kosodrzewina
uniform sampler2D uStateTex;  // najbliższy: R – stan śniegu, G – muldy (0–15), B – wolne, A – zabudowa
uniform vec2 uMapSize;
uniform sampler2D uOverlay;    // etap 3D-1: nakładka danych (jak w 2D), wiersz 0 = północ
uniform float uOverlayOn;      // krycie nakładki (0 – wyłączona)
uniform float uSummer;
uniform float uNight;
uniform float uPisteLight;
uniform float uValleyTop;
uniform float uValleyFog;
uniform vec4 uPatchRect;       // etap 3D-3: łata detalu przy kamerze (x0, z0, x1, z1) – tu teren bazowy znika
uniform float uPatchOn;
uniform float uIsPatch;
uniform sampler2D uDetailTex;  // warstwa detalu 1 m w łacie: R – świeżość sztruksu, G – kierunek przejazdu, B – ślady nart, A – świeży śnieg
uniform vec4 uDetailRect;      // x0, z0, bok [m], 1/bok
uniform float uDetailOn;
uniform float uCordRelief;
uniform float uTrackRelief;
uniform float uSparkle;
uniform vec3 uSunDir;
uniform float uIceRough;
uniform float uSlushRough;
uniform float uFarHaze;
varying vec3 vWorld;
varying vec3 vNormalW;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
`;

export class Terrain3D {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private readonly bgMaterial: THREE.MeshStandardMaterial;
  private readonly chunks: { def: ChunkDef; lods: (THREE.Mesh | null)[]; level: number }[] = [];
  private readonly snowTex: THREE.DataTexture;
  private readonly stateTex: THREE.DataTexture;
  private readonly snowData: Uint8Array;
  private readonly stateData: Uint8Array;
  private bg: THREE.Mesh | null = null;
  private bgZ: Float32Array | null = null;
  readonly uniforms = {
    uSnowTex: { value: null as THREE.Texture | null },
    uStateTex: { value: null as THREE.Texture | null },
    uMapSize: { value: new THREE.Vector2() },
    uHasSnow: { value: 0 },
    uSummer: { value: 0 },
    uNight: { value: 0 },
    uPisteLight: { value: 0.9 },
    uValleyTop: { value: 820 },
    uValleyFog: { value: 0 },
    uOverlay: { value: null as THREE.Texture | null },
    uOverlayOn: { value: 0 },
    uPatchRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uPatchOn: { value: 0 },
    uDetailTex: { value: null as THREE.Texture | null },
    uDetailRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uDetailOn: { value: 0 },
    uCordRelief: { value: 0.18 },
    uTrackRelief: { value: 0.35 },
    uSparkle: { value: 0.8 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uIceRough: { value: 0.16 },
    uSlushRough: { value: 0.38 },
    uFarHaze: { value: 0.35 },
  };
  /** Grubość śniegu w komórkach [m] (do rysunku i funkcji powierzchni). */
  readonly depth: DepthField;
  private readonly depthTex: THREE.DataTexture;
  readonly snowU: SnowUniforms;
  /** Materiał łaty detalu przy kamerze (ta sama barwa co teren, wysokości liczone na procesorze). */
  readonly patchMaterialNear: THREE.MeshStandardMaterial;
  private overlayTex: THREE.CanvasTexture | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayVersion = -1;
  /** Liczba trójkątów rysowanych w ostatniej klatce (licznik). */
  triangles = 0;
  /** Etap 3D-3: łata gęstej siatki przy kamerze (bok, krok [m]; bok 0 – wyłączona). */
  private patchSizeM = 0;
  private patchStepM = 1;
  private patchFadeM = 12;
  private patch: THREE.Mesh | null = null;
  private patchCenter = { x: NaN, z: NaN };
  private patchKey = '';
  private patchBuiltMs = 0;
  private snowVersion = 0;
  private detail: { src: DetailSource; gameH: number; fadeH: number; pileDensityKgM3: number } | null = null;
  private relief: DetailRelief | null = null;
  private reliefVersion = -1;
  private detailTex: THREE.DataTexture | null = null;
  /** Czas budowy łaty [ms] (menu Dev). */
  patchMs = 0;

  constructor(
    private readonly inp: TerrainInputs,
    private readonly p: Render3DParams,
  ) {
    const { hf } = inp;
    const W = hf.widthCells;
    const H = hf.heightCells;
    this.snowData = new Uint8Array(W * H * 4);
    this.stateData = new Uint8Array(W * H * 4);
    for (let k = 0; k < W * H; k++) {
      this.snowData[k * 4 + 2] = Math.round((inp.forest?.[k] ?? 0) * 255);
      this.snowData[k * 4 + 3] = Math.round((inp.shrub?.[k] ?? 0) * 255);
      this.stateData[k * 4 + 3] = Math.round((inp.built?.[k] ?? 0) * 255);
    }
    this.snowTex = new THREE.DataTexture(this.snowData, W, H, THREE.RGBAFormat);
    this.snowTex.magFilter = THREE.LinearFilter;
    this.snowTex.minFilter = THREE.LinearFilter;
    this.snowTex.needsUpdate = true;
    this.stateTex = new THREE.DataTexture(this.stateData, W, H, THREE.RGBAFormat);
    this.stateTex.magFilter = THREE.NearestFilter;
    this.stateTex.minFilter = THREE.NearestFilter;
    this.stateTex.needsUpdate = true;
    this.uniforms.uSnowTex.value = this.snowTex;
    this.uniforms.uStateTex.value = this.stateTex;
    this.uniforms.uMapSize.value.set(W * hf.cellSizeM, H * hf.cellSizeM);
    // Grubość śniegu [m] w komórkach – tekstura float, filtr najbliższy (interpolacja w shaderze jak w TS).
    this.depth = { widthCells: W, heightCells: H, cellSizeM: hf.cellSizeM, depthM: new Float32Array(W * H) };
    this.depthTex = new THREE.DataTexture(this.depth.depthM, W, H, THREE.RedFormat, THREE.FloatType);
    this.depthTex.magFilter = THREE.NearestFilter;
    this.depthTex.minFilter = THREE.NearestFilter;
    this.depthTex.needsUpdate = true;
    this.snowU = {
      uDepthTex: { value: this.depthTex },
      uDepthGrid: { value: new THREE.Vector2(W, H) },
      uDepthCell: { value: hf.cellSizeM },
      uSnowExag: { value: 1 },
      uHasSnow: this.uniforms.uHasSnow,
    };
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    this.patchMaterial(this.material, false);
    this.patchMaterialNear = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    this.patchMaterial(this.patchMaterialNear, true);
    this.bgMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    // Tło okolicy: drobne plamki (korony drzew, hale) – bez nich z daleka wygląda jak mgła.
    this.bgMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uFarHaze = this.uniforms.uFarHaze;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vBgW;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBgW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vBgW;\n${GLSL_COMMON}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb *= 0.7 + 0.55 * vnoise(vBgW.xz * 0.06) * vnoise(vBgW.xz * 0.013 + 3.0);`)
        // Etap 3D-3: dalekie góry bledsze (perspektywa powietrzna ponad zwykłą mgiełkę).
        .replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>\n  #ifdef USE_FOG\n    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, uFarHaze * smoothstep(3000.0, 12000.0, length(vBgW - cameraPosition)));\n  #endif`,
        );
    };
    for (const def of chunkGrid(hf, p.terrain.chunkCells)) this.chunks.push({ def, lods: [null, null, null, null], level: -1 });
    this.buildBackground();
  }

  /** Materiał terenu: barwa i szorstkość z tekstur danych, nierówności (sztruks, muldy), światło tras nocą. */
  patchMaterial(m: THREE.MeshStandardMaterial, isPatch: boolean): void {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      prev?.call(m, shader, r);
      Object.assign(shader.uniforms, this.uniforms, this.snowU, { uIsPatch: { value: isPatch ? 1 : 0 } });
      // Etap 3D-3: wierzchołki terenu podniesione o grubość śniegu (teren + śnieg), normalne z nachylenia
      // pokrywy (zaspy, wywiane grzbiety); łata przy kamerze ma wysokości z procesora (z rzeźbą detalu).
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWorld;\nvarying vec3 vNormalW;\nuniform float uIsPatch;\n${SNOW_DEPTH_GLSL}`)
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `#include <beginnormal_vertex>
  vec2 wxz0 = (modelMatrix * vec4(position, 1.0)).xz;
  float sDepth = 0.0;
  if (uIsPatch < 0.5 && uHasSnow > 0.5) {
    float e = uDepthCell * 0.5;
    float gx = (snowDepthAt(wxz0 + vec2(e, 0.0)) - snowDepthAt(wxz0 - vec2(e, 0.0))) / (2.0 * e);
    float gz = (snowDepthAt(wxz0 + vec2(0.0, e)) - snowDepthAt(wxz0 - vec2(0.0, e))) / (2.0 * e);
    objectNormal = normalize(objectNormal + vec3(-gx, 0.0, -gz) * uSnowExag);
    sDepth = snowDepthAt(wxz0);
  }`,
        )
        .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed.y += uSnowExag * sDepth;\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvNormalW = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${SNOW_DEPTH_GLSL}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
  // Teren bazowy pod łatą detalu znika (łata ma tę samą barwę i wysokość na brzegu).
  if (uIsPatch < 0.5 && uPatchOn > 0.5 && vWorld.x > uPatchRect.x && vWorld.x < uPatchRect.z && vWorld.z > uPatchRect.y && vWorld.z < uPatchRect.w) discard;
  vec2 muv = vWorld.xz / uMapSize;
  // Warstwa detalu 1 m (tylko w łacie): świeżość sztruksu, kierunek przejazdu, ślady nart, świeży śnieg.
  vec4 dt = vec4(0.0);
  float inDet = 0.0;
  if (uDetailOn > 0.5) {
    vec2 du = (vWorld.xz - uDetailRect.xy) * uDetailRect.w;
    if (du.x > 0.0 && du.y > 0.0 && du.x < 1.0 && du.y < 1.0) {
      dt = texture2D(uDetailTex, du);
      inDet = 1.0;
    }
  }
  vec4 sd = texture2D(uSnowTex, muv);
  vec4 st = texture2D(uStateTex, muv);
  float depthCm = snowDepthAt(vWorld.xz) * 100.0;
  int q = int(st.r * 255.0 + 0.5);
  float slope = 1.0 - clamp(vNormalW.y, 0.0, 1.0);
  float n1 = vnoise(vWorld.xz * 0.08) * 0.6 + vnoise(vWorld.xz * 0.5) * 0.4;
  vec3 grassW = mix(vec3(0.19, 0.15, 0.075), vec3(0.14, 0.12, 0.065), n1);
  vec3 grassS = mix(vec3(0.085, 0.19, 0.03), vec3(0.13, 0.25, 0.05), n1);
  vec3 grass = mix(grassW, grassS, uSummer);
  vec3 rock = mix(vec3(0.16, 0.15, 0.14), vec3(0.26, 0.25, 0.23), n1);
  vec3 floorF = mix(vec3(0.04, 0.055, 0.03), vec3(0.07, 0.08, 0.045), n1);
  vec3 ground = mix(grass, rock, smoothstep(0.45, 0.7, slope) + sd.a * 0.35);
  ground = mix(ground, floorF, smoothstep(0.3, 0.8, sd.b));
  ground = mix(ground, vec3(0.2, 0.19, 0.18), st.a * 0.8);
  // Cienka pokrywa (kilka cm) – łaty śniegu i trawy (szum), od ok. 8 cm pełne przykrycie.
  float n2 = vnoise(vWorld.xz * 0.21 + 17.0) * 0.65 + vnoise(vWorld.xz * 0.9) * 0.35;
  float cover = clamp((depthCm - 6.0 * n2) / 2.5, 0.0, 1.0);
  // Przetarcia: łaty śniegu na cienkiej pokrywie.
  if (q == 7) cover *= smoothstep(0.35, 0.6, n1 + 0.15);
  cover *= 1.0 - 0.55 * smoothstep(0.4, 0.9, sd.b) * (1.0 - smoothstep(30.0, 80.0, depthCm));
  vec3 snowC = vec3(0.93, 0.95, 0.98);
  float rough = 0.8;
  if (q == 1) { snowC = vec3(0.98, 0.99, 1.0); rough = 0.95; }
  else if (q == 2) { snowC = vec3(0.94, 0.96, 0.99); rough = 0.8; }
  else if (q == 4) { snowC = vec3(0.90, 0.91, 0.93); rough = 0.7; }
  else if (q == 5) { snowC = vec3(0.80, 0.82, 0.81); rough = uSlushRough; }
  else if (q == 6) { snowC = vec3(0.80, 0.88, 0.96); rough = uIceRough; }
  snowC *= 0.96 + 0.04 * n1;
  diffuseColor.rgb = mix(ground, snowC, cover);
  float gRough = mix(0.95, rough, cover);`,
        )
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor = gRough;`)
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
  {
    float camD = length(vWorld - cameraPosition);
    float near = 1.0 - smoothstep(60.0, 260.0, camD);
    vec3 dW = vec3(0.0);
    if (near > 0.0 && cover > 0.5) {
      vec2 dh = normalize(-vNormalW.xz + vec2(1e-5));
      vec2 ac = vec2(-dh.y, dh.x);
      if (inDet > 0.5) {
        // Z warstwy detalu 1 m: sztruks w kierunku ostatniego przejazdu ratraka, blednący z czasem
        // i pod świeżym śniegiem; rowki śladów nart wzdłuż spadku (zasypywane opadem).
        float a = dt.g * 3.14159;
        vec2 gd = vec2(cos(a), sin(a));
        vec2 gc = vec2(-gd.y, gd.x);
        float ph = dot(vWorld.xz, gc) * 6.2831 / 1.2;
        dW.xz += gc * cos(ph) * uCordRelief * dt.r * near;
        float tr = dt.b * (1.0 - dt.a);
        if (tr > 0.02) {
          vec2 tp = vec2(dot(vWorld.xz, ac) * 7.0, dot(vWorld.xz, dh) * 0.25);
          float gr = vnoise(tp) - 0.5;
          dW.xz += ac * gr * uTrackRelief * tr * near;
        }
      } else if (sd.g > 0.3 && (q == 2 || q == 3 || q == 4)) {
        // Poza łatą: sztruks wzdłuż linii spadku (jak w 3D-0).
        float ph = dot(vWorld.xz, ac) * 6.2831 / 1.2;
        dW.xz += ac * cos(ph) * uCordRelief * near;
      }
      // Muldy: garby co 5 m.
      float mg = st.g * 255.0 / 15.0;
      if (mg > 0.05) {
        vec2 a = vWorld.xz * 6.2831 / 5.0;
        dW.xz += vec2(-sin(a.x) * cos(a.y), -cos(a.x) * sin(a.y)) * 0.35 * mg * near;
      }
      normal = normalize(normal + (viewMatrix * vec4(dW, 0.0)).xyz);
    }
  }`,
        )
        .replace(
          '#include <fog_fragment>',
          /* glsl */ `#include <fog_fragment>
  #ifdef USE_FOG
    float vf = uValleyFog * smoothstep(uValleyTop, uValleyTop - 220.0, vWorld.y);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, vf);
  #endif`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
  // Nakładka danych: barwa wmieszana w podłoże i lekko świecąca (czytelna także w cieniu).
  if (uOverlayOn > 0.0) {
    vec4 ov = texture2D(uOverlay, vWorld.xz / uMapSize);
    float oa = ov.a * uOverlayOn;
    diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb, oa);
    totalEmissiveRadiance += ov.rgb * oa * 0.45;
  }
  // Oświetlenie tras nocą: plamy światła lamp (szum co ok. 25 m), łagodny brzeg.
  float lamp = 0.45 + 0.55 * smoothstep(0.3, 0.8, vnoise(vWorld.xz * 0.04 + 5.0));
  totalEmissiveRadiance += vec3(1.0, 0.84, 0.58) * smoothstep(0.55, 1.0, sd.g) * lamp * uNight * uPisteLight * mix(0.25, 1.0, cover);
  // Iskrzenie puchu i świeżego śniegu w słońcu: drobne błyski zależne od położenia kamery (mrugają przy ruchu).
  {
    float fresh = (q == 1 ? 1.0 : 0.0) + dt.a * inDet;
    float sunUp = clamp(uSunDir.y * 4.0, 0.0, 1.0) * (1.0 - uNight);
    float camD2 = length(vWorld - cameraPosition);
    if (fresh > 0.05 && sunUp > 0.0 && camD2 < 220.0) {
      vec2 cellS = floor(vWorld.xz * 5.0 + floor(cameraPosition.xz * 0.7));
      float g = step(1.0 - 0.006 * uSparkle, h21(cellS));
      float facing = clamp(dot(normalize(vNormalW), uSunDir), 0.0, 1.0);
      totalEmissiveRadiance += vec3(1.0, 0.98, 0.94) * g * fresh * sunUp * facing * cover * (1.0 - smoothstep(80.0, 220.0, camD2)) * 3.0;
    }
  }`,
        );
    };
    m.needsUpdate = true;
  }

  /** Teren okolicy (Copernicus 30 m) – pod mapą obniżony, kolory wg lasu i linii śniegu. */
  private buildBackground(): void {
    const dem = this.inp.dem;
    if (!dem) return;
    const step = this.p.terrain.backgroundStepCells;
    const nx = Math.floor((dem.widthCells - 1) / step) + 1;
    const nz = Math.floor((dem.heightCells - 1) / step) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const z = new Float32Array(nx * nz);
    const hf = this.inp.hf;
    for (let b = 0; b < nz; b++) {
      for (let a = 0; a < nx; a++) {
        const i = a * step;
        const j = b * step;
        const e = dem.westEastingM + (i + 0.5) * dem.cellSizeM;
        const n = dem.northNorthingM - (j + 0.5) * dem.cellSizeM;
        const x = e - this.inp.mapWestE;
        const zz = this.inp.mapNorthN - n;
        let h = dem.elevationM[j * dem.widthCells + i];
        if (!Number.isFinite(h)) h = 0;
        // Na mapie (siatka gry ma wysokość) – teren okolicy schowany pod spodem.
        const g = x >= 0 && zz >= 0 && x <= hf.widthCells * hf.cellSizeM && zz <= hf.heightCells * hf.cellSizeM ? sampleHeight(hf, x, zz) : NaN;
        // Model okolicy to model powierzchni (z lasem) – obniżony o średnią wysokość koron, żeby na granicy
        // mapy nie było uskoku; pod mapą – tuż pod terenem gry (mapa go przykrywa).
        if (Number.isFinite(g)) h = g - 3;
        else h -= this.p.terrain.backgroundDropM;
        const v = b * nx + a;
        pos[v * 3] = x;
        pos[v * 3 + 1] = h;
        pos[v * 3 + 2] = zz;
        z[v] = h;
      }
    }
    const idx: number[] = [];
    for (let b = 0; b < nz - 1; b++) for (let a = 0; a < nx - 1; a++) {
      const v = b * nx + a;
      idx.push(v, v + nx, v + nx + 1, v, v + nx + 1, v + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * nz * 3), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.bg = new THREE.Mesh(geo, this.bgMaterial);
    this.bg.receiveShadow = true;
    this.bgZ = z;
    this.group.add(this.bg);
    this.colorBackground(null);
  }

  /** Kolory tła: las (ciemna zieleń), wyżej kosówka i hale; zimą biało powyżej linii śniegu (z mapy). */
  colorBackground(snowLineM: number | null): void {
    if (!this.bg || !this.bgZ) return;
    const col = this.bg.geometry.getAttribute('color') as THREE.BufferAttribute;
    const nrm = this.bg.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const w = this.p.terrain.snowLineWidthM;
    for (let v = 0; v < this.bgZ.length; v++) {
      const h = this.bgZ[v];
      const slope = 1 - nrm.getY(v);
      const t = Math.max(0, Math.min(1, (h - 1250) / 200));
      // Las okolicy (bez mapy pokrycia): plamy z szumu, rzadziej wyżej – w oddali las jest ciemny, hale białe.
      const px = (this.bg.geometry.getAttribute('position') as THREE.BufferAttribute).getX(v);
      const pz = (this.bg.geometry.getAttribute('position') as THREE.BufferAttribute).getZ(v);
      const nf = valueNoise(px / 420, pz / 420) * 0.65 + valueNoise(px / 130, pz / 130) * 0.35;
      const forest = (1 - t) * (nf > 0.38 ? 1 : 0.15);
      let r = 0.12 + 0.2 * t;
      let g = 0.18 + 0.18 * t;
      let b = 0.11 + 0.12 * t;
      if (snowLineM !== null) {
        const s = Math.max(0, Math.min(1, (h - snowLineM) / w)) * (1 - 0.5 * Math.max(0, Math.min(1, (slope - 0.4) / 0.3)));
        const sf = s * (1 - 0.85 * forest); // las przysłania śnieg
        r = r + (0.92 - r) * sf;
        g = g + (0.94 - g) * sf;
        b = b + (0.97 - b) * sf;
      }
      if (snowLineM === null) {
        r = r + (0.3 - r) * (1 - forest) * (1 - t);
        g = g + (0.42 - g) * (1 - forest) * (1 - t);
        b = b + (0.18 - b) * (1 - forest) * (1 - t);
      }
      col.setXYZ(v, r, g, b);
    }
    col.needsUpdate = true;
  }

  /** Śnieg z modelu (null – lato / jeszcze brak): grubość, stan, muldy. */
  setSnow(s: { depthCm: Float32Array; quality: Uint8Array; moguls?: Uint8Array | null } | null): void {
    const n = this.inp.hf.widthCells * this.inp.hf.heightCells;
    this.uniforms.uHasSnow.value = s ? 1 : 0;
    this.snowVersion++;
    if (!s) {
      // Lato: tło bez śniegu, powierzchnia = sam teren.
      this.depth.depthM.fill(0);
      this.depthTex.needsUpdate = true;
      this.colorBackground(null);
      return;
    }
    for (let k = 0; k < n; k++) {
      const cm = s.depthCm[k];
      this.depth.depthM[k] = Number.isFinite(cm) && cm > 0 ? cm / 100 : 0;
      this.snowData[k * 4] = Math.max(0, Math.min(255, Math.round(s.depthCm[k] || 0)));
      this.stateData[k * 4] = s.quality[k];
      this.stateData[k * 4 + 1] = s.moguls ? s.moguls[k] & 15 : 0;
    }
    this.snowTex.needsUpdate = true;
    this.stateTex.needsUpdate = true;
    this.depthTex.needsUpdate = true;
    // Linia śniegu dla tła: najniższy pas wysokości ze średnio ≥ 10 cm.
    const hf = this.inp.hf;
    const bands = new Map<number, { s: number; n: number }>();
    for (let k = 0; k < n; k++) {
      const z = hf.elevationM[k];
      if (!Number.isFinite(z)) continue;
      const b = Math.floor(z / 50);
      const e = bands.get(b) ?? { s: 0, n: 0 };
      e.s += s.depthCm[k] || 0;
      e.n++;
      bands.set(b, e);
    }
    const sorted = [...bands.entries()].sort((a, b) => a[0] - b[0]);
    const hit = sorted.find(([, e]) => e.s / e.n >= 10);
    this.colorBackground(hit ? hit[0] * 50 : 2500);
  }

  /** Trasy (maska komórek) i oświetlone trasy. */
  setPistes(cells: { cells: number[]; lit: boolean }[]): void {
    const n = this.inp.hf.widthCells * this.inp.hf.heightCells;
    for (let k = 0; k < n; k++) {
      this.snowData[k * 4 + 1] = 0;
      this.stateData[k * 4 + 2] = 0;
    }
    for (const p of cells) {
      for (const k of p.cells) {
        // G (filtr liniowy – gładkie brzegi): 128 – trasa, 255 – trasa oświetlona.
        this.snowData[k * 4 + 1] = Math.max(this.snowData[k * 4 + 1], p.lit ? 255 : 128);
      }
    }
    this.snowTex.needsUpdate = true;
    this.stateTex.needsUpdate = true;
  }

  /** Etap 3D-1: nakładka danych (płótno z kolorami na całą mapę) albo null. */
  setOverlay(o: { canvas: HTMLCanvasElement; version: number; opacity: number } | null): void {
    if (!o) {
      this.uniforms.uOverlayOn.value = 0;
      return;
    }
    if (o.canvas !== this.overlayCanvas) {
      this.overlayTex?.dispose();
      this.overlayCanvas = o.canvas;
      this.overlayTex = new THREE.CanvasTexture(o.canvas);
      this.overlayTex.flipY = false;
      this.overlayTex.colorSpace = THREE.SRGBColorSpace;
      this.overlayTex.magFilter = THREE.LinearFilter;
      this.overlayTex.minFilter = THREE.LinearFilter;
      this.overlayTex.generateMipmaps = false;
      this.uniforms.uOverlay.value = this.overlayTex;
      this.overlayVersion = o.version;
    } else if (o.version !== this.overlayVersion && this.overlayTex) {
      this.overlayTex.needsUpdate = true;
      this.overlayVersion = o.version;
    }
    this.uniforms.uOverlayOn.value = Math.min(1, o.opacity + 0.15);
  }

  setValleyFog(topM: number, strength: number): void {
    this.uniforms.uValleyTop.value = topM;
    this.uniforms.uValleyFog.value = strength;
  }

  setSeason(summer: boolean, night: number): void {
    this.uniforms.uSummer.value = summer ? 1 : 0;
    this.uniforms.uNight.value = night;
  }

  /** Co klatkę: poziom szczegółowości kawałków wg odległości kamery (geometria budowana przy pierwszej potrzebie). */
  update(camPos: THREE.Vector3, frustum: THREE.Frustum): void {
    let tris = 0;
    const box = new THREE.Box3();
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(camPos.x - c.def.cx, camPos.z - c.def.cz) - c.def.radiusM);
      const dist = Math.hypot(d, Math.max(0, camPos.y - 1500));
      const level = Math.min(3, lodLevel(dist, this.p.terrain.lodDistancesM));
      if (level !== c.level) {
        if (c.level >= 0 && c.lods[c.level]) c.lods[c.level]!.visible = false;
        if (!c.lods[level]) {
          const g = buildChunk(this.inp.hf, c.def, 1 << level, this.p.terrain.skirtM);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
          geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
          geo.computeBoundingBox();
          geo.computeBoundingSphere();
          const mesh = new THREE.Mesh(geo, this.material);
          mesh.receiveShadow = true;
          mesh.castShadow = true;
          mesh.userData.tris = g.indices.length / 3;
          this.group.add(mesh);
          c.lods[level] = mesh;
        }
        c.lods[level]!.visible = true;
        c.level = level;
      }
      const m = c.lods[c.level]!;
      box.copy(m.geometry.boundingBox!);
      if (frustum.intersectsBox(box)) tris += m.userData.tris as number;
    }
    this.triangles = tris + (this.bg ? (this.bg.geometry.index!.count / 3) : 0) + (this.patch?.visible ? (this.patch.userData.tris as number) : 0);
  }

  /** Przewyższenie grubości śniegu (1 – skala prawdziwa; suwak tylko w menu Dev). */
  setSnowExaggeration(v: number): void {
    if (v === this.snowU.uSnowExag.value) return;
    this.snowU.uSnowExag.value = v;
    this.snowVersion++;
  }

  get snowExaggeration(): number {
    return this.snowU.uSnowExag.value;
  }

  /** Jakość: bok łaty gęstej siatki przy kamerze i jej krok [m] (bok 0 – bez łaty, rzeźba tylko w cieniowaniu). */
  setPatchQuality(sizeM: number, stepM: number, fadeM: number): void {
    if (sizeM === this.patchSizeM && stepM === this.patchStepM && fadeM === this.patchFadeM) return;
    this.patchSizeM = sizeM;
    this.patchStepM = stepM;
    this.patchFadeM = fadeM;
    this.patchKey = '';
  }

  /** Warstwa detalu 1 m (sztruks, ślady, świeży śnieg, muldy, pryzmy) albo null. */
  setDetail(d: { src: DetailSource; gameH: number; fadeH: number; pileDensityKgM3: number } | null): void {
    this.detail = d;
  }

  /**
   * Powierzchnia śniegu w punkcie: teren + grubość (ten sam wzór co shader, dwuliniowo ze środków komórek);
   * poza mapą – teren okolicy. Ludzie, linie, wskazywanie myszą i kamera stoją na tej powierzchni.
   */
  surfaceAt(x: number, z: number): number {
    const hf = this.inp.hf;
    if (x >= 0 && z >= 0 && x <= hf.widthCells * hf.cellSizeM && z <= hf.heightCells * hf.cellSizeM) {
      const h = snowSurfaceAt(hf, this.uniforms.uHasSnow.value > 0.5 ? this.depth : null, this.snowU.uSnowExag.value, x, z);
      if (Number.isFinite(h)) return h;
    }
    return this.groundAt(x, z);
  }

  /**
   * Co klatkę: łata gęstej siatki wokół celu kamery – przebudowa przy przesunięciu o ćwierć boku, nowym
   * śniegu albo zmianie warstwy detalu (najwyżej raz na 8 s).
   */
  updatePatch(cx: number, cz: number, nowMs: number): void {
    if (this.patchSizeM <= 0 || this.uniforms.uHasSnow.value < 0.5 || !Number.isFinite(cx)) {
      if (this.patch) this.patch.visible = false;
      this.uniforms.uPatchOn.value = 0;
      this.uniforms.uDetailOn.value = 0;
      return;
    }
    const size = this.patchSizeM;
    const moved = !Number.isFinite(this.patchCenter.x) || Math.hypot(cx - this.patchCenter.x, cz - this.patchCenter.z) > size / 4;
    const dv = this.detail?.src.version ?? -1;
    // Przesunięcie, nowy śnieg, zmiana jakości – od razu; sama warstwa detalu (ślady, ratrak) i upływ
    // czasu (blednięcie sztruksu) – najwyżej co 8 s (przebudowa łaty to ok. 25–35 ms pracy procesora).
    const hard = `${size}|${this.patchStepM}|${this.patchFadeM}|${this.snowVersion}`;
    const soft = `${dv}|${this.detail ? Math.floor(this.detail.gameH * 3) : 0}`;
    const key = `${hard}#${soft}`;
    if (!moved && key === this.patchKey) return;
    if (!moved && this.patchKey.startsWith(`${hard}#`) && nowMs - this.patchBuiltMs < 8000) return;
    const t0 = performance.now();
    this.patchKey = key;
    this.patchBuiltMs = nowMs;
    const hf = this.inp.hf;
    const o = patchOrigin(cx, cz, size, hf.cellSizeM);
    this.patchCenter = { x: cx, z: cz };
    if (this.detail && dv !== this.reliefVersion) {
      this.relief = reliefFrom(this.detail.src, this.detail.pileDensityKgM3);
      this.reliefVersion = dv;
    }
    const pg = buildPatch(hf, this.depth, this.snowU.uSnowExag.value, this.detail ? this.relief : null, o.x0, o.z0, size, this.patchStepM, this.patchFadeM);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pg.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(pg.indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    if (!this.patch) {
      this.patch = new THREE.Mesh(geo, this.patchMaterialNear);
      this.patch.receiveShadow = true;
      this.patch.castShadow = true;
      this.patch.frustumCulled = false;
      this.group.add(this.patch);
    } else {
      this.patch.geometry.dispose();
      this.patch.geometry = geo;
    }
    this.patch.visible = true;
    this.patch.userData.tris = pg.indices.length / 3;
    // Wysokości z NaN (poza mapą) – łata tylko tam, gdzie jest siatka gry: teren bazowy znika w prostokącie.
    this.uniforms.uPatchRect.value.set(o.x0, o.z0, o.x0 + size, o.z0 + size);
    this.uniforms.uPatchOn.value = 1;
    this.fillDetailTexture(o.x0, o.z0, size);
    this.patchMs = performance.now() - t0;
  }

  /** Tekstura detalu 1 m w łacie: R – widoczność sztruksu, G – kierunek przejazdu, B – ślady nart, A – świeży śnieg. */
  private fillDetailTexture(x0: number, z0: number, size: number): void {
    const d = this.detail;
    if (!d) {
      this.uniforms.uDetailOn.value = 0;
      return;
    }
    const L = d.src;
    const S = Math.max(1, Math.round(size / L.p.cellM));
    if (!this.detailTex || this.detailTex.image.width !== S) {
      this.detailTex?.dispose();
      this.detailTex = new THREE.DataTexture(new Uint8Array(S * S * 4), S, S, THREE.RGBAFormat);
      this.detailTex.magFilter = THREE.NearestFilter;
      this.detailTex.minFilter = THREE.NearestFilter;
      this.uniforms.uDetailTex.value = this.detailTex;
    }
    const buf = this.detailTex.image.data as Uint8Array;
    buf.fill(0);
    const hf = this.inp.hf;
    const W = hf.widthCells;
    const cs = hf.cellSizeM;
    for (let bi = 0; bi < L.cells.length; bi++) {
      const k = L.cells[bi];
      const bx = (k % W) * cs;
      const bz = Math.floor(k / W) * cs;
      if (bx + cs < x0 || bz + cs < z0 || bx >= x0 + size || bz >= z0 + size) continue;
      for (let r = 0; r < L.per; r++) {
        const wx = bx + ((r % L.sub) + 0.5) * L.p.cellM;
        const wz = bz + (Math.floor(r / L.sub) + 0.5) * L.p.cellM;
        const px = Math.floor((wx - x0) / L.p.cellM);
        const pz = Math.floor((wz - z0) / L.p.cellM);
        if (px < 0 || pz < 0 || px >= S || pz >= S) continue;
        const idx = bi * L.per + r;
        const age = d.gameH - L.groomT[idx];
        const vis = age >= 0 && age < 1e8 ? Math.exp(-age / d.fadeH) : 0;
        const fresh = L.fresh[idx] / 255;
        const o = (pz * S + px) * 4;
        buf[o] = Math.round(255 * vis * (1 - fresh));
        buf[o + 1] = L.groomDir[idx];
        buf[o + 2] = L.tracks[idx];
        buf[o + 3] = L.fresh[idx];
      }
    }
    this.detailTex.needsUpdate = true;
    this.uniforms.uDetailRect.value.set(x0, z0, size, 1 / size);
    this.uniforms.uDetailOn.value = 1;
  }

  /** Wysokość terenu w punkcie (siatka gry; poza nią teren okolicy). */
  groundAt(x: number, z: number): number {
    const hf = this.inp.hf;
    if (x >= 0 && z >= 0 && x <= hf.widthCells * hf.cellSizeM && z <= hf.heightCells * hf.cellSizeM) {
      const h = sampleHeight(hf, x, z);
      if (Number.isFinite(h)) return h;
    }
    const dem = this.inp.dem;
    if (!dem) return NaN;
    const i = Math.floor((x + this.inp.mapWestE - dem.westEastingM) / dem.cellSizeM);
    const j = Math.floor((dem.northNorthingM - (this.inp.mapNorthN - z)) / dem.cellSizeM);
    if (i < 0 || j < 0 || i >= dem.widthCells || j >= dem.heightCells) return NaN;
    return dem.elevationM[j * dem.widthCells + i];
  }
}

/** Szum wartości 0–1 (tło okolicy – plamy lasu), deterministyczny. */
function valueNoise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const h = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * sx;
  const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
  return a + (b - a) * sy;
}
