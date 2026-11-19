#!/usr/bin/env node
'use strict';

// Electron integration check. Every settings, review and article write is confined
// to a fresh temporary profile; this never opens the normal user profile.
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { extractFile } = require('@electron/asar');

const repoRoot = path.resolve(__dirname, '..');
const usage = 'Usage: node scripts/verify-spaces-runtime.cjs [--app-root <Mac .app or Windows application directory>] [--output <evidence directory>]';
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log(usage); process.exit(0); }
const options = {};
for (let index = 0; index < args.length; index += 2) {
  assert(['--app-root', '--output'].includes(args[index]) && args[index + 1] && !args[index + 1].startsWith('--'), usage);
  assert(!options[args[index]], `Duplicate option: ${args[index]}`);
  options[args[index]] = args[index + 1];
}
assert(Number(process.versions.node.split('.')[0]) >= 22, 'This check requires Node.js 22 or newer');
assert(['darwin', 'win32'].includes(process.platform), 'Run on macOS or Windows with that platform’s Electron application');
const appRoot = options['--app-root'] ? path.resolve(options['--app-root']) : null;
const executable = appRoot ? path.join(appRoot, process.platform === 'darwin' ? 'Contents/MacOS/MD Duck' : 'MD Duck.exe') : require('electron');
const appArgs = appRoot ? [] : [repoRoot];
const appFile = appRoot ? path.join(appRoot, process.platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar') : path.join(repoRoot, 'out/main/index.js');
const evidenceRoot = path.resolve(options['--output'] || path.join(repoRoot, 'release/validation/spaces'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const quoted = value => JSON.stringify(value);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = async file => hash(await fs.readFile(file));
let run, temporary, profile, launchCount = 0;
const report = { platform: process.platform, mode: appRoot ? 'packaged' : 'local-build', appRoot, executable, appFile,
  isolatedProfile: true, rendererNetworkBlocked: true, startedAt: new Date().toISOString(), checks: [], screenshots: [], launchLogs: [] };

async function buildDigest() {
  if (appRoot) return digest(appFile);
  const out = path.join(repoRoot, 'out');
  const entries = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) entries.push(`${path.relative(out, file)}:${await digest(file)}`);
    }
  }
  await visit(out);
  return hash(entries.sort().join('\n'));
}

function environment() {
  const env = { ...process.env, MD_DUCK_PROFILE_DIR: profile, MD_DUCK_STARTUP_CHECK_REPORT: path.join(profile, 'startup-check.json') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  delete env.NODE_OPTIONS;
  return env;
}

async function eventually(check, description, milliseconds = 20000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < milliseconds) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await wait(100);
  }
  throw Error(`Timed out: ${description}${lastError ? `\n${lastError.stack || lastError}` : ''}`);
}

