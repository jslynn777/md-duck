import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, extname, relative, sep } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../dist');
const origin = 'https://mdduck.com';
const files = [];
const routes = [
  { file: 'index.html', path: '/', lang: 'zh-CN', alternate: '/en/' },
  { file: 'guide/index.html', path: '/guide/', lang: 'zh-CN', alternate: '/en/guide/' },
  { file: 'download/index.html', path: '/download/', lang: 'zh-CN', alternate: '/en/download/' },
  { file: 'en/index.html', path: '/en/', lang: 'en', alternate: '/' },
  { file: 'en/guide/index.html', path: '/en/guide/', lang: 'en', alternate: '/guide/' },
  { file: 'en/download/index.html', path: '/en/download/', lang: 'en', alternate: '/download/' },
  { file: '404.html', path: '/404.html', lang: 'zh-CN', alternate: '/en/404/', noindex: true },
  { file: 'en/404/index.html', path: '/en/404/', lang: 'en', alternate: '/404.html', noindex: true },
];
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"<>]*)"/g)].map(([, name, value]) => [name, value.replaceAll('&amp;', '&')]));
}
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(root);
const pages = files.filter(path => path.endsWith('.html'));
assert.equal(pages.length, routes.length, 'Expected all bilingual pages and both error documents');
let checked = 0;
for (const route of routes) {
  const page = resolve(root, route.file);
  const html = await readFile(page, 'utf8');
  const htmlTag = attributes(html.match(/<html\b[^>]*>/)?.[0] ?? '');
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => attributes(match[0]));
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map(match => attributes(match[0]));
  assert.equal(htmlTag.lang, route.lang, `${route.path}: document language`);
  assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, `${route.path}: exactly one main heading`);
  assert.match(html, /<meta name="description" content="[^"]+"/, `${route.path}: description`);
  assert.equal(links.find(link => link.rel === 'canonical')?.href, origin + route.path, `${route.path}: canonical`);
  assert.doesNotMatch(html, /<script\b/, `${route.path}: presentation pages should require no scripts`);
  assert.doesNotMatch(html, /(?:href|src)="(?:#|javascript:[^"]*|https?:\/\/example\.com[^"]*)"/, `${route.path}: placeholder link`);
  assert.ok(anchors.some(anchor => anchor.href === route.alternate), `${route.path}: corresponding language switch`);
  if (route.noindex) {
    assert.match(html, /<meta name="robots" content="noindex"/, `${route.path}: error document excluded from indexing`);
  } else {
    const zhPath = route.lang === 'zh-CN' ? route.path : route.alternate;
    const enPath = route.lang === 'en' ? route.path : route.alternate;
    for (const [language, path] of [['zh-CN', zhPath], ['en', enPath], ['x-default', zhPath]]) {
      assert.equal(links.find(link => link.rel === 'alternate' && link.hreflang === language)?.href, origin + path, `${route.path}: ${language} alternate`);
    }
  }
  for (const match of html.matchAll(/\b(?:href|src)="([^"<>]+)"/g)) {
    const value = match[1].replaceAll('&amp;', '&');
    if (/^(mailto:|data:)/.test(value)) continue;
    const url = new URL(value, origin + route.path);
    if (url.origin !== origin) continue;
    let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    const relativePath = relative(root, path);
    assert.ok(relativePath !== '..' && !relativePath.startsWith('..' + sep), 'References remain in public output');
    const info = await stat(path).catch(() => null);
    assert.ok(info, `${route.path}: missing resource ${value}`);
    if (info.isDirectory()) path = resolve(path, 'index.html');
    assert.ok((await stat(path)).isFile(), `${route.path}: missing page ${value}`);
    if (url.hash && extname(path) === '.html') {
      const target = await readFile(path, 'utf8');
      assert.ok(target.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `${route.path}: missing fragment ${value}`);
    }
    checked++;
  }
}
for (const [file, preparation, checksum] of [
  ['download/index.html', '公开安装包准备中', '校验值 SHA-256'],
  ['en/download/index.html', 'Public installers are being prepared', 'SHA-256 checksum'],
]) {
  const html = await readFile(resolve(root, file), 'utf8');
  assert.ok(html.includes(preparation) || html.includes(checksum), `${file}: clear release state`);
}
const guideIds = ['install', 'open', 'bilingual', 'notes', 'words', 'speech', 'ai-setup', 'privacy', 'faq'];
for (const file of ['guide/index.html', 'en/guide/index.html']) {
  const html = await readFile(resolve(root, file), 'utf8');
  for (const id of guideIds) assert.ok(html.includes(`id="${id}"`), `${file}: shared guide anchor ${id}`);
}
const sitemap = await readFile(resolve(root, 'sitemap.xml'), 'utf8');
assert.equal((sitemap.match(/<url>/g) || []).length, 6, 'Sitemap has both languages for all indexable pages');
for (const route of routes.filter(route => !route.noindex)) assert.ok(sitemap.includes(`${origin}${route.path}</loc>`), `${route.path}: sitemap entry`);
for (const language of ['zh-CN', 'en', 'x-default']) assert.equal((sitemap.match(new RegExp(`hreflang="${language}"`, 'g')) || []).length, 6, `Sitemap ${language} alternate on every page`);
assert.ok((await stat(resolve(root, 'examples/a-slower-morning.zip'))).size > 0, 'Sample is downloadable');
console.log(`Verified ${pages.length} bilingual HTML pages, ${checked} local references, language switches, canonical and hreflang links, sitemap and sample archive.`);
