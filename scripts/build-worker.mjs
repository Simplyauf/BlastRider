import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const project = resolve('.');
const clientDir = join(project, '.client-build');
const distDir = join(project, 'dist');
const vite = join(project, 'node_modules/vite/bin/vite.js');
const built = spawnSync(process.execPath, [vite, 'build', '--outDir', clientDir, '--emptyOutDir'], { cwd: project, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status || 1);

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.zip': 'application/zip', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const assets = {};
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.isFile()) {
      const pathname = '/' + relative(clientDir, file).split(sep).join('/');
      assets[pathname] = { base64: readFileSync(file).toString('base64'), type: mime[extname(file)] || 'application/octet-stream' };
    }
  }
}
collect(clientDir);
if (!assets['/index.html']) throw new Error('Missing built game page');
rmSync(distDir, { recursive: true, force: true });
mkdirSync(join(distDir, 'server'), { recursive: true });
mkdirSync(join(distDir, '.openai'), { recursive: true });
const source = readFileSync(join(project, 'worker/index.js'), 'utf8');
writeFileSync(join(distDir, 'server/index.js'), `const ASSETS = ${JSON.stringify(assets)};\n${source}`);
writeFileSync(join(distDir, '.openai/hosting.json'), readFileSync(join(project, '.openai/hosting.json')));
console.log(`Built Worker with ${Object.keys(assets).length} game assets.`);
