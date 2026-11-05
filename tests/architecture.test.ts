import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SIM_DIR = join(ROOT, 'src', 'sim');

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/** Usuwa komentarze, żeby słowa w opisach (np. „bez PixiJS”) nie dawały fałszywych alarmów. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Architektura: symulacja oddzielona od grafiki', () => {
  const simFiles = listFiles(SIM_DIR).filter((f) => f.endsWith('.ts'));

  it('katalog src/sim zawiera pliki', () => {
    expect(simFiles.length).toBeGreaterThan(0);
  });

  it.each(simFiles.map((f) => [relative(ROOT, f), f]))('%s nie importuje PixiJS ani kodu spoza src/sim', (_name, file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    const imports = [...code.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g)].map(
      (m) => m[1] ?? m[2],
    );
    for (const spec of imports) {
      // Dozwolone tylko importy względne wewnątrz src/sim (./coś), bez bibliotek zewnętrznych.
      expect(spec, `niedozwolony import „${spec}”`).toMatch(/^\.\/[^.]/);
    }
  });

  it.each(simFiles.map((f) => [relative(ROOT, f), f]))('%s nie używa obiektów przeglądarki', (_name, file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const word of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'requestAnimationFrame', 'Math.random']) {
      // Całe słowa (np. „windowRadiation” – okno czasu – nie jest obiektem przeglądarki).
      const re = new RegExp(`(^|[^A-Za-z0-9_])${word.replace('.', '\\.')}([^A-Za-z0-9_]|$)`);
      expect(re.test(code), `użycie „${word}”`).toBe(false);
    }
  });
});