async function launch() {
  const launchLog = path.join(run, `launch-${++launchCount}.log`);
  report.launchLogs.push(launchLog);
  const child = spawn(executable, [...appArgs, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'],
  { env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', exited = null, spawnError, port;
  child.stdout.on('data', value => { output += value; });
  child.stderr.on('data', value => { output += value; });
  child.once('error', error => { spawnError = error; });
  const ended = new Promise(resolve => child.once('exit', (code, signal) => { exited = { code, signal }; resolve(); }));
  const clients = new Map();

  async function targets() {
    if (!port) return [];
    const found = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) }).then(response => response.json()).catch(() => []);
    return found.filter(target => target.type === 'page' && target.url.startsWith('file:') &&
      (appRoot ? target.url.includes('app.asar') : target.url.includes('/out/renderer/')));
  }

  async function client(target) {
    if (clients.has(target.id)) return clients.get(target.id);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    const imageResponses = new Map();
    let sequence = 0;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Timed out connecting to isolated renderer')), 15000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', error => { clearTimeout(timeout); reject(error); }, { once: true });
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.responseReceived') imageResponses.set(message.params.response.url, message.params.response.status);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timeout);
      if (message.error) entry.reject(Error(JSON.stringify(message.error))); else entry.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const entry of pending.values()) { clearTimeout(entry.timeout); entry.reject(Error('Isolated renderer closed')); }
      pending.clear();
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) return reject(Error('Isolated renderer is not connected'));
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const poll = async (expression, description) => {
      try { await eventually(() => evaluate(expression), description); } catch (error) {
        const body = await evaluate('document.body.innerText.slice(0,4500)').catch(() => '(renderer unavailable)');
        throw Error(`${error.message}\n${body}`);
      }
    };
    const capture = async name => {
      const file = path.join(run, `${name}.png`);
      const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await fs.writeFile(file, Buffer.from(data, 'base64')); report.screenshots.push(file);
    };
    const click = selector => evaluate(`(() => {const element=document.querySelector(${quoted(selector)});if(!element)throw Error('Missing control: '+${quoted(selector)});element.click()})()`);
    const state = () => evaluate('window.api.getState()');
    const imageStatus = async original => {
      const url = new URL(original); url.searchParams.set('v', String(Date.now()));
      imageResponses.delete(url.href);
      // Images are allowed by img-src; fetch deliberately is not allowed by
      // connect-src. Observe the real image request without weakening that CSP.
      const decoded = await evaluate(`new Promise(resolve=>{const img=new Image();img.onload=()=>resolve({loaded:true,width:img.naturalWidth});img.onerror=()=>resolve({loaded:false,width:0});img.src=${quoted(url.href)}})`);
      await eventually(() => imageResponses.has(url.href), 'local image protocol response');
      return { status: imageResponses.get(url.href), ...decoded };
    };
    const reload = async () => {
      // Page.reload acknowledges before the previous renderer document is gone.
      // A toolbar left in that document is not evidence that the new UI is ready.
      const token = crypto.randomUUID();
      await evaluate(`window.__runtimeReloadToken=${quoted(token)}`);
      await send('Page.reload');
      await poll(`window.__runtimeReloadToken!==${quoted(token)}&&!!window.api&&!!document.querySelector('.space-switch-trigger, .welcome-spaces')`, 'new renderer document after reload');
      await state();
    };
    const close = async () => {
      await send('Page.close').catch(error => { if (!/closed|not connected/.test(error.message)) throw error; });
      await eventually(async () => !(await targets()).some(item => item.id === target.id), 'reader window closes');
      socket.close(); clients.delete(target.id);
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    const motion = reduced => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    const escape = async () => {
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    };
    const result = { targetId: target.id, evaluate, poll, click, capture, state, imageStatus, reload, close, motion, escape, disconnect: () => socket.close() };
    clients.set(target.id, result);
    await poll('!!window.api', 'isolated preload API');
    await state();
    return result;
  }

  async function stop() {
    for (const value of clients.values()) value.disconnect();
    clients.clear();
    if (!exited && child.pid) {
      child.kill('SIGTERM');
      await Promise.race([ended, wait(5000)]);
      if (!exited) { child.kill('SIGKILL'); await Promise.race([ended, wait(5000)]); }
      assert(exited, 'The isolated Electron process did not exit');
    }
    await fs.writeFile(launchLog, output);
  }

  try {
    await eventually(async () => {
      if (spawnError) throw spawnError;
      if (exited) throw Error(`Isolated application exited: ${JSON.stringify(exited)}\n${output}`);
      port = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
      return !!port && (await targets()).length > 0;
    }, 'isolated Electron renderer', 40000);
    const first = await client((await targets())[0]);
    await first.poll("!!document.querySelector('.space-switch-trigger, .welcome-spaces')", 'initial reader or recoverable space overview');
    report.rendererUrl = await first.evaluate('location.href');
    return { first, targets, client, stop };
  } catch (error) { await stop(); throw error; }
}

async function secondInstance(spaceId, relativePath) {
  const logFile = path.join(run, 'second-instance.log');
  const args = [...appArgs, '--mdduck-space', spaceId, '--mdduck-file', relativePath, '--disable-background-networking'];
  const child = spawn(executable, args, { env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', completed = false, result;
  child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { completed = true; result = { code, signal }; resolve(); });
  });
  try {
    await Promise.race([done, wait(15000)]);
    if (!completed && process.platform === 'darwin' && child.pid) {
      // Inspect only our own isolated secondary process, never the user's app.
      const sample = path.join(run, 'second-instance-sample.txt');
      await new Promise(resolve => execFile('/usr/bin/sample', [String(child.pid), '1', '-file', sample], { timeout: 5000 }, () => resolve()));
      report.secondInstanceDiagnostic = sample;
    }
    assert(completed, 'The targeting second instance must hand off and exit');
    assert.equal(result.code, 0, `Second instance failed: ${output}`);
  } finally {
    if (!completed) { child.kill('SIGKILL'); await Promise.race([done, wait(5000)]); }
    await fs.writeFile(logFile, output); report.launchLogs.push(logFile);
  }
}

function article(title, prefix, chinese = false) {
  return `<!-- block:title -->\n# ${title}\n\n` + Array.from({ length: 38 }, (_, index) =>
    `<!-- block:p-${index} -->\n${chinese ? `${prefix}第 ${index} 段。这是用于验证阅读位置和空间独立性的本地测试文章。切换空间后，批注、译文和正在阅读的位置都应保留。` : `${prefix} paragraph ${index}. This local article verifies reading position and independent spaces. Reading, translations and notes must remain attached to the correct file after switching spaces.`}\n\n`).join('');
}

async function seedReview(source, note) {
  const destination = path.join(path.dirname(source), '.review', 'documents', `${hash(path.basename(source))}.json`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify({ version: 2, document: path.basename(source), notes: [note], words: [] }, null, 2));
  return destination;
}

async function scrollTo(client, key, source) {
  await client.poll(`!!document.querySelector('[data-key="${key}"][data-lang="source"]')`, `article anchor ${key}`);
  // Let the reader's initial requestAnimationFrame restoration finish before simulating a later user scroll.
  await client.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await client.evaluate(`(() => {const root=document.querySelector('.scroll'), element=root.querySelector('[data-key="${key}"][data-lang="source"]');root.scrollTop += element.getBoundingClientRect().top-root.getBoundingClientRect().top-12;root.dispatchEvent(new Event('scroll'))})()`);
  await client.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await client.poll(`window.api.getState().then(s=>s.scroll[${quoted(source)}]===${quoted(key)})`, `save reading anchor ${key}`);
}

