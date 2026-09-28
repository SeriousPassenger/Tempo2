import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access, readdir} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const file = path => readFile(new URL(path, root), 'utf8');

test('HTML contains exact requested donation addresses and relative assets', async () => {
  const html = await file('site/index.html');
  assert.ok(html.includes('bc1qjjvvddxsmefkqc9d6kvfr60k90kspt5uusr9ne'));
  assert.ok(html.includes('0x455A377aC826c474fd0d9849EE01FBa9FA37a7B8'));
  assert.doesNotMatch(html, /(?:src|href)=["']\//);
  assert.doesNotMatch(html, /__TOKEN__|\/api\//);
  assert.match(html, /script-src 'self'/);
  for (const [, path] of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) {
    if (path !== './') await access(new URL('site/' + path.slice(2), root));
  }
});
test('tracking runtime has no API calls or third-party network dependencies', async () => {
  for (const name of ['app.mjs','engine.mjs','storage.mjs']) {
    const source = await file('site/' + name);
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//);
    assert.doesNotMatch(source, /\/api\//);
  }
});
test('IDs are unique and all literal UI selectors have matching HTML elements', async () => {
  const html = await file('site/index.html'), js = await file('site/app.mjs');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of js.matchAll(/\$\(['"]#([\w-]+)['"]\)/g)) assert.ok(ids.includes(id), `Missing #${id}`);
});
test('service worker caches only present app files and handles project paths', async () => {
  const sw = await file('site/sw.js');
  const list = sw.match(/const ASSETS = (\[[^;]+\]);/)[1];
  const paths = JSON.parse(list.replaceAll("'", '"'));
  for (const path of paths) {
    if (path !== './') await access(new URL('site/' + path.slice(2), root));
    assert.equal(new URL(path, 'https://example.github.io/tempo/').pathname.startsWith('/tempo/'), true);
  }
  assert.doesNotMatch(sw, /skipWaiting\(/);
  assert.match(sw, /self\.registration\.scope/);
});
test('Pages workflow deploys site only with bounded permissions', async () => {
  const workflow = await file('.github/workflows/pages.yml');
  assert.match(workflow, /path: site/); assert.match(workflow, /node --test tests\/\*\.test\.mjs/);
  assert.match(workflow, /pages: write/); assert.match(workflow, /id-token: write/);
  assert.match(workflow, /github\.event_name != 'pull_request'/);
  assert.doesNotMatch(workflow, /secrets\.[A-Z_]+/);
  const names = await readdir(new URL('site/', root));
  assert.ok(names.every(n => !n.endsWith('.py') && !n.endsWith('.sqlite3')));
});
