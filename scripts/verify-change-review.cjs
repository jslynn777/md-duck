#!/usr/bin/env node
'use strict';

// Runs the selected packaged executable, without modifying its app.asar.
// All article changes and settings are confined to a newly created test profile.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { tmpdir } = require('node:os');
const { extractFile } = require('@electron/asar');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const repoRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const usage = 'Usage: node scripts/verify-change-review.cjs --app-root <packaged or installed application directory> [--output <evidence directory>]';
if (args.includes('--help')) { console.log(usage); process.exit(0); }
const options = {};
for (let index = 0; index < args.length; index += 2) {
  assert(['--app-root', '--output'].includes(args[index]) && args[index + 1] && !args[index + 1].startsWith('--'), usage);
  assert(!options[args[index]], 'Duplicate option: ' + args[index]);
  options[args[index]] = args[index + 1];
}
assert(Number(process.versions.node.split('.')[0]) >= 22, 'This check requires Node.js 22 or newer');
assert(['darwin', 'win32'].includes(process.platform), 'Run this check on macOS or Windows with that platform’s actual application');
assert(options['--app-root'], usage);
const appRoot = path.resolve(options['--app-root']);
const executable = path.join(appRoot, process.platform === 'darwin' ? 'Contents/MacOS/MD Duck' : 'MD Duck.exe');
const asar = path.join(appRoot, process.platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar');
const evidenceRoot = path.resolve(options['--output'] || path.join(repoRoot, 'release', 'validation', 'change-review'));
let run, temporary, profile, library, source, zh, other;
let launchCount = 0;
const original = '<!-- block:title -->\n# Packaged article review\n\n<!-- block:intro -->\nTell the supplier what you need.\n\n<!-- block:old -->\nAn old paragraph to remove.\n';
const revised = '<!-- block:title -->\n# Packaged article review\n\n<!-- block:intro -->\nSpecify the product, dimensions and quantity.\n\n<!-- block:new -->\nState your delivery city and arrival date.\n';
const originalZh = '<!-- block:title -->\n# 打包版本审阅\n\n<!-- block:intro -->\n告诉供应商你的需求。\n\n<!-- block:old -->\n需要删除的旧段落。\n';
const revisedZh = '<!-- block:title -->\n# 打包版本审阅\n\n<!-- block:intro -->\n写清产品、尺寸与数量。\n\n<!-- block:new -->\n注明收货城市和到货日期。\n';
const report = { platform: process.platform, appRoot, executable, asar, isolatedProfile: true, startedAt: new Date().toISOString(), checks: [], screenshots: [], launchLogs: [] };
const digest = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

async function connect() {
  const launchLog = path.join(run, `launch-${++launchCount}.log`);
  report.launchLogs.push(launchLog);
  const environment = { ...process.env, MD_DUCK_PROFILE_DIR: profile,
    MD_DUCK_STARTUP_CHECK_REPORT: path.join(profile, 'startup-check.json') };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ELECTRON_RENDERER_URL;
  delete environment.NODE_OPTIONS;
  const child = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-background-networking'],
    { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', exited = null, spawnError;
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.once('error', error => { spawnError = error; });
  const ended = new Promise(resolve => child.once('exit', (code, signal) => { exited = { code, signal }; resolve(); }));
  let socket;
  const pending = new Map();
  async function stop() {
    socket?.close();
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(Error('Packaged application stopped')); }
    pending.clear();
    if (!exited && child.pid) {
      child.kill('SIGTERM');
      await Promise.race([ended, wait(5000)]);
      if (!exited) {
        child.kill('SIGKILL');
        await Promise.race([ended, wait(5000)]);
        assert(exited, 'The isolated packaged test process did not exit');
      }
    }
    await fs.writeFile(launchLog, output);
  }
  try {
    let target;
    for (let attempt = 0; attempt < 400; attempt++) {
      if (spawnError) throw spawnError;
      if (exited) throw Error('Packaged process exited: ' + JSON.stringify(exited) + '\n' + output);
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        const targets = await fetch(`http://127.0.0.1:${match[1]}/json/list`, { signal: AbortSignal.timeout(2000) }).then(r => r.json()).catch(() => []);
        target = targets.find(t => t.type === 'page' && t.url.startsWith('file:') && t.url.includes('app.asar'));
        if (target) break;
      }
      await wait(100);
    }
    assert(target, 'Timed out locating the renderer served from the packaged archive.\n' + output);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Timed out connecting to packaged renderer')), 15000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', error => { clearTimeout(timer); reject(error); }, { once: true });
    });
    let sequence = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
      if (message.error) reject(Error(JSON.stringify(message.error))); else resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 20000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable'); await send('Page.enable');
    await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const poll = async (expression, description) => {
      for (let attempt = 0; attempt < 150; attempt++) { if (await evaluate(expression)) return; await wait(100); }
      throw Error('Timed out: ' + description + '\n' + await evaluate('document.body.innerText.slice(0,3500)'));
    };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const capture = async name => {
      const file = path.join(run, name + '.png');
      const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await fs.writeFile(file, Buffer.from(data, 'base64')); report.screenshots.push(file);
    };
    await poll("!!document.querySelector('.reader')", 'packaged reader ready');
    report.rendererUrl = await evaluate('location.href');
    return { evaluate, poll, click, capture, stop };
  } catch (error) { await stop(); throw error; }
}