async function switchViaUI(client, spaceName, spaceId) {
  if (await client.evaluate("!!document.querySelector('.spaces-overview[open]')")) {
    await client.evaluate(`(() => {const target=[...document.querySelectorAll('.space-card-open')].find(b=>b.querySelector('.space-name')?.textContent===${quoted(spaceName)});if(!target||target.disabled)throw Error('Space card unavailable');target.click()})()`);
  } else {
    if (!await client.evaluate("!!document.querySelector('.space-switch-menu')")) await client.click('.space-switch-trigger');
    await client.poll("!!document.querySelector('.space-switch-menu')", 'direct space menu opens');
    await client.evaluate(`(() => {const target=[...document.querySelectorAll('.space-switch-item')].find(b=>b.querySelector('.space-switch-item-name')?.textContent===${quoted(spaceName)});if(!target||target.disabled)throw Error('Space menu item unavailable');target.click()})()`);
  }
  await client.poll(`window.api.getState().then(s=>s.activeSpaceId===${quoted(spaceId)})`, `switch to ${spaceName}`);
  await client.poll("!document.querySelector('.spaces-overview[open], .space-switch-menu, .space-opening')", 'space menu and transition finish after switching');
}

async function visibleAnchor(client) {
  return client.evaluate(`(() => {const root=document.querySelector('.scroll');if(!root)return null;const top=root.getBoundingClientRect().top;return [...root.querySelectorAll('[data-key][data-lang="source"]')].find(e=>e.getBoundingClientRect().bottom>top+4)?.dataset.key})()`);
}

async function traceSpaceMotion(client) {
  await client.evaluate(`(() => {
    window.__spaceMotionEvents=[];
    window.__spaceReaderAnimations=[];
    if(window.__spaceMotionListening)return;
    window.__spaceMotionListening=true;
    const seen=new WeakSet();
    const readerAnimations=()=>{
      for(const animation of document.querySelector('.scroll')?.getAnimations()??[]){
        if(seen.has(animation))continue;
        seen.add(animation);
        const record={duration:animation.effect.getComputedTiming().duration,finished:false,canceled:false,observedAt:performance.now(),lastCurrentTime:animation.currentTime,visibility:document.visibilityState};
        window.__spaceReaderAnimations.push(record);
        const sample=()=>{if(animation.currentTime!==null)record.lastCurrentTime=animation.currentTime;if(!record.finished&&!record.canceled)requestAnimationFrame(sample)};
        requestAnimationFrame(sample);
        animation.finished.then(()=>{record.finished=true;record.completedAt=performance.now()},()=>{record.canceled=true;record.completedAt=performance.now()});
      }
    };
    // A fresh WAAPI animation can replace another without changing any DOM
    // attribute. Observe animation frames as well as mutation-driven renders.
    new MutationObserver(readerAnimations).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-phase']});
    const watch=()=>{readerAnimations();requestAnimationFrame(watch)};requestAnimationFrame(watch);
    for(const type of ['animationstart','animationend'])document.addEventListener(type,event=>{
      const element=event.target;
      if(!(element instanceof HTMLElement))return;
      const surface=element.closest('.spaces-overview')?'overview':element.closest('.space-switch-menu')?'menu':element.closest('.space-opening')||element.matches('.scroll')?'reader':null;
      if(!surface)return;
      window.__spaceMotionEvents.push({type,surface,name:event.animationName,elapsed:event.elapsedTime,dialogOpen:!!element.closest('.spaces-overview[open]'),duration:getComputedStyle(element).animationDuration});
    },true);
  })()`);
}

async function openSpaceOverview(client) {
  await client.click('.space-switch-trigger');
  await client.poll("!!document.querySelector('.space-switch-menu')", 'space menu before opening management');
  await client.click('.space-switch-actions button:last-child');
  await client.poll("!!document.querySelector('.spaces-overview[open]')", 'space overview opens');
}

