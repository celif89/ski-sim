/**
 * Etap 3D-0: prototyp widoku 3D (Three.js) obok mapy 2D – tylko do oglądania (budowanie zostaje w 2D).
 * Łączy: teren z modelem śniegu, las, obiekty ośrodka, gości; Słońce z naszego modelu (data, godzina,
 * położenie), cienie kaskadowe (CSM), niebo (Preetham), mgła z odległością i w dolinach, noc
 * z oświetleniem tras; efekty końcowe: przyciemnienie zagłębień (GTAO), mapowanie tonów (ACES),
 * delikatna korekcja barw; trzy ustawienia jakości. Kamera jak w Cities: Skylines (cameraRig.ts).
 */
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { HorizonDem } from '../sim/horizon';
import type { LiftParams, PointM } from '../sim/lifts';
import type { ResortAnalysis, ResortLayout } from '../sim/resort';
import type { ResortDrawState } from '../render/resortLayer';
import { sunPosition } from '../sim/sun';
import type { TerrainGrid } from '../sim/terrainGrid';
import { localToUtcMs } from '../sim/time';
import type { CalendarDate, Location } from '../sim';
import type { RigState } from './cameraRig';
import { CAMERA_KEYS, cameraPosition, groundAxes, keepAboveTerrain, zoomToward } from './cameraRig';
import { Forest3D } from './forest3d';
import { Objects3D } from './objects3d';
import type { Quality, Render3DParams } from './params';
import type { NetworkStatic } from './network3d';
import { Network3D } from './network3d';
import { People3D } from './people3d';
import { governStep } from './governor';
import type { GovernorState } from './governor';
import type { PickView } from './picking';
import { Camera3DAdapter } from './picking';
import { Terrain3D } from './terrain3d';

export interface View3DSources {
  grid: TerrainGrid;
  forest: Float32Array | null;
  shrub: Float32Array | null;
  built: Float32Array | null;
  dem(): HorizonDem | null;
  mapWestE: number;
  mapNorthN: number;
  location: Location;
  lp: LiftParams;
  osmBuildings: PointM[][];
  layout(): { layout: ResortLayout; analysis: ResortAnalysis };
  snow(): { depthCm: Float32Array; quality: Uint8Array; moguls?: Uint8Array } | null;
  summer(): boolean;
  date(): CalendarDate;
  hour(): number;
  /** Zachmurzenie 0–1 z modelu pogody (słabsze Słońce, więcej światła rozproszonego). */
  cloud(): number;
  gameTimeS(): number;
  frame(): { data: Float32Array<ArrayBufferLike>; count: number; timeS: number; summer: boolean };
  groomers(): { xM: number; yM: number; headingRad: number; lightsOn: boolean }[];
  plumes(): { xM: number; yM: number; aimXM: number; aimYM: number; rateM3h: number; windFromDeg: number; windMs: number }[];
  /** Etap 3D-1: stan rysowania mapy 2D (układ, zaznaczenie, podglądy) i stałe linie z OSM. */
  drawState(): ResortDrawState | null;
  network: NetworkStatic;
  /** Etap 3D-1: nakładka danych z mapy 2D (płótno, numer zmiany, krycie) albo null. */
  overlay(): { canvas: HTMLCanvasElement; version: number; opacity: number } | null;
}

export interface View3DStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  treesNear: number;
  treesFar: number;
  people: number;
  carriers: number;
}