async function main() {
  await fs.mkdir(evidenceRoot, { recursive: true });
  run = await fs.mkdtemp(path.join(evidenceRoot, 'run-'));
  report.run = run;
  // All fixture paths are new and intentionally contain spaces and non-ASCII characters.
  // Neither appRoot nor the normal user profile is ever used as a fixture directory.
  temporary = await fs.mkdtemp(path.join(tmpdir(), 'md-duck-review-'));
  profile = path.join(temporary, '测试 profile');
  library = path.join(temporary, '文章 library');
  source = path.join(library, '01-guide', 'article.md');
  zh = path.join(library, '01-guide', 'article.zh.md');
  other = path.join(library, '02-other', 'article.md');
  let client;
  try {
    await fs.access(executable); await fs.access(asar);
    report.version = JSON.parse(extractFile(asar, 'package.json').toString()).version;
    report.expectedVersion = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')).version;
    assert.equal(report.version, report.expectedVersion, 'Packaged version must match this checkout');
    report.asarSha256 = await digest(asar);
    for (const directory of [profile, path.dirname(source), path.dirname(other), path.join(library, '03-stable')]) await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(source, original); await fs.writeFile(zh, originalZh);
    await fs.writeFile(other, '# Another packaged article\n\nThe original second article.\n');
    await fs.writeFile(path.join(library, '03-stable', 'article.md'), '# Unchanged article\n\nLeave this unchanged.\n');
    await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ root: library, openPath: source, scroll: {}, openRouterKey: null,
      prefs: { ui: 'zh', fontSize: 18, mode: 'bilingual', sidebar: true, sidebarTab: 'files', librarySort: 'name-asc' } }));
    client = await connect();
    await wait(400);
    assert.equal(await client.evaluate("document.querySelectorAll('.library-article-changed').length"), 0);
    report.checks.push('Actual packaged executable loads its own app.asar and establishes silent baseline in isolated profile');
    await fs.writeFile(source, revised); await fs.writeFile(zh, revisedZh);
    await fs.writeFile(other, '# Another packaged article\n\nThe updated second article.\n');
    await client.poll("document.querySelectorAll('.library-article-changed').length === 2", 'two pending articles');
    await client.poll("document.querySelector('.change-acknowledge') && !document.querySelector('.change-acknowledge').disabled", 'current rendered revision');
    await client.click('.library-change-filter');
    await client.poll("document.querySelectorAll('.library-article-open').length === 2", 'changed-only filter excludes unchanged article');
    report.checks.push('Source/translation changes appear in sidebar and changed-only filter excludes unchanged article');
    await client.click('.change-view');
    await client.poll("document.querySelector('.change-comparison-nav')?.textContent.includes('/ 6')", 'six source/translation changes');
    await client.capture('01-packaged-changes');
    await client.evaluate("[...document.querySelectorAll('.library-article-open')].find(b=>b.querySelector('.library-article-title')?.textContent==='Another packaged article').click()");
    await client.poll("document.querySelector('.topbar')?.textContent.includes('Another packaged article') && document.querySelector('.change-acknowledge') && !document.querySelector('.change-acknowledge').disabled", 'open second article');
    assert.equal(await client.evaluate("document.querySelectorAll('.library-article-changed').length"), 2);
    await client.click('.change-view');
    await client.poll("document.querySelector('.change-before')?.textContent.includes('original second article')", 'original comparison text');
    await client.click('.change-acknowledge');
    await client.poll("document.querySelectorAll('.library-article-changed').length === 1", 'only second article acknowledged');
    report.checks.push('Opening retains marker; explicit confirmation clears only the chosen article');
    await client.evaluate("[...document.querySelectorAll('.library-article-open')].find(b=>b.querySelector('.library-article-title')?.textContent==='Packaged article review').click()");
    await client.poll("document.querySelector('.topbar')?.textContent.includes('Packaged article review') && document.querySelector('.change-acknowledge') && !document.querySelector('.change-acknowledge').disabled", 'first article restored');
    await wait(700); await client.stop(); client = null;
    const offline = revised + '\n<!-- block:offline -->\nThis paragraph was saved while the application was closed.\n';
    await fs.writeFile(source, offline);
    client = await connect();
    await client.poll("document.querySelectorAll('.library-article-changed').length === 1", 'pending marker survives restart');
    await client.poll("document.querySelector('.reader')?.textContent.includes('saved while the application was closed')", 'offline edit loaded');
    const sourceJson = JSON.stringify(source);
    const state = await client.evaluate(`window.api.getState().then(s=>{const e=s.library.find(e=>e.path===${sourceJson});return window.api.getDocumentChanges(e.path,e.id)})`);
    assert.equal(state.baseline.sourceText, original); assert.equal(state.current.sourceText, offline);
    await client.click('.change-view'); await client.capture('02-packaged-restart');
    report.checks.push('Relaunch retains pending status and original comparison baseline, including offline changes');
    await client.poll("!document.querySelector('.change-acknowledge').disabled", 'latest revision confirmable');
    await client.click('.change-acknowledge');
    await client.poll("!document.querySelector('[data-change-review]') && document.querySelectorAll('.library-article-changed').length === 0", 'latest confirmed');
    assert.equal(await fs.readFile(source, 'utf8'), offline);
    assert.equal(await fs.readFile(zh, 'utf8'), revisedZh);
    const settings = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
    assert.equal(settings.root, library); assert.equal(settings.prefs.ui, 'zh'); assert.equal(settings.prefs.fontSize, 18);
    assert.equal(await digest(asar), report.asarSha256);
    report.checks.push('Latest confirmation leaves article files intact and preserves test settings; archive bytes unchanged');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack || error);
    if (client) await client.capture('failure').catch(() => undefined);
  } finally {
    if (client) await client.stop().catch(error => { report.status = 'failed'; report.cleanupError = String(error); });
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      .catch(error => { report.status = 'failed'; report.cleanupError = String(error); });
    report.finishedAt = new Date().toISOString();
    report.durationSeconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;
    await fs.writeFile(path.join(run, 'result.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(evidenceRoot, 'latest.json'), JSON.stringify({ run, result: path.join(run, 'result.json') }, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'passed') process.exitCode = 1;
  }
}
main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
