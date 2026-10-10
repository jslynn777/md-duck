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
    // Release binaries may be served from a separately verified downloads directory.
    // Their metadata is checked below; publication verifies actual HTTP bytes separately.
    if (anchors.some(anchor => anchor.href === value && (Object.hasOwn(anchor, 'data-release-download') || Object.hasOwn(anchor, 'data-release-source')))) continue;
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
const downloadManifests = [];
for (const [file, preparation, checksum] of [
  ['download/index.html', '公开安装包准备中', '校验值 SHA-256'],
  ['en/download/index.html', 'Public installers are being prepared', 'SHA-256 checksum'],
]) {
  const html = await readFile(resolve(root, file), 'utf8');
  assert.ok(html.includes(preparation) || html.includes(checksum), `${file}: clear release state`);
  const metadata = attributes(html.match(/<section\b[^>]*data-release-version[^>]*>/)?.[0] ?? '');
  assert.match(metadata['data-release-version'] ?? '', /^\d+\.\d+\.\d+-beta\.\d+$/, `${file}: explicit beta version`);
  assert.ok(['preparing', 'published'].includes(metadata['data-release-status']), `${file}: explicit release state`);
  const artifacts = [...html.matchAll(/<li\b([^>]*)data-release-kind([^>]*)>([\s\S]*?)<\/li>/g)].map(([tag, , , content]) => {
    const item = attributes(tag.slice(0, tag.indexOf('>') + 1));
    const link = attributes(content.match(/<a\b[^>]*data-release-download[^>]*>/)?.[0] ?? '');
    const kind = item['data-release-kind'];
    assert.ok(['mac-dmg', 'windows-setup'].includes(kind), `${file}: recognized platform`);
    assert.match(item['data-release-sha256'] ?? '', /^[a-f0-9]{64}$/, `${file}: complete SHA-256`);
    assert.match(item['data-release-size'] ?? '', /^\d+(?:\.\d+)?\s+(?:MB|MiB|GB|GiB)$/, `${file}: file size`);
    const url = new URL(link.href);
    assert.equal(url.protocol, 'https:', `${file}: secure download URL`);
    assert.ok(['mdduck.com', 'github.com'].includes(url.hostname), `${file}: project release host`);
    assert.ok(!url.username && !url.password && !url.search && !url.hash, `${file}: stable public download URL`);
    if (url.hostname === 'github.com') assert.ok(url.pathname.startsWith('/jslynn777/md-duck/releases/download/'), `${file}: project GitHub release`);
    const name = decodeURIComponent(url.pathname.split('/').at(-1));
    assert.ok(name.includes(metadata['data-release-version']), `${file}: file matches displayed version`);
    assert.match(name, kind === 'mac-dmg' ? /macOS-arm64[^/]*\.dmg$/ : /Windows-x64-Setup[^/]*\.exe$/, `${file}: installer matches platform`);
    assert.doesNotMatch(name, /(?:local-test|Portable)/i, `${file}: public installer name`);
    return { kind, url: url.href, size: item['data-release-size'], sha256: item['data-release-sha256'] };
  });
  const sourceLinks = [...html.matchAll(/<a\b[^>]*data-release-source="true"[^>]*>/g)].map(match => attributes(match[0]));
  const sourceUrl = metadata['data-release-source-url'] ?? '';
  if (metadata['data-release-status'] === 'published') {
    assert.deepEqual(artifacts.map(artifact => artifact.kind).sort(), ['mac-dmg', 'windows-setup'], `${file}: one public installer for each platform`);
    assert.ok(!html.includes(preparation), `${file}: published files replace the preparation message`);
    assert.equal(sourceLinks.length, 1, `${file}: one corresponding source download`);
    assert.equal(sourceLinks[0].href, sourceUrl, `${file}: source download matches release metadata`);
    const url = new URL(sourceUrl);
    assert.equal(url.protocol, 'https:', `${file}: secure source download URL`);
    assert.ok(['mdduck.com', 'github.com'].includes(url.hostname), `${file}: project source release host`);
    assert.ok(!url.username && !url.password && !url.search && !url.hash, `${file}: stable public source URL`);
    if (url.hostname === 'github.com') assert.ok(url.pathname.startsWith('/jslynn777/md-duck/releases/download/'), `${file}: project GitHub source release`);
    assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)), `MD-Duck-${metadata['data-release-version']}-Corresponding-Source.tar.gz`, `${file}: corresponding source matches release version`);
  } else {
    assert.equal(artifacts.length, 0, `${file}: preparing state has no download buttons`);
    assert.equal(sourceLinks.length, 0, `${file}: preparing state has no source archive link`);
    assert.equal(sourceUrl, '', `${file}: preparing source URL remains empty`);
  }
  downloadManifests.push({ version: metadata['data-release-version'], status: metadata['data-release-status'], sourceUrl, artifacts });
}
assert.deepEqual(downloadManifests[0], downloadManifests[1], 'Both languages expose the same release files, sizes, hashes and corresponding source');
const guideIds = ['install', 'install-windows', 'open', 'bilingual', 'pairing-check', 'notes', 'words', 'speech', 'ai-setup', 'privacy', 'faq'];
for (const file of ['guide/index.html', 'en/guide/index.html']) {
  const html = await readFile(resolve(root, file), 'utf8');
  for (const id of guideIds) assert.ok(html.includes(`id="${id}"`), `${file}: shared guide anchor ${id}`);
}
const sitemap = await readFile(resolve(root, 'sitemap.xml'), 'utf8');
assert.equal((sitemap.match(/<url>/g) || []).length, 6, 'Sitemap has both languages for all indexable pages');
for (const route of routes.filter(route => !route.noindex)) assert.ok(sitemap.includes(`${origin}${route.path}</loc>`), `${route.path}: sitemap entry`);
for (const language of ['zh-CN', 'en', 'x-default']) assert.equal((sitemap.match(new RegExp(`hreflang="${language}"`, 'g')) || []).length, 6, `Sitemap ${language} alternate on every page`);
assert.ok((await stat(resolve(root, 'examples/a-slower-morning.zip'))).size > 0, 'Sample is downloadable');
console.log(`Verified ${pages.length} bilingual HTML pages, ${checked} local references, matching release metadata, guide anchors, language switches, canonical and hreflang links, sitemap and sample archive.`);
