/** Odczyt siatki w formacie Arc/Info ASCII Grid (tak oddaje NMT usługa WCS Geoportalu). */

/**
 * Wyciąga siatkę z odpowiedzi WCS w formacie Arc/Info ASCII Grid (opakowanej w multipart).
 */
export function parseAsciiGrid(text: string): { ncols: number; nrows: number; values: Float32Array; nodata: number | null } {
  const start = text.search(/^[ \t]*ncols[ \t]/im);
  if (start < 0) throw new Error('Odpowiedź WCS nie zawiera siatki ASCII:\n' + text.slice(0, 500));
  const body = text.slice(start);
  const header: Record<string, number> = {};
  const lines = body.split(/\r?\n/);
  let lineIndex = 0;
  for (; lineIndex < lines.length; lineIndex++) {
    const m = /^[ \t]*(ncols|nrows|xllcorner|yllcorner|xllcenter|yllcenter|cellsize|nodata_value)\s+(\S+)/i.exec(lines[lineIndex]);
    if (!m) break;
    header[m[1].toLowerCase()] = Number(m[2]);
  }
  const ncols = header.ncols;
  const nrows = header.nrows;
  const values = new Float32Array(ncols * nrows);
  let k = 0;
  for (; lineIndex < lines.length && k < values.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line.startsWith('--')) break;
    for (const token of line.split(/\s+/)) {
      if (token.length === 0) continue;
      values[k++] = Number(token);
    }
  }
  if (k !== values.length) throw new Error(`Siatka ASCII niekompletna: ${k} z ${values.length} wartości`);
  return { ncols, nrows, values, nodata: header.nodata_value ?? null };
}

