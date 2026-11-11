/**
 * Etap 3D-3: parametry oprawy widoku 3D (śnieg, światło, obraz) z `data/map-style.json`, sekcja
 * `render3d` – przy każdej wartości opis w pliku. Suwaki w menu Dev zmieniają je od razu,
 * „Kopiuj ustawienia” daje JSON do wklejenia w plik.
 */
export const LOOK_KEYS = [
  'snowExaggeration',
  'sunIntensity',
  'sunWarmLow',
  'sunCloudDim',
  'skyBase',
  'skyCloudBoost',
  'skyBlue',
  'fogDensity',
  'fogCloudBoost',
  'fogPrecipBoost',
  'farHaze',
  'exposure',
  'saturation',
  'contrast',
  'warmth',
  'sparkle',
  'iceRoughness',
  'slushRoughness',
  'shadowSoftness',
  'aoIntensity',
  'windowGlow',
  'pisteLight',
  'corduroyRelief',
  'trackRelief',
  'patchFadeM',
  'treeSnowFullM',
  'roofSnowFullM',
] as const;

export type LookKey = (typeof LOOK_KEYS)[number];
export type Look = Record<LookKey, number>;

export function parseLook(mapStyle: unknown): Look {
  const sec = (mapStyle as { render3d?: Record<string, { value?: unknown }> }).render3d;
  if (!sec) throw new Error('data/map-style.json: brak sekcji render3d');
  const out = {} as Look;
  for (const k of LOOK_KEYS) {
    const v = sec[k]?.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`data/map-style.json: render3d.${k} musi być liczbą`);
    out[k] = v;
  }
  return out;
}

/** Suwaki menu Dev (ścieżka = klucz parametru). */
export const LOOK_SLIDERS: { path: LookKey; label: string; min: number; max: number; step: number }[] = [
  { path: 'snowExaggeration', label: 'Przewyższenie śniegu (tylko podgląd)', min: 0, max: 10, step: 0.5 },
  { path: 'sunIntensity', label: 'Słońce – siła', min: 0, max: 8, step: 0.1 },
  { path: 'sunWarmLow', label: 'Słońce nisko – ciepła barwa', min: 0, max: 0.8, step: 0.02 },
  { path: 'sunCloudDim', label: 'Słońce za chmurami – osłabienie', min: 0, max: 1, step: 0.05 },
  { path: 'skyBase', label: 'Niebo – światło', min: 0, max: 2, step: 0.05 },
  { path: 'skyCloudBoost', label: 'Niebo – więcej przy chmurach', min: 0, max: 1.5, step: 0.05 },
  { path: 'skyBlue', label: 'Niebo – niebieskie cienie', min: 0, max: 1, step: 0.05 },
  { path: 'fogDensity', label: 'Mgiełka – gęstość', min: 0, max: 0.0003, step: 0.000005 },
  { path: 'fogCloudBoost', label: 'Mgiełka – przy chmurach', min: 0, max: 3, step: 0.1 },
  { path: 'fogPrecipBoost', label: 'Mgiełka – przy opadzie', min: 0, max: 6, step: 0.1 },
  { path: 'farHaze', label: 'Dalekie góry – blednięcie', min: 0, max: 1, step: 0.05 },
  { path: 'exposure', label: 'Ekspozycja', min: 0.3, max: 2.5, step: 0.05 },
  { path: 'saturation', label: 'Nasycenie', min: 0.5, max: 1.6, step: 0.02 },
  { path: 'contrast', label: 'Kontrast', min: 0.7, max: 1.4, step: 0.02 },
  { path: 'warmth', label: 'Ciepło obrazu', min: -0.08, max: 0.08, step: 0.005 },
  { path: 'sparkle', label: 'Iskrzenie puchu', min: 0, max: 3, step: 0.05 },
  { path: 'iceRoughness', label: 'Lód – szorstkość', min: 0.02, max: 1, step: 0.02 },
  { path: 'slushRoughness', label: 'Breja – szorstkość', min: 0.02, max: 1, step: 0.02 },
  { path: 'shadowSoftness', label: 'Cienie – miękkość', min: 0, max: 8, step: 0.25 },
  { path: 'aoIntensity', label: 'Zagłębienia (AO) – siła', min: 0, max: 1.5, step: 0.05 },
  { path: 'windowGlow', label: 'Okna nocą', min: 0, max: 4, step: 0.1 },
  { path: 'pisteLight', label: 'Oświetlenie tras', min: 0, max: 2, step: 0.05 },
  { path: 'corduroyRelief', label: 'Sztruks – rzeźba', min: 0, max: 0.6, step: 0.02 },
  { path: 'trackRelief', label: 'Ślady nart – rzeźba', min: 0, max: 1, step: 0.05 },
  { path: 'patchFadeM', label: 'Łata detalu – wygaszanie brzegu [m]', min: 1, max: 30, step: 1 },
  { path: 'treeSnowFullM', label: 'Czapy na drzewach – pełne od [m]', min: 0.02, max: 1, step: 0.02 },
  { path: 'roofSnowFullM', label: 'Śnieg na dachu – pełny od [m]', min: 0.01, max: 0.5, step: 0.01 },
];

/** JSON do wklejenia w data/map-style.json (sekcja render3d – same wartości). */
export function lookToJson(l: Look): string {
  return JSON.stringify(Object.fromEntries(LOOK_KEYS.map((k) => [k, l[k]])), null, 2);
}

/**
 * Kierunek do Słońca w układzie sceny 3D (x – wschód, y – w górę, z – południe) z azymutu (od północy,
 * w stronę wschodu) i wysokości nad horyzontem z `sim/sun.ts` – wektor jednostkowy.
 */
export function sunDirection(azimuthDeg: number, elevationDeg: number): { x: number; y: number; z: number } {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}