const COLOR_GRADE = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.08 }, uContrast: { value: 1.04 }, uWarm: { value: 0.015 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat; uniform float uContrast; uniform float uWarm; varying vec2 vUv;
  void main() { vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = mix(vec3(l), c.rgb, uSat); c.rgb = (c.rgb - 0.5) * uContrast + 0.5; c.rgb += vec3(uWarm, 0.0, -uWarm); gl_FragColor = c; }`,
};

export class View3D {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky = new Sky();
  private readonly hemi = new THREE.HemisphereLight(0xdfe8f5, 0x3b3226, 0.6);
  private csm: CSM | null = null;
  private composer: EffectComposer | null = null;
  private readonly terrain: Terrain3D;
  private readonly forest: Forest3D | null;
  private readonly objects: Objects3D;
  private readonly people: People3D;
  private readonly network: Network3D;
  private quality: Quality = 1;
  private rig: RigState;
  private running = false;
  private raf = 0;
  private lastT = performance.now();
  private keys = new Set<string>();
  private drag: { button: number; x: number; y: number } | null = null;
  private lastLayout: unknown = null;
  private lastSnow: unknown = undefined;
  private frames = 0;
  private fpsT = performance.now();
  private cpuSum = 0;
  readonly stats: View3DStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, treesNear: 0, treesFar: 0, people: 0, carriers: 0 };
  private readonly materials: THREE.Material[] = [];
  /** Etap 3D-1: automatyczna płynność (skala rozdzielczości i zasięgu drzew względem jakości). */
  private gov: GovernorState = { resolutionScale: 1, treeScale: 1 };
  private govT = performance.now();
  private govFrames = 0;
  autoQuality = true;
  private readonly ownCompile = new WeakMap<THREE.Material, THREE.Material['onBeforeCompile']>();

  constructor(
    parent: HTMLElement,
    private readonly src: View3DSources,
    private readonly p: Render3DParams,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view3d-canvas';
    parent.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = p.atmosphere.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const g = src.grid;
    const hf = { widthCells: g.widthCells, heightCells: g.heightCells, cellSizeM: g.cellSizeM, elevationM: g.elevationM };
    this.camera = new THREE.PerspectiveCamera(p.camera.fovDeg, 1, 2, 60000);
    this.terrain = new Terrain3D({ hf, forest: src.forest, shrub: src.shrub, built: src.built, dem: src.dem(), mapWestE: src.mapWestE, mapNorthN: src.mapNorthN }, p);
    this.forest = src.forest ? new Forest3D(hf, src.forest, src.shrub, p) : null;
    const groundAt = (x: number, z: number) => this.terrain.groundAt(x, z);
    this.objects = new Objects3D({ groundAt, lp: src.lp, p, osmBuildings: src.osmBuildings, forest: src.forest, widthCells: g.widthCells, cellSizeM: g.cellSizeM });
    this.people = new People3D(p.quality.peopleMax[2], p.people.heightM, p.people.seatHeightM);
    this.network = new Network3D(groundAt, src.network);
    this.scene.add(this.terrain.group, this.objects.group, this.people.group, this.network.group, this.hemi);
    if (this.forest) this.scene.add(this.forest.group);
    this.sky.scale.setScalar(45000);
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(0xcfd9e6, p.atmosphere.fogDensity);
    // Start: widok na Pilsko od Korbielowa (od północy), z wysoka.
    const W = g.widthCells * g.cellSizeM;
    const H = g.heightCells * g.cellSizeM;
    this.rig = { tx: W / 2, ty: groundAt(W / 2, H / 2) || 1000, tz: H / 2, distanceM: 4200, yawRad: 0, pitchRad: (38 * Math.PI) / 180 };
    this.collectMaterials();
    this.setQuality(1);
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
  }

  /** Metry na piksel na metr odległości od kamery (2·tg(pół kąta widzenia) / wysokość okna). */
  get pxScale(): number {
    return (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.canvas.clientHeight || window.innerHeight);
  }

  get active(): boolean {
    return this.running;
  }

  get qualityLevel(): Quality {
    return this.quality;
  }

  /** Materiały, które dostają cienie kaskadowe. */
  private collectMaterials(): void {
    const seen = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) if (mm instanceof THREE.MeshStandardMaterial && !seen.has(mm)) seen.add(mm);
    });
    this.materials.push(this.terrain.material);
    if (this.forest) this.materials.push(this.forest.treeMaterial);
    for (const m of seen) if (!this.materials.includes(m)) this.materials.push(m);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const qp = this.p.quality;
    if (this.csm) {
      this.csm.remove();
      this.csm.dispose();
    }
    this.csm = new CSM({
      maxFar: qp.shadowFarM[q],
      cascades: qp.shadowCascades[q],
      mode: 'practical',
      parent: this.scene,
      shadowMapSize: qp.shadowMapPx[q],
      lightDirection: new THREE.Vector3(0.3, -1, 0.4).normalize(),
      camera: this.camera,
      shadowBias: -0.0004,
      lightNear: 1,
      lightFar: 20000,
      lightMargin: 600,
    });
    for (const m of this.materials) {
      // Własne zmiany shadera materiału zapamiętane raz – przy zmianie jakości łańcuch budowany od nowa.
      let mine = this.ownCompile.get(m);
      if (!mine) {
        mine = m.onBeforeCompile;
        this.ownCompile.set(m, mine);
      }
      this.csm.setupMaterial(m);
      const csmFn = m.onBeforeCompile;
      const own = mine;
      m.onBeforeCompile = (s, r) => {
        csmFn.call(m, s, r);
        own.call(m, s, r);
      };
      // Klucz programu: bez niego Three.js mógłby użyć jednego shadera dla materiałów z różnymi zmianami.
      const key = `csm${q}-${m.uuid}`;
      m.customProgramCacheKey = () => key;
      m.needsUpdate = true;
    }
    this.gov = { resolutionScale: 1, treeScale: 1 };
    this.applyGovernor();
    this.buildComposer();
    this.resize();
  }

  private applyGovernor(): void {
    const qp = this.p.quality;
    if (this.forest) this.forest.nearM = qp.treesNearM[this.quality] * this.gov.treeScale;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * qp.pixelRatio[this.quality] * this.gov.resolutionScale);
  }

  /** Stan automatycznej płynności (licznik w menu Dev). */
  get governor(): GovernorState {
    return this.gov;
  }

  private buildComposer(): void {
    this.composer?.dispose();
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (this.p.quality.ao[this.quality]) {
      const g = new GTAOPass(this.scene, this.camera, this.canvas.clientWidth || 1280, this.canvas.clientHeight || 720);
      g.output = GTAOPass.OUTPUT.Default;
      g.blendIntensity = 0.85;
      g.updateGtaoMaterial({ radius: 6, distanceExponent: 1.5, thickness: 2, scale: 1 });
      c.addPass(g);
    }
    c.addPass(new OutputPass());
    c.addPass(new ShaderPass(COLOR_GRADE));
    this.composer = c;
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
  }

  /** loop = false – bez pętli klatek (zrzuty w kontenerze bez karty graficznej: renderOnce). */
  show(loop = true): void {
    this.canvas.style.display = 'block';
    this.running = true;
    this.resize();
    this.lastT = performance.now();
    if (!loop) return;
    const tick = () => {
      if (!this.running) return;
      this.frame();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.style.display = 'none';
    this.keys.clear();
  }

  /** Widok z góry nad bieżącym celem. */
  topView(): void {
    this.rig = { ...this.rig, pitchRad: (this.p.camera.maxPitchDeg * Math.PI) / 180, yawRad: 0 };
  }

  /** Ustawienie kamery (zrzuty ekranu): cel, odległość, obrót i pochylenie w stopniach. */
  setView(v: { x: number; z: number; distanceM: number; yawDeg: number; pitchDeg: number }): void {
    const ty = this.terrain.groundAt(v.x, v.z);
    this.rig = { tx: v.x, ty: Number.isFinite(ty) ? ty : this.rig.ty, tz: v.z, distanceM: v.distanceM, yawRad: (v.yawDeg * Math.PI) / 180, pitchRad: (v.pitchDeg * Math.PI) / 180 };
  }

  /** Jedna klatka na żądanie (zrzuty ekranu w teście). */
  renderOnce(): void {
    this.frame();
  }

  /** Etap 3D-1/3D-2: zdarzenia myszy dla narzędzi (te same, co z mapy 2D). */
  readonly hooks: {
    onClick?: (x: number, y: number) => void;
    onDoubleClick?: (x: number, y: number) => void;
    onRightClick?: (x: number, y: number) => void;
    /** Narzędzie przejmuje przeciąganie lewym przyciskiem (true) – wtedy kamera stoi. */
    onDragStart?: (x: number, y: number) => boolean;
    onDragMove?: (x: number, y: number) => void;
    onDragEnd?: (x: number, y: number) => void;
  } = {};
  /** Kursor nad płótnem 3D (piksele CSS) albo null. */
  cursor: { xPx: number; yPx: number } | null = null;
  /** Przelicznik ekran ↔ mapa dla narzędzi. */
  readonly adapter = new Camera3DAdapter(
    () => this.pickView(),
    (x, z) => this.lookAt(x, z),
  );

  pickView(): PickView {
    return {
      camera: this.camera,
      widthPx: this.canvas.clientWidth || window.innerWidth,
      heightPx: this.canvas.clientHeight || window.innerHeight,
      groundAt: (x, z) => this.terrain.groundAt(x, z),
      targetX: this.rig.tx,
      targetZ: this.rig.tz,
    };
  }

  /**
   * Klik w obiekt nad terenem (lina, podpora, stacja, budynek, znaczek): piksel ekranu punktu terenu
   * pod trafionym miejscem – narzędzia 2D wybierają po położeniu na mapie. Null – nic nad terenem.
   */
  groundUnderObjectAt(xPx: number, yPx: number): { xPx: number; yPx: number } | null {
    const v = this.pickView();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((xPx / v.widthPx) * 2 - 1, -(yPx / v.heightPx) * 2 + 1), this.camera);
    ray.params.Line = { threshold: Math.max(0.5, this.rig.distanceM * 0.004) };
    const terrainHit = this.adapter.pick(xPx, yPx);
    const maxD = terrainHit ? terrainHit.distanceTo(this.camera.position) : Infinity;
    const hits = ray.intersectObjects([this.objects.group, ...this.network.badgeSprites], true);
    const h = hits.find((x) => x.distance < maxD - 0.5 && x.object.visible);
    if (!h) return null;
    return this.adapter.worldToScreen(h.point.x, h.point.z);
  }

  /** Przesunięcie celu kamery nad punkt mapy (odległość i kąty bez zmian). */
  lookAt(x: number, z: number): void {
    const g = this.terrain.groundAt(x, z);
    this.rig = { ...this.rig, tx: x, tz: z, ty: Number.isFinite(g) ? g : this.rig.ty };
  }

  private bindInput(): void {
    const c = this.canvas;
    const local = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { xPx: e.clientX - r.left, yPx: e.clientY - r.top };
    };
    let toolDrag = false;
    let down = { x: 0, y: 0, button: 0 };
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      const p = local(e);
      down = { x: e.clientX, y: e.clientY, button: e.button };
      c.setPointerCapture(e.pointerId);
      toolDrag = e.button === 0 && (this.hooks.onDragStart?.(p.xPx, p.yPx) ?? false);
      this.drag = toolDrag ? null : { button: e.button, x: e.clientX, y: e.clientY };
    });
    c.addEventListener('pointerup', (e) => {
      const p = local(e);
      const small = Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5;
      this.drag = null;
      if (toolDrag) {
        toolDrag = false;
        this.hooks.onDragEnd?.(p.xPx, p.yPx);
        return;
      }
      if (!small) return;
      if (down.button === 0) this.hooks.onClick?.(p.xPx, p.yPx);
      else if (down.button === 2) this.hooks.onRightClick?.(p.xPx, p.yPx);
    });
    c.addEventListener('dblclick', (e) => {
      const p = local(e);
      this.hooks.onDoubleClick?.(p.xPx, p.yPx);
    });
    c.addEventListener('pointerleave', () => {
      if (!this.drag && !toolDrag) {
        this.cursor = null;
        this.adapter.cursor = null;
      }
    });
    c.addEventListener('pointermove', (e) => {
      this.cursor = local(e);
      this.adapter.cursor = this.cursor;
      if (toolDrag) {
        this.hooks.onDragMove?.(this.cursor.xPx, this.cursor.yPx);
        return;
      }
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.drag.button === 0) {
        // Przeciąganie lewym: przesuwanie celu (proporcjonalnie do odległości).
        const k = (this.rig.distanceM / Math.max(400, c.clientHeight)) * 1.2;
        const a = groundAxes(this.rig.yawRad);
        this.rig = { ...this.rig, tx: this.rig.tx - (a.rx * dx - a.fx * dy) * k, tz: this.rig.tz - (a.rz * dx - a.fz * dy) * k };
      } else {
        // Środkowy / prawy: obrót i pochylenie.
        this.rig = { ...this.rig, yawRad: this.rig.yawRad - dx * 0.005, pitchRad: this.rig.pitchRad + dy * 0.005 };
      }
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const f = e.deltaY > 0 ? this.p.camera.zoomStep : 1 / this.p.camera.zoomStep;
        const p = local(e);
        const hit = this.adapter.pick(p.xPx, p.yPx);
        this.rig = hit ? zoomToward(this.rig, f, hit.x, hit.y, hit.z, this.p.camera) : { ...this.rig, distanceM: this.rig.distanceM * f };
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (!this.running || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (CAMERA_KEYS.has(e.code)) this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private updateCamera(dt: number): void {
    const cp = this.p.camera;
    const a = groundAxes(this.rig.yawRad);
    const v = cp.panSpeed * this.rig.distanceM * dt;
    let { tx, tz, yawRad, pitchRad } = this.rig;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
      tx += a.fx * v;
      tz += a.fz * v;
    }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      tx -= a.fx * v;
      tz -= a.fz * v;
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
      tx += a.rx * v;
      tz += a.rz * v;
    }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      tx -= a.rx * v;
      tz -= a.rz * v;
    }
    const rot = (cp.rotateSpeedDegS * Math.PI) / 180 * dt;
    if (this.keys.has('KeyQ')) yawRad += rot;
    if (this.keys.has('KeyE')) yawRad -= rot;
    if (this.keys.has('KeyR')) pitchRad += rot * 0.6;
    if (this.keys.has('KeyF')) pitchRad -= rot * 0.6;
    // Cel na terenie (wysokość celu łagodnie za terenem).
    const g = this.terrain.groundAt(tx, tz);
    const ty = Number.isFinite(g) ? this.rig.ty + (g - this.rig.ty) * Math.min(1, dt * 6) : this.rig.ty;
    this.rig = keepAboveTerrain({ ...this.rig, tx, tz, ty, yawRad, pitchRad }, cp, (x, z) => this.terrain.groundAt(x, z));
    const p = cameraPosition(this.rig);
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.lookAt(this.rig.tx, this.rig.ty, this.rig.tz);
    this.camera.near = Math.max(1, this.rig.distanceM * 0.01);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Słońce, niebo, mgła, noc. */
  private updateSky(): { night: number; elev: number } {
    const d = this.src.date();
    const utc = localToUtcMs({ year: d.year, month: d.month, day: d.day, hour: this.src.hour() }, this.src.location.timeZone);
    const sp = sunPosition(utc, this.src.location.latDeg, this.src.location.lonDeg);
    const el = (sp.elevationDeg * Math.PI) / 180;
    const az = (sp.azimuthDeg * Math.PI) / 180;
    // Kierunek do Słońca: x – wschód, z – południe (północ = −z).
    const toSun = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(toSun);
    u.turbidity.value = 4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    const day = THREE.MathUtils.smoothstep(sp.elevationDeg, -6, 6);
    const low = 1 - THREE.MathUtils.smoothstep(sp.elevationDeg, 0, 15);
    const night = 1 - day;
    const cloud = Math.max(0, Math.min(1, this.src.cloud()));
    u.turbidity.value = 4 + 8 * cloud;
    if (this.csm) {
      this.csm.lightDirection.copy(toSun).negate();
      for (const l of this.csm.lights) {
        l.intensity = 3.4 * day * (1 - 0.55 * low) * (1 - 0.7 * cloud);
        l.color.setRGB(1, 1 - 0.18 * low, 1 - 0.38 * low);
      }
    }
    this.hemi.intensity = Math.max(this.p.atmosphere.nightAmbient * 4, (0.8 + 0.5 * cloud) * day + 0.1);
    this.hemi.color.setRGB(0.75 + 0.2 * day, 0.82 + 0.15 * day, 0.95);
    const fog = this.scene.fog as THREE.FogExp2;
    const dayC = new THREE.Color(0.78, 0.84, 0.92);
    const duskC = new THREE.Color(0.93, 0.78, 0.66);
    const nightC = new THREE.Color(0.03, 0.04, 0.08);
    fog.color.copy(dayC).lerp(new THREE.Color(0.8, 0.82, 0.85), cloud * 0.7).lerp(duskC, 0.7 * low * day * (1 - 0.6 * cloud)).lerp(nightC, night);
    fog.density = this.p.atmosphere.fogDensity * (1 + 0.6 * night);
    this.sky.visible = day > 0.02;
    this.scene.background = day > 0.02 ? null : nightC;
    this.renderer.toneMappingExposure = this.p.atmosphere.exposure * (0.75 + 0.45 * night);
    // Mgła w dolinach: najgęstsza rano i nocą, w południe słabsza.
    const h = this.src.hour();
    const morning = h < 11 ? 1 - Math.max(0, h - 7) / 4 : 0;
    this.terrain.setValleyFog(this.p.atmosphere.valleyFogTopM, this.p.atmosphere.valleyFogStrength * Math.max(0.25, Math.min(1, morning + night)));
    return { night, elev: sp.elevationDeg };
  }

  private syncData(night: number): void {
    const { layout, analysis } = this.src.layout();
    if (layout !== this.lastLayout) {
      this.lastLayout = layout;
      const g = this.src.grid;
      this.objects.setLayout(layout, analysis, (x, z) => g.sampleLayer(g.slopePercent, x, z));
      this.people.setCables(this.objects.cableIndex);
      this.terrain.setPistes(layout.pistes.map((p) => ({ cells: analysis.pistes.get(p.id)?.cells ?? [], lit: p.lit === true })));
      this.forest?.setCleared(analysis.clearedMask ?? null, { widthCells: g.widthCells, heightCells: g.heightCells, cellSizeM: g.cellSizeM, elevationM: g.elevationM });
    }
    const snow = this.src.snow();
    const summer = this.src.summer();
    if (snow !== this.lastSnow) {
      this.lastSnow = snow;
      this.terrain.setSnow(summer ? null : snow);
      let mean = 0;
      if (snow && !summer) {
        let s = 0;
        let n = 0;
        for (let k = 0; k < snow.depthCm.length; k += 7) {
          const v = snow.depthCm[k];
          if (Number.isFinite(v)) {
            s += v;
            n++;
          }
        }
        mean = n ? s / n : 0;
      }
      this.forest?.setSnow(Math.min(1, mean / 25));
      this.objects.setRoofSnow(Math.min(1, mean / 15));
    }
    this.terrain.setSeason(summer, night);
    this.network.setSummer(summer);
    this.network.update(this.src.drawState());
    // Nakładka danych: na terenie; las wtedy schowany (dane pod koronami czytelne jak w 2D).
    const ov = this.src.overlay();
    this.terrain.setOverlay(ov);
    if (this.forest) this.forest.group.visible = !ov;
  }

  private frame(): void {
    const t0 = performance.now();
    const dt = Math.min(0.1, (t0 - this.lastT) / 1000);
    this.lastT = t0;
    this.updateCamera(dt);
    const { night } = this.updateSky();
    this.syncData(night);
    const cam = this.camera.position;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.terrain.update(cam, frustum);
    this.forest?.update(cam);
    const timeS = this.src.gameTimeS();
    this.objects.update(timeS, night, this.src.groomers(), this.src.plumes(), cam);
    this.people.update(this.src.frame(), timeS, (x, z) => this.terrain.groundAt(x, z), cam, Math.max(600, this.rig.distanceM * 1.5));
    this.network.setFrame(this.pxScale, this.pxScale * this.rig.distanceM, this.scene.fog as THREE.FogExp2);
    this.csm?.update();
    this.renderer.info.reset();
    this.renderer.info.autoReset = false;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    const t1 = performance.now();
    this.cpuSum += t1 - t0;
    this.frames++;
    // Automatyczna płynność – co okno pomiaru (tylko w pętli klatek, nie przy zrzutach pojedynczych klatek).
    this.govFrames++;
    const gw = this.p.governor;
    if (this.autoQuality && this.raf && t1 - this.govT > gw.windowS * 1000) {
      const fps = (this.govFrames * 1000) / (t1 - this.govT);
      const next = governStep(this.gov, fps, gw);
      if (next.resolutionScale !== this.gov.resolutionScale || next.treeScale !== this.gov.treeScale) {
        this.gov = next;
        this.applyGovernor();
        this.resize();
      }
      this.govT = t1;
      this.govFrames = 0;
    }
    if (t1 - this.fpsT > 1000) {
      this.stats.fps = (this.frames * 1000) / (t1 - this.fpsT);
      this.stats.frameMs = this.cpuSum / this.frames;
      this.frames = 0;
      this.cpuSum = 0;
      this.fpsT = t1;
    }
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.treesNear = this.forest?.nearCount ?? 0;
    this.stats.treesFar = this.forest?.farCount ?? 0;
    this.stats.people = this.people.drawn;
    this.stats.carriers = this.objects.carrierCount;
  }
}
