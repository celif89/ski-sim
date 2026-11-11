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
uniform float uHasSnow;
uniform float uSummer;
uniform float uNight;
uniform float uPisteLight;
uniform float uValleyTop;
uniform float uValleyFog;
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
  };
  private overlayTex: THREE.CanvasTexture | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayVersion = -1;
  /** Liczba trójkątów rysowanych w ostatniej klatce (licznik). */
  triangles = 0;

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
    this.uniforms.uPisteLight.value = p.atmosphere.pisteLightIntensity;
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    this.patchMaterial(this.material);
    this.bgMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    // Tło okolicy: drobne plamki (korony drzew, hale) – bez nich z daleka wygląda jak mgła.
    this.bgMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vBgXZ;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBgXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vBgXZ;\n${GLSL_COMMON}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb *= 0.7 + 0.55 * vnoise(vBgXZ * 0.06) * vnoise(vBgXZ * 0.013 + 3.0);`);
    };
    for (const def of chunkGrid(hf, p.terrain.chunkCells)) this.chunks.push({ def, lods: [null, null, null, null], level: -1 });
    this.buildBackground();
  }

  /** Materiał terenu: barwa i szorstkość z tekstur danych, nierówności (sztruks, muldy), światło tras nocą. */
  patchMaterial(m: THREE.MeshStandardMaterial): void {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      prev?.call(m, shader, r);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWorld;\nvarying vec3 vNormalW;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvNormalW = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
  vec2 muv = vWorld.xz / uMapSize;
  vec4 sd = texture2D(uSnowTex, muv);
  vec4 st = texture2D(uStateTex, muv);
  float depthCm = sd.r * 255.0 * uHasSnow;
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
  else if (q == 5) { snowC = vec3(0.80, 0.82, 0.81); rough = 0.45; }
  else if (q == 6) { snowC = vec3(0.80, 0.88, 0.96); rough = 0.22; }
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
      // Sztruks: prążki co 1,2 m w poprzek przejazdu ratraka (wzdłuż linii spadku) – na ubitych trasach.
      if (sd.g > 0.3 && (q == 2 || q == 3 || q == 4)) {
        float ph = dot(vWorld.xz, ac) * 6.2831 / 1.2;
        dW.xz += ac * cos(ph) * 0.18 * near;
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
  totalEmissiveRadiance += vec3(1.0, 0.84, 0.58) * smoothstep(0.55, 1.0, sd.g) * lamp * uNight * uPisteLight * mix(0.25, 1.0, cover);`,
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
    if (!s) {
      // Lato: tło bez śniegu.
      this.colorBackground(null);
      return;
    }
    for (let k = 0; k < n; k++) {
      this.snowData[k * 4] = Math.max(0, Math.min(255, Math.round(s.depthCm[k] || 0)));
      this.stateData[k * 4] = s.quality[k];
      this.stateData[k * 4 + 1] = s.moguls ? s.moguls[k] & 15 : 0;
    }
    this.snowTex.needsUpdate = true;
    this.stateTex.needsUpdate = true;
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
    this.triangles = tris + (this.bg ? (this.bg.geometry.index!.count / 3) : 0);
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