async function verifySpaceMotion(client, space, source, anchor) {
  await client.motion(false);
  await traceSpaceMotion(client);
  await openSpaceOverview(client);
  await client.poll("window.__spaceMotionEvents.some(e=>e.surface==='overview'&&e.type==='animationend'&&e.elapsed>=0.15)", 'visible space overview entrance completes');
  assert(await client.evaluate("window.__spaceMotionEvents.some(e=>e.surface==='menu'&&e.type==='animationstart')"), 'Space dropdown must animate when opened');
  await client.capture('01a-space-overview');
  await traceSpaceMotion(client);
  await switchViaUI(client, space.name, space.id);
  assert(await client.evaluate("window.__spaceMotionEvents.some(e=>e.surface==='overview'&&e.type==='animationstart'&&e.dialogOpen)"), 'Returning to the current space must keep the dialog present during its exit');
  assert(await client.evaluate("window.__spaceMotionEvents.some(e=>e.surface==='overview'&&e.type==='animationstart'&&parseFloat(e.duration)>=0.1)"), 'Current-space return must retain a perceptible exit animation before removal');
  assert.equal(await visibleAnchor(client), anchor, 'Opening and closing space management must preserve the visible reading anchor');
  assert.equal((await client.state()).scroll[source], anchor);
  assert(await client.evaluate("document.activeElement?.matches('.space-switch-trigger')"), 'Returning to the current space must restore focus to the initiating space switcher');

  await client.motion(true);
  await traceSpaceMotion(client);
  await openSpaceOverview(client);
  await client.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await client.evaluate("document.querySelector('.spaces-overview').getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).length"), 0, 'Reduced-motion space management must not play movement or fade animations');
  await client.escape();
  await client.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await client.evaluate("!!document.querySelector('.spaces-overview[open]')"), false, 'Reduced-motion management close must not wait for an animation timeout');
  assert.equal(await visibleAnchor(client), anchor);
  assert(await client.evaluate("document.activeElement?.matches('.space-switch-trigger')"), 'Escape must return keyboard focus to the initiating space switcher');
  await client.motion(false);
  report.checks.push('Space dropdown and management enter/exit visibly; returning to the same space preserves the reading anchor; reduced-motion closes immediately without animations');
}

