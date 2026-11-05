/**
 * Podziałka liniowa: dobiera „okrągłą” długość odcinka (1, 2 lub 5 × 10ⁿ m), która przy danej
 * skali mieści się w zadanej szerokości na ekranie. Czysta matematyka – testowana w Vitest.
 */
export interface ScaleBar {
  lengthM: number;
  widthPx: number;
  label: string;
}

const NICE_STEPS = [1, 2, 5];

export function computeScaleBar(metersPerPixel: number, maxWidthPx: number): ScaleBar {
  const maxLengthM = metersPerPixel * maxWidthPx;
  let exponent = Math.floor(Math.log10(maxLengthM));
  let lengthM = 0;
  // Szukamy największej „okrągłej” długości nie większej niż maxLengthM.
  while (lengthM === 0) {
    const power = 10 ** exponent;
    for (const step of NICE_STEPS) {
      const candidate = step * power;
      if (candidate <= maxLengthM * (1 + 1e-9)) lengthM = candidate;
    }
    exponent--;
  }
  return { lengthM, widthPx: lengthM / metersPerPixel, label: formatDistance(lengthM) };
}

export function formatDistance(lengthM: number): string {
  if (lengthM >= 1000) return `${formatNumber(lengthM / 1000)} km`;
  return `${formatNumber(lengthM)} m`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
}
