import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
for (const entry of ['index.html', 'styles.css', 'sw.js', 'manifest.json', 'icon.svg', 'js', 'vendor']) {
  cpSync(entry, `dist/${entry}`, { recursive: true });
}
