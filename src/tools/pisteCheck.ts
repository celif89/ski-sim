/**
 * Porównanie naszej klasyfikacji z oficjalnymi kolorami prawdziwych tras Pilska (OpenStreetMap).
 * Uruchomienie: npm run piste-check  → zestawienie trasa po trasie w terminalu.
 */
import { readFileSync } from 'node:fs';
import pistesJson from '../../data/pistes.json';
import { parsePisteParams } from '../sim/pistes';
import type { OsmResort } from '../sim/resort';
import { compareRealPistes } from '../sim/resort';
import { loadMapFromDisk } from './loadMapFromDisk';

const { grid } = loadMapFromDisk('pilsko');
const osm = JSON.parse(readFileSync(new URL('../../data/maps/pilsko/osm-resort.json', import.meta.url), 'utf8')) as OsmResort;
const p = parsePisteParams(pistesJson);
const rows = compareRealPistes(osm, grid, p, (e, n) => grid.puwg92ToLocal(e, n));
const name = (id: string | null) => (id ? p.classes.find((c) => c.id === id)?.name ?? id : '–');
console.log('trasa | długość [m] | spadek [m] | najtrudniejsze 50 m [%] | oficjalnie | nasza | zgodność');
for (const r of rows) console.log(`${r.label.padEnd(10)} | ${Math.round(r.lengthM).toString().padStart(5)} | ${Math.round(r.dropM).toString().padStart(4)} | ${r.maxSlopePercent.toFixed(0).padStart(3)} | ${name(r.officialClass).padEnd(10)} | ${name(r.ourClass).padEnd(10)} | ${r.agree ? 'tak' : 'NIE'}`);
const agree = rows.filter((r) => r.agree).length;
console.log(`Zgodnych: ${agree} z ${rows.length}`);