async function main() {
  await fs.mkdir(evidenceRoot, { recursive: true });
  run = await fs.mkdtemp(path.join(evidenceRoot, 'run-')); report.run = run;
  temporary = await fs.mkdtemp(path.join(tmpdir(), 'md-duck-spaces-runtime-'));
  // Canonicalize fixtures so /var -> /private/var aliases do not obscure the assertions.
  temporary = await fs.realpath(temporary);
  profile = path.join(temporary, '隔离测试 profile');
  const rootA = path.join(temporary, '项目 A 文章');
  const rootB = path.join(temporary, '项目 B 文章');
  const a1 = path.join(rootA, '01-第一篇', 'article.md'), a2 = path.join(rootA, '02-第二篇', 'article.md');
  const b1 = path.join(rootB, '01-第一篇', 'article.md'), b2 = path.join(rootB, '02-第二篇', 'article.md');
  const azh = path.join(path.dirname(a1), 'article.zh.md'), bzh = path.join(path.dirname(b1), 'article.zh.md');
  const originals = new Map([[a1, article('Alpha first article', 'Alpha')], [a2, article('Alpha second article', 'Second Alpha')],
    [b1, article('Beta first article', 'Beta')], [b2, article('Beta second article', 'Second Beta')],
    [azh, article('甲空间第一篇', '甲', true)], [bzh, article('乙空间第一篇', '乙', true)]]);
  const imageA = path.join(path.dirname(a1), 'assets', 'own.png'), imageB = path.join(rootB, 'private.png');
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64');
  for (const file of [a1, azh]) originals.set(file, originals.get(file) + '\n<!-- block:own-image -->\n![Alpha allowed image](assets/own.png)\n\n<!-- block:foreign-image -->\n![Beta private image](<../../项目 B 文章/private.png>)\n');
  for (const file of [b1, bzh]) originals.set(file, originals.get(file) + '\n<!-- block:own-image -->\n![Beta allowed image](../private.png)\n');
  const makeNote = (id, prefix) => ({ id, blockId: 'p-10', blockKey: 'id:p-10', quote: `${prefix} paragraph 10.`, quoteLang: 'source', comment: `${prefix} original annotation`, createdAt: '2026-01-01T00:00:00.000Z', status: 'open' });
  const noteA = makeNote('test-note-alpha', 'Alpha'), noteB = makeNote('test-note-beta', 'Beta');
  const prefsA = { ui: 'zh', fontSize: 21, mode: 'bilingual', sidebar: true, sidebarTab: 'files', librarySort: 'name-asc', voice: 'af_heart', speed: 1, model: 'openai/gpt-4o-mini' };
  const legacyText = JSON.stringify({ root: rootA, openPath: a1, scroll: { [a1]: 'id:p-7' }, openRouterKey: null, prefs: prefsA }, null, 4);
  let application, current, otherClient, spaceA, spaceB, noteFileA, noteFileB, oldAssetURL;
  try {
    await fs.access(executable); await fs.access(appFile);
    report.appSha256 = await digest(appFile);
    report.buildSha256 = await buildDigest();
    report.version = appRoot ? JSON.parse(extractFile(appFile, 'package.json').toString()).version : JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')).version;
    report.expectedVersion = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')).version;
    assert.equal(report.version, report.expectedVersion, 'The tested application version must match this checkout');
    await fs.mkdir(profile, { recursive: true });
    for (const [file, text] of originals) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
    for (const file of [imageA, imageB]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, pixel); }
    noteFileA = await seedReview(a1, noteA); noteFileB = await seedReview(b1, noteB);
    await fs.writeFile(path.join(profile, 'settings.json'), legacyText);

    application = await launch(); current = application.first;
    const initial = await current.state();
    spaceA = initial.spaces.find(item => item.root === rootA);
    assert(spaceA, 'Legacy root must become the first space');
    assert.equal(initial.activeSpaceId, spaceA.id); assert.equal(initial.openPath, a1);
    assert.equal(initial.prefs.fontSize, 21); assert.equal(initial.prefs.mode, 'bilingual');
    assert.equal(await fs.readFile(path.join(profile, 'settings.pre-spaces.json'), 'utf8'), legacyText);
    assert.equal(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'), legacyText);
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-7', 'legacy reading anchor restored in rendered article');
    assert.deepEqual((await current.evaluate(`window.api.getNotes(${quoted(a1)})`)).notes, [noteA]);
    report.checks.push('Legacy settings migrate with byte-identical backup; original preferences, note and rendered reading anchor survive');
    await current.capture('01-legacy-space-restored');
    const header = await current.evaluate(`(() => {
      const box = selector => { const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
      return { heading:box('.topbar-heading'), actions:box('.topbar-actions'), switcher:box('.space-switch-trigger'), modes:box('.read-modes'), tools:box('.reader-tools'), viewport:innerWidth };
    })()`);
    assert(header.heading.bottom <= header.actions.y + 1, 'Identity and reading tools must occupy separate rows');
    assert(header.switcher.right > header.viewport - 45 && header.switcher.bottom <= header.heading.bottom + 1, 'Space switcher must be at upper right');
    assert(header.modes.y >= header.actions.y && header.tools.right <= header.viewport, 'Reading controls must fit the second row');
    const idleTask = await current.evaluate(`window.api.getCodexTask(${quoted(spaceA.id)})`);
    assert.equal(idleTask.spaceId, spaceA.id); assert.equal(idleTask.task, null); assert.equal(idleTask.availability.state, 'unknown');
    const cover = (await current.evaluate('window.api.listSpaces()')).find(item => item.id === spaceA.id).previewImages;
    assert(cover.length > 0 && cover.every(url => new URL(url).searchParams.get('path') === imageA), 'Space previews include only allowed local images');
    report.header = header;
    report.checks.push('Two-row toolbar separates article/space from reading tools; scoped local covers load and reading a task status never starts Codex');


    await scrollTo(current, 'id:p-12', a1);
    await verifySpaceMotion(current, spaceA, a1, 'id:p-12');
    await current.evaluate(`window.api.openPath(${quoted(rootB)})`); await current.reload();
    const added = await current.state(); spaceB = added.spaces.find(item => item.root === rootB);
    assert(spaceB && spaceB.id !== spaceA.id, 'Second root must have its own stable space');
    await current.evaluate("window.api.setPrefs({fontSize:23,mode:'source',librarySort:'title'})"); await current.reload();
    await current.poll(`window.api.getState().then(s=>s.openPath===${quoted(b1)})`, 'Beta first article selected');
    await scrollTo(current, 'id:p-18', b1);
    assert.deepEqual((await current.evaluate(`window.api.getNotes(${quoted(b1)})`)).notes, [noteB]);
    await traceSpaceMotion(current);
    // Simulate a renderer timeline that starts after the wall-clock cleanup
    // deadline was scheduled. A completed reveal must win over that deadline.
    await current.evaluate(`(() => {
      window.__originalSpaceAnimate=Element.prototype.animate;
      window.__delayedSpaceAnimations=0;
      Element.prototype.animate=function(...args){
        const animation=window.__originalSpaceAnimate.apply(this,args);
        if(this.matches('.scroll')){
          window.__delayedSpaceAnimations++;
          animation.pause();
          setTimeout(()=>{if(animation.playState==='paused')animation.play()},120);
        }
        return animation;
      };
    })()`);
    await switchViaUI(current, spaceA.name, spaceA.id);
    report.switchMotion = await current.evaluate('({animations:window.__spaceReaderAnimations,events:window.__spaceMotionEvents,delayedStarts:window.__delayedSpaceAnimations})');
    await current.evaluate('Element.prototype.animate=window.__originalSpaceAnimate;delete window.__originalSpaceAnimate');
    assert(report.switchMotion.delayedStarts > 0, 'The isolated delayed-start animation regression must exercise a real reader animation');
    assert(report.switchMotion.animations.some(animation=>animation.duration>=250&&animation.finished&&!animation.canceled), `A fast local space switch must still complete a perceptible reader transition: ${JSON.stringify(report.switchMotion)}`);
    assert.equal(await current.evaluate("!!document.querySelector('.space-opening, .space-enter')"), false, 'Reader transition must release its overlay and animation state after completion');
    let selected = await current.state();
    assert.equal(selected.prefs.fontSize, 21); assert.equal(selected.prefs.mode, 'bilingual'); assert.equal(selected.openPath, a1);
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-12', 'Alpha reading anchor restored after UI switch');
    await switchViaUI(current, spaceB.name, spaceB.id);
    selected = await current.state();
    assert.equal(selected.prefs.fontSize, 23); assert.equal(selected.prefs.mode, 'source'); assert.equal(selected.prefs.librarySort, 'title');
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-18', 'Beta reading anchor restored after UI switch');
    report.checks.push('Real upper-right menu controls switch spaces and restore each article, scroll anchor, font, reading mode, sort and annotation independently');

    await current.reload();
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-18', 'same article reload preserves Beta anchor');
    // Do not wait for Alpha's document/scroll restoration before returning.
    await switchViaUI(current, spaceA.name, spaceA.id);
    await switchViaUI(current, spaceB.name, spaceB.id);
    await current.poll(`window.api.getState().then(s=>s.activeSpaceId===${quoted(spaceB.id)}&&s.openPath===${quoted(b1)})`, 'rapid space switch returns to Beta');
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-18', 'rapid A to B switch preserves Beta anchor');
    assert.equal((await current.state()).scroll[b1], 'id:p-18');
    report.checks.push('Reloading the current article and rapidly returning through another space preserve its rendered reading anchor');

    await current.motion(true);
    await traceSpaceMotion(current);
    await switchViaUI(current, spaceA.name, spaceA.id);
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-12', 'reduced-motion switch restores Alpha anchor');
    await switchViaUI(current, spaceB.name, spaceB.id);
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-18', 'reduced-motion switch restores Beta anchor');
    assert.equal(await current.evaluate("window.__spaceMotionEvents.some(e=>e.surface==='reader'&&e.type==='animationstart')"), false, 'Reduced-motion space switches must not animate the reader');
    assert.equal(await current.evaluate('window.__spaceReaderAnimations.length'), 0, 'Reduced-motion space switches must not create scripted reader animations');
    assert.equal(await current.evaluate("!!document.querySelector('.space-opening, .space-enter')"), false, 'Reduced-motion switching must not leave a blocking transition');
    await current.motion(false);
    report.checks.push('Article-space reveals complete even when their animation timeline starts 120ms late, then release input; reduced-motion switches preserve both reading anchors without animation');

    const updatedA = originals.get(a1).replace('Alpha paragraph 24.', 'Alpha paragraph 24. Externally revised while Beta is active.');
    originals.set(a1, updatedA); await fs.writeFile(a1, updatedA);
    await current.poll(`window.api.listSpaces().then(items=>items.find(item=>item.id===${quoted(spaceA.id)})?.changedCount===1)`, 'background Alpha change marker');
    assert.equal((await current.state()).activeSpaceId, spaceB.id);
    assert.equal(await current.evaluate("document.querySelector('.reader')?.textContent.includes('Externally revised while Beta is active.')"), false);
    await current.click('.space-switch-trigger');
    await current.poll("!!document.querySelector('.space-switch-menu .space-changes')", 'background change visible in direct menu');
    await current.capture('02-background-space-change');
    await current.click('.space-switch-trigger');
    report.checks.push('An external edit in inactive Alpha appears in its space card while Beta remains the active document');

    const contextB = await current.evaluate(`window.api.getSpaceContext(${quoted(spaceB.id)},${quoted(b1)})`);
    assert(contextB.text.includes(rootB) && contextB.text.includes(spaceB.id) && !contextB.text.includes(rootA));
    const contextA = await current.evaluate(`window.api.getSpaceContext(${quoted(spaceA.id)},${quoted(a2)})`);
    assert(contextA.text.includes(rootA) && contextA.text.includes(spaceA.id));
    const location = new URL(contextA.url);
    assert.equal(location.searchParams.get('space'), spaceA.id);
    assert.equal(location.searchParams.get('path'), '02-第二篇/article.md');
    const foreignNotes = await current.evaluate(`window.api.getNotes(${quoted(a1)}).then(value=>({rejected:false,value}),()=>({rejected:true}))`);
    assert(foreignNotes.rejected || (foreignNotes.value.notes.length === 0 && foreignNotes.value.words.length === 0 && foreignNotes.value.reviewIssue), 'Beta must not reveal Alpha annotations');
    assert(await current.evaluate(`window.api.saveNote(${quoted(a1)},${quoted(noteA)}).then(()=>false,()=>true)`), 'Beta must reject writing Alpha annotations');
    assert(await current.evaluate(`window.api.getCodexTask(${quoted(spaceA.id)}).then(()=>false,()=>true)`), 'Stale other-space task commands must be rejected');
    report.checks.push('AI context binds the explicit space and article rather than the visible reader; foreign annotations are withheld and cross-space writes are rejected');

    const firstTarget = current.targetId;
    await current.evaluate(`window.api.openSpaceWindow(${quoted(spaceA.id)})`);
    await eventually(async () => (await application.targets()).length === 2, 'second actual BrowserWindow');
    otherClient = await application.client((await application.targets()).find(target => target.id !== firstTarget));
    await otherClient.poll(`window.api.getState().then(s=>s.activeSpaceId===${quoted(spaceA.id)})`, 'new window bound to Alpha');
    assert.equal((await current.state()).activeSpaceId, spaceB.id);
    await current.evaluate(`window.api.openSpaceWindow(${quoted(spaceA.id)})`);
    assert.equal((await application.targets()).length, 2, 'Opening an existing space must focus rather than duplicate its window');
    await otherClient.capture('03-independent-alpha-window');
    report.checks.push('Two real windows bind to different spaces; requesting an already open space does not create a duplicate window');

    await otherClient.poll("!!document.querySelector('img[alt=\"Alpha allowed image\"]')&&!!document.querySelector('img[alt=\"Beta private image\"]')", 'local and foreign image references render in Alpha');
    const imageChecks = await otherClient.evaluate(`(()=>{
      const own=document.querySelector('img[alt="Alpha allowed image"]').src;
      const foreign=document.querySelector('img[alt="Beta private image"]').src;
      const noScope=new URL(own);noScope.searchParams.delete('scope');
      return {own,foreign,noScope:noScope.href};
    })()`);
    assert(new URL(imageChecks.own).searchParams.get('scope'), 'Renderer must include its own document asset scope');
    // Renderer asset URLs use forward slashes on Windows; the fixture uses native separators.
    // Compare normalized local paths without relaxing the subsequent real 403 access check.
    assert.equal(path.normalize(new URL(imageChecks.foreign).searchParams.get('path')), path.normalize(imageB));
    const ownImage = await otherClient.imageStatus(imageChecks.own);
    assert.equal(ownImage.status, 200); assert.equal(ownImage.width, 1, 'Authorized local image must visibly decode');
    assert.equal((await otherClient.imageStatus(imageChecks.foreign)).status, 403);
    assert.equal((await otherClient.imageStatus(imageChecks.noScope)).status, 403);
    const betaImageURL = await current.evaluate("document.querySelector('img[alt=\"Beta allowed image\"]').src");
    assert.equal((await current.imageStatus(betaImageURL)).status, 200);
    oldAssetURL = imageChecks.own;
    report.checks.push('Alpha local images return 200, its relative reference to registered Beta is denied with 403, unscoped URLs are denied and Beta still reads its own image');

    await secondInstance(spaceA.id, path.join('02-第二篇', 'article.md'));
    await otherClient.poll(`window.api.getState().then(s=>s.activeSpaceId===${quoted(spaceA.id)}&&s.openPath===${quoted(a2)})`, 'CLI selects Alpha second article');
    await otherClient.poll("document.querySelector('.topbar')?.textContent.includes('Alpha second article')", 'CLI target is visibly rendered');
    assert.equal((await current.state()).openPath, b1); assert.equal((await current.state()).activeSpaceId, spaceB.id);
    assert.equal((await application.targets()).length, 2);
    await otherClient.capture('04-cli-targeted-article');
    report.checks.push('A second process with the same isolated profile hands explicit CLI targeting to the correct existing window and leaves Beta unchanged');

    await otherClient.close(); otherClient = null;
    await current.evaluate(`window.api.removeSpace(${quoted(spaceA.id)})`);
    assert(!(await current.evaluate('window.api.listSpaces()')).some(item => item.id === spaceA.id));
    assert((await fs.stat(noteFileA)).isFile());
    assert.equal((await current.imageStatus(oldAssetURL)).status, 403, 'Removing a space must revoke its old image scope');
    await current.evaluate(`window.api.openPath(${quoted(rootA)})`); await current.reload();
    const readded = await current.state();
    assert.equal(readded.activeSpaceId, spaceA.id); assert.equal(readded.openPath, a2);
    assert.equal(readded.scroll[a1], 'id:p-12'); assert.equal(readded.prefs.fontSize, 21);
    assert.deepEqual((await current.evaluate(`window.api.getNotes(${quoted(a1)})`)).notes, [noteA]);
    await current.poll("document.querySelector('.topbar')?.textContent.includes('Alpha second article')", 're-added space restores its visible article');
    await current.poll("[...document.querySelectorAll('.library-article-open')].some(button=>button.querySelector('.library-article-title')?.textContent==='Alpha first article')", 're-added space article list is rendered');
    report.checks.push('Removing and re-adding a folder restores its original ID, previous document, reading settings, anchor and notes');

    await current.evaluate("[...document.querySelectorAll('.library-article-open')].find(button=>button.querySelector('.library-article-title')?.textContent==='Alpha first article').click()");
    await current.poll(`window.api.getState().then(s=>s.openPath===${quoted(a1)})`, 'Alpha first article returned');
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-12', 'Alpha reading anchor retained after remove/re-add');
    await switchViaUI(current, spaceB.name, spaceB.id);
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-18', 'Beta reading anchor retained after other space was removed');
    await current.close(); current = null;
    await eventually(async () => {
      const saved = JSON.parse(await fs.readFile(path.join(profile, 'spaces', spaceB.id, 'settings.json'), 'utf8'));
      return saved.openPath === b1 && saved.scroll[b1] === 'id:p-18' && saved.prefs.fontSize === 23;
    }, 'closing the window flushes its reading state');
    await application.stop(); application = null;

    application = await launch(); current = application.first;
    const restarted = await current.state();
    assert.equal(restarted.activeSpaceId, spaceB.id); assert.equal(restarted.openPath, b1);
    assert.equal(restarted.prefs.fontSize, 23); assert.equal(restarted.prefs.mode, 'source');
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-18', 'rendered Beta anchor survives process restart');
    assert.deepEqual((await current.evaluate(`window.api.getNotes(${quoted(b1)})`)).notes, [noteB]);
    await switchViaUI(current, spaceA.name, spaceA.id);
    assert.equal((await current.state()).openPath, a1); assert.equal((await current.state()).prefs.fontSize, 21);
    assert.deepEqual((await current.evaluate(`window.api.getNotes(${quoted(a1)})`)).notes, [noteA]);
    await current.capture('05-restart-restores-spaces');
    report.checks.push('Closing windows flushes settings; a fresh process restores the active space and both spaces retain their article, anchor, preferences and annotations');

    await eventually(async () => (await visibleAnchor(current)) === 'id:p-12', 'Alpha anchor settles before damaged-settings check');
    await current.close(); current = null;
    await application.stop(); application = null;
    const settingsA = path.join(profile, 'spaces', spaceA.id, 'settings.json');
    const originalSettingsA = await fs.readFile(settingsA);
    const damagedSettings = '{"root": "deliberately interrupted test configuration';
    await fs.writeFile(settingsA, damagedSettings);
    application = await launch(); current = application.first;
    const degraded = await current.state();
    assert.equal(degraded.activeSpaceId, null); assert.equal(degraded.root, null);
    const unavailable = degraded.spaces.find(space => space.id === spaceA.id);
    assert.equal(unavailable.availability, 'unreadable'); assert.equal(unavailable.unavailableReason, 'settings');
    await current.poll("!!document.querySelector('.spaces-overview[open]')", 'damaged active settings open the space overview instead of blocking startup');
    const damagedCard = await current.evaluate(`(() => {const card=[...document.querySelectorAll('.space-card')].find(item=>item.querySelector('.space-name')?.textContent===${quoted(spaceA.name)});return {disabled:card?.querySelector('.space-card-open')?.disabled,text:card?.textContent}})()`);
    assert.equal(damagedCard.disabled, true); assert(/空间设置暂时无法读取|Space settings cannot be read/.test(damagedCard.text));
    assert.equal(await fs.readFile(settingsA, 'utf8'), damagedSettings);
    await current.capture('06-damaged-space-keeps-other-spaces-available');
    await switchViaUI(current, spaceB.name, spaceB.id);
    assert.equal((await current.state()).openPath, b1);
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-18', 'healthy Beta still restores its anchor with damaged Alpha settings');
    assert.equal(await fs.readFile(settingsA, 'utf8'), damagedSettings, 'Opening a healthy space must not overwrite the damaged configuration');
    await fs.writeFile(settingsA, originalSettingsA);
    await current.evaluate('window.api.listSpaces()');
    await switchViaUI(current, spaceA.name, spaceA.id);
    await eventually(async () => (await visibleAnchor(current)) === 'id:p-12', 'restored Alpha configuration becomes readable again');
    assert.deepEqual((await current.evaluate(`window.api.getNotes(${quoted(a1)})`)).notes, [noteA]);
    report.checks.push('A damaged active space configuration remains byte-intact and clearly marked; startup and a healthy space still work, and restoring its saved bytes restores the original space and reading position');

    for (const [file, text] of originals) assert.equal(await fs.readFile(file, 'utf8'), text, `Article or translation changed unexpectedly: ${file}`);
    for (const file of [imageA, imageB]) assert.deepEqual(await fs.readFile(file), pixel, 'Local image bytes must remain unchanged');
    assert.deepEqual(JSON.parse(await fs.readFile(noteFileA, 'utf8')).notes, [noteA]);
    assert.deepEqual(JSON.parse(await fs.readFile(noteFileB, 'utf8')).notes, [noteB]);
    assert.equal(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'), legacyText);
    assert.equal(await fs.readFile(path.join(profile, 'settings.pre-spaces.json'), 'utf8'), legacyText);
    assert.equal(await digest(appFile), report.appSha256, 'The tested application must not change during this run');
    assert.equal(await buildDigest(), report.buildSha256, 'The tested renderer and preload must not change during this run');
    report.checks.push('All original article, translation and annotation bytes/content remain intact except the deliberate external edit; original settings and backup stay byte-identical');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack || error);
    if (current) {
      report.failureState = await current.state().catch(() => null);
      report.failureViewport = await current.evaluate("({title:document.querySelector('.topbar .title')?.textContent,scrollTop:document.querySelector('.scroll')?.scrollTop})").catch(() => null);
      await current.capture('failure').catch(() => undefined);
    }
  } finally {
    if (application) await application.stop().catch(error => { report.status = 'failed'; report.cleanupError = String(error); });
    // Optional main-process diagnostics are written only by the isolated profile.
    if (profile) for (const name of await fs.readdir(profile).catch(() => [])) {
      if (!/^spaces-runtime-trace.*\.(?:log|jsonl|json)$/.test(name)) continue;
      await fs.copyFile(path.join(profile, name), path.join(run, name)).catch(() => undefined);
    }
    if (temporary) await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(error => { report.status = 'failed'; report.cleanupError = String(error); });
    report.finishedAt = new Date().toISOString();
    report.durationSeconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;
    await fs.writeFile(path.join(run, 'result.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(evidenceRoot, 'latest.json'), JSON.stringify({ run, result: path.join(run, 'result.json') }, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'passed') process.exitCode = 1;
  }
}
main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
