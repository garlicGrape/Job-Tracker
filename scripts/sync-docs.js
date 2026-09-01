/**
 * Copy the Vite production build into docs/ so GitHub Pages can publish it.
 *
 * This repo's Pages settings are "Deploy from a branch → main → /docs"
 * (Jekyll). There is no docs/ folder in source, which is why the first
 * Pages build failed with "No such file or directory .../docs".
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const docs = 'docs';
mkdirSync(docs, { recursive: true });
rmSync(join(docs, 'assets'), { recursive: true, force: true });
cpSync(join('dist', 'index.html'), join(docs, 'index.html'));
cpSync(join('dist', 'assets'), join(docs, 'assets'), { recursive: true });
writeFileSync(join(docs, '.nojekyll'), '');
writeFileSync(
  join(docs, '_config.yml'),
  [
    '# GitHub Pages still runs Jekyll against this folder.',
    '# Serve the Vite SPA as-is — no theme layout wrapping index.html.',
    'defaults:',
    '  - scope:',
    '      path: ""',
    '    values:',
    '      layout: null',
    ''
  ].join('\n')
);

console.log('Wrote docs/ from dist/ for GitHub Pages');
