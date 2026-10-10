#!/usr/bin/env node
'use strict';

// Node launches an isolated native Electron host with the selected executable's
// runtime. The selected application, model fixture and normal profile stay intact.
// This tests utilityProcess/ASAR/neural IPC, not speaker output or reader UI.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants, createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { basename, dirname, join, relative, resolve, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { performance } = require('node:perf_hooks');

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_BYTES = 92361116;
const MODEL_HASH = 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478';
const CASES = [
  { voice: 'af_heart', text: 'A quiet morning. Read the article at your own pace.' },
  { voice: 'bf_emma', text: 'What files do I need to provide for custom-printed Christmas ribbons?' }
];

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(directory, prefix = '') {
  const result = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    assert(!entry.isSymbolicLink(), `Unexpected symlink in verification directory: ${entry.name}`);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await inventory(path, name));
    else {
      assert(entry.isFile(), `Unexpected non-file: ${name}`);
      const stat = await fs.stat(path);
      result.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return result;
}

// Read the public ASAR header format directly, so this harness needs no extra
// dependency in either the verification host or an installed Windows app.
async function archiveReader(path) {
  const file = await fs.open(path, 'r');
  let header; let headerSize;
  try {
    const size = Buffer.alloc(8);
    assert.equal((await file.read(size, 0, 8, 0)).bytesRead, 8, 'Invalid ASAR header');
    assert.equal(size.readUInt32LE(0), 4, 'Invalid ASAR size pickle');
    headerSize = size.readUInt32LE(4);
    assert(headerSize >= 8 && headerSize <= 64 * 1024 * 1024, 'Invalid ASAR header size');
    const bytes = Buffer.alloc(headerSize);
    assert.equal((await file.read(bytes, 0, headerSize, 8)).bytesRead, headerSize);
    const length = bytes.readUInt32LE(4);
    assert(length > 0 && length <= headerSize - 8, 'Invalid ASAR JSON length');
    header = JSON.parse(bytes.subarray(8, 8 + length).toString('utf8'));
  } finally { await file.close(); }
  function entry(name) {
    let item = header;
    for (const part of name.split('/')) { assert(part && part !== '.' && part !== '..'); item = item.files?.[part]; assert(item, `Missing ASAR entry: ${name}`); }
    assert(!item.link && !item.files && Number.isSafeInteger(item.size), `Not an ASAR file: ${name}`);
    return item;
  }
  async function read(name) {
    const item = entry(name);
    if (item.unpacked) return fs.readFile(join(`${path}.unpacked`, ...name.split('/')));
    const offset = Number(item.offset);
    assert(Number.isSafeInteger(offset) && offset >= 0 && item.size <= 64 * 1024 * 1024, `Invalid ASAR offset/size: ${name}`);
    const handle = await fs.open(path, 'r');
    try {
      const bytes = Buffer.alloc(item.size);
      assert.equal((await handle.read(bytes, 0, item.size, 8 + headerSize + offset)).bytesRead, item.size);
      return bytes;
    } finally { await handle.close(); }
  }
  return { entry, read };
}

function parseArguments() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/verify-speech-worker.cjs <app.asar or workspace root> --exe <native Electron executable> --model-cache <existing public fixture> [--timeout-ms 120000]');
    process.exit(0);
  }
  const selected = args.shift(); const options = {};
  while (args.length) { const flag = args.shift(); assert(['--exe', '--model-cache', '--timeout-ms'].includes(flag) && args.length, `Unknown/incomplete option: ${flag}`); options[flag] = args.shift(); }
  assert(selected && options['--exe'] && options['--model-cache'], 'Explicit application, native Electron executable and public test model cache are required. Use --help.');
  const timeoutMs = Number(options['--timeout-ms'] ?? 120000);
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 10000 && timeoutMs <= 600000, 'Invalid timeout');
  return { selected: resolve(selected), executable: resolve(options['--exe']), modelDir: resolve(options['--model-cache']), timeoutMs };
}

async function inspectSelected(options) {
  const selected = await fs.realpath(options.selected);
  const executable = await fs.realpath(options.executable);
  assert((await fs.stat(executable)).isFile(), 'Executable is not a file');
  const resources = process.platform === 'darwin' ? join(dirname(dirname(executable)), 'Resources') : join(dirname(executable), 'resources');
  const packaged = selected.endsWith('.asar');
  if (packaged) assert.equal(selected, await fs.realpath(join(resources, 'app.asar')), 'Executable does not belong to the selected application');
  const archive = packaged ? await archiveReader(selected) : null;
  const read = (name) => archive ? archive.read(name) : fs.readFile(join(selected, ...name.split('/')));
  const manifest = JSON.parse((await read('package.json')).toString('utf8'));
  const mainText = (await read('out/main/index.js')).toString('utf8');
  const references = [...mainText.matchAll(/['"](?:\.\/)?(speech-worker(?:-[A-Za-z0-9_-]+)?\.js)['"]/g)].map((match) => match[1]);
  assert.equal(new Set(references).size, 1, 'Compiled app must identify one unambiguous worker entry');
  const workerEntry = `out/main/${references[0]}`;
  const workerPath = packaged ? join(`${selected}.unpacked`, ...workerEntry.split('/')) : join(selected, ...workerEntry.split('/'));
  assert((await fs.lstat(workerPath)).isFile() && !(await fs.lstat(workerPath)).isSymbolicLink(), 'Worker must be a regular unpacked file');
  const worker = await fs.realpath(workerPath);
  const owner = packaged ? await fs.realpath(`${selected}.unpacked`) : selected;
  assert(worker.startsWith(owner + sep), 'Worker resolved outside selected application');
  const workerHash = await sha256(worker);
  if (archive) {
    const metadata = archive.entry(workerEntry);
    assert(metadata.unpacked && metadata.integrity?.algorithm === 'SHA256', 'Worker must have unpacked ASAR integrity metadata');
    assert.equal(workerHash, metadata.integrity.hash, 'Unpacked worker differs from the selected ASAR header');
    assert.equal((await fs.stat(worker)).size, metadata.size, 'Unpacked worker size differs');
  }
  const voiceDirectory = packaged ? join(resources, 'kokoro-voices') : join(selected, 'src/main/data/kokoro-voices');
  const voiceSource = JSON.parse(await fs.readFile(join(voiceDirectory, 'SOURCE.json'), 'utf8'));
  const voices = [];
  for (const { voice } of CASES) {
    const expected = voiceSource.files.find(({ file }) => file === `${voice}.bin`);
    assert(expected && /^[a-f0-9]{64}$/.test(expected.sha256), `Missing pinned voice: ${voice}`);
    const path = join(voiceDirectory, `${voice}.bin`);
    assert((await fs.lstat(path)).isFile() && !(await fs.lstat(path)).isSymbolicLink());
    assert.equal((await fs.stat(path)).size, 522240);
    assert.equal(await sha256(path), expected.sha256, `Voice bytes differ: ${voice}`);
    voices.push({ voice, sha256: expected.sha256 });
  }
  const modelDir = await fs.realpath(options.modelDir);
  // Only explicit fixtures are accepted; never discover or read a normal profile.
  assert(!modelDir.includes(`${sep}Application Support${sep}`) && !modelDir.includes(`${sep}AppData${sep}`), 'Use a public test fixture, not a user profile');
  for (const directory of [modelDir, join(modelDir, 'onnx-community'), join(modelDir, MODEL), join(modelDir, MODEL, 'onnx')]) {
    const stat = await fs.lstat(directory); assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Model directory must be real and pre-existing');
  }
  const modelFile = join(modelDir, MODEL, 'onnx/model_quantized.onnx');
  const modelStat = await fs.lstat(modelFile);
  assert(modelStat.isFile() && !modelStat.isSymbolicLink(), 'Model fixture must be a regular file');
  assert.equal(modelStat.size, MODEL_BYTES, 'Pinned model size differs; this check never downloads');
  assert.equal(await sha256(modelFile), MODEL_HASH, 'Pinned model hash differs; this check never downloads');
  return { selected, executable, resources, packaged, worker, workerEntry, workerHash, manifestVersion: manifest.version, voiceDirectory, voices, modelDir, modelFile };
}

async function launch() {
  const options = parseArguments();
  const selected = await inspectSelected(options);
  const beforeModel = await inventory(selected.modelDir);
  const beforeHashes = { executable: await sha256(selected.executable), worker: selected.workerHash, asar: selected.packaged ? await sha256(selected.selected) : null };
  const temporary = await fs.mkdtemp(join(tmpdir(), 'md-duck-worker-check-'));
  let child; let timer; let signalHandler;
  try {
    const sourceHost = process.platform === 'darwin' ? dirname(dirname(dirname(selected.executable))) : dirname(selected.executable);
    const host = join(temporary, process.platform === 'darwin' ? basename(sourceHost) : 'native-host');
    const copiedResources = join(host, relative(sourceHost, selected.resources));
    await fs.cp(sourceHost, host, {
      recursive: true, preserveTimestamps: true, verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
      filter: (path) => { const part = relative(selected.resources, path); return !['app.asar', 'app.asar.unpacked', 'app'].some((name) => part === name || part.startsWith(name + sep)); }
    });
    const hostExecutable = join(host, relative(sourceHost, selected.executable));
    assert.equal(await sha256(hostExecutable), beforeHashes.executable, 'Verification executable differs');
    const hostApp = join(copiedResources, 'app');
    await fs.mkdir(hostApp, { recursive: true });
    await fs.copyFile(__filename, join(hostApp, 'verify.cjs'));
    await fs.writeFile(join(hostApp, 'package.json'), JSON.stringify({ name: 'md-duck-worker-verification', version: '1.0.0', main: 'verify.cjs' }));
    const config = { ...selected, temporary, timeoutMs: options.timeoutMs, report: join(temporary, 'report.json'), cacheDir: join(temporary, 'speech-cache') };
    await fs.writeFile(join(hostApp, 'config.json'), JSON.stringify(config));
    // utilityProcess does not reliably execute Node --require preloads. A small
    // native utility entry blocks network, verifies the actual worker again, then
    // requires that unmodified packaged file. Module-relative ASAR/native lookup
    // therefore still belongs to the selected application.
    const loader = join(temporary, 'offline-worker-loader.cjs');
    await fs.writeFile(loader, "'use strict';\nconst block = () => { process.parentPort.postMessage({type:'verification-network-blocked'}); throw new Error('NETWORK_DISABLED_FOR_WORKER_VERIFICATION'); };\nglobalThis.fetch = async () => block();\nfor (const name of ['node:http','node:https']) { const network = require(name); network.request = block; network.get = block; }\nconst target = " + JSON.stringify(selected.worker) + ";\nrequire('node:assert/strict').equal(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(target)).digest('hex'), " + JSON.stringify(selected.workerHash) + ");\nprocess.parentPort.postMessage({type:'verification-offline-ready'});\nrequire(target);\n");
    const env = { ...process.env, MD_DUCK_WORKER_CHECK_CONFIG: join(hostApp, 'config.json'), MD_DUCK_WORKER_CHECK_LOADER: loader };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    let output = '';
    child = spawn(hostExecutable, [], { env, cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (bytes) => { output = (output + bytes).slice(-12000); });
    child.stderr.on('data', (bytes) => { output = (output + bytes).slice(-12000); });
    const exit = new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolveExit({ code, signal })); });
    timer = setTimeout(() => child.kill(), options.timeoutMs + 10000);
    signalHandler = () => child.kill();
    process.once('SIGINT', signalHandler); process.once('SIGTERM', signalHandler);
    const outcome = await exit;
    let report;
    try { report = JSON.parse(await fs.readFile(config.report, 'utf8')); }
    catch { throw new Error(`Native host produced no report (${JSON.stringify(outcome)}).\n${output}`); }
    assert.equal(outcome.code, 0, `Worker verification failed: ${report.error ?? output}`);
    assert.equal(report.status, 'passed', report.error ?? 'Worker check failed');
    assert.deepEqual(await inventory(selected.modelDir), beforeModel, 'Public model cache changed');
    assert.equal(await sha256(selected.executable), beforeHashes.executable, 'Original executable changed');
    assert.equal(await sha256(selected.worker), beforeHashes.worker, 'Original worker changed');
    if (selected.packaged) assert.equal(await sha256(selected.selected), beforeHashes.asar, 'Original ASAR changed');
    console.log(JSON.stringify({ ...report, originalApplicationUnchanged: true, modelCacheUnchanged: true, temporaryHostRemoved: true }, null, 2));
  } finally {
    clearTimeout(timer);
    if (signalHandler) { process.removeListener('SIGINT', signalHandler); process.removeListener('SIGTERM', signalHandler); }
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function electronMain() {
  const { app, utilityProcess } = require('electron');
  const config = JSON.parse(await fs.readFile(process.env.MD_DUCK_WORKER_CHECK_CONFIG, 'utf8'));
  app.setPath('userData', join(config.temporary, 'profile'));
  app.setPath('sessionData', join(config.temporary, 'session'));
  app.setPath('logs', join(config.temporary, 'logs'));
  app.setPath('crashDumps', join(config.temporary, 'crash-dumps'));
  app.commandLine.appendSwitch('disable-background-networking');
  app.dock?.hide();
  const active = new Set(); const started = performance.now();
  const deadline = setTimeout(() => finish({ status: 'failed', error: 'Native speech worker timed out' }, 2), config.timeoutMs);
  let finished = false;
  async function finish(report, code) {
    if (finished) return; finished = true; clearTimeout(deadline);
    for (const worker of active) worker.kill();
    try { await fs.writeFile(config.report, JSON.stringify(report)); }
    finally { app.exit(code); }
  }
  function makeWorker() {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    const worker = utilityProcess.fork(process.env.MD_DUCK_WORKER_CHECK_LOADER, [], {
      serviceName: 'MD Duck Offline Worker Verification',
      cwd: config.temporary,
      env, stdio: 'pipe'
    });
    active.add(worker);
    let stderr = ''; let offlineReady = false; let blocked = 0; let exited = false; let pending = null;
    worker.stderr?.on('data', (bytes) => { stderr = (stderr + bytes).slice(-5000); });
    worker.on('exit', (code) => { exited = true; active.delete(worker); pending?.reject(new Error(`Utility process exited (${code}): ${stderr}`)); });
    worker.on('message', (message) => {
      if (message.type === 'verification-offline-ready') { offlineReady = true; return; }
      if (message.type === 'verification-network-blocked') { blocked += 1; pending?.reject(new Error('Worker attempted a network request')); return; }
      if (!pending) return;
      if (message.type === 'status') {
        pending.statuses.push(message.message);
        if (String(message.message).startsWith('download:')) pending.reject(new Error('Worker attempted model download'));
        return;
      }
      if (message.id !== pending.id) return;
      if (message.type === 'part') {
        try {
          assert.equal(message.sampleRate, 24000);
          assert(message.samples instanceof Float32Array && message.samples.length > 0, 'IPC part has no Float32 audio');
          let peak = 0; let squares = 0;
          for (const sample of message.samples) { assert(Number.isFinite(sample), 'Non-finite IPC audio'); peak = Math.max(peak, Math.abs(sample)); squares += sample * sample; }
          assert(peak > 0.001, 'Silent IPC audio');
          pending.parts.push({ samples: message.samples.length, sampleRate: 24000, peak, rms: Math.sqrt(squares / message.samples.length), sha256: createHash('sha256').update(Buffer.from(message.samples.buffer, message.samples.byteOffset, message.samples.byteLength)).digest('hex') });
        } catch (error) { pending.reject(error); }
      } else if (message.type === 'error') pending.reject(new Error(`Worker error: ${message.message}\n${stderr}`));
      else if (message.type === 'done') {
        try {
          assert(pending.parts.length, 'Worker completed without audio');
          assert(offlineReady, 'Offline utility loader did not run'); assert.equal(blocked, 0);
          pending.resolve({ voice: pending.voice, text: pending.text, parts: pending.parts, statuses: pending.statuses, synthesisMs: Math.round(performance.now() - pending.started), networkRequests: blocked, offlineGuardActive: offlineReady });
          pending = null;
        } catch (error) { pending.reject(error); }
      }
    });
    worker.postMessage({ type: 'init', cacheDir: config.cacheDir, modelDir: config.modelDir, voiceDirectory: config.voiceDirectory });
    return {
      speak: ({ voice, text }, id) => new Promise((resolvePart, reject) => {
        assert(!pending && !exited, 'Worker is unavailable');
        pending = { id, voice, text, parts: [], statuses: [], started: performance.now(), resolve: resolvePart, reject };
        worker.postMessage({ type: 'speak', id, voice, text, speed: 1 });
      }),
      stop: async () => { if (exited) return; const exit = new Promise((resolveExit) => worker.once('exit', resolveExit)); worker.kill(); await exit; }
    };
  }
  try {
    await app.whenReady();
    const first = makeWorker(); const voices = [];
    for (const [index, sample] of CASES.entries()) voices.push(await first.speak(sample, `first-${index}`));
    await first.stop();
    const cacheBefore = await inventory(config.cacheDir);
    assert(cacheBefore.some(({ name }) => name.endsWith('.f32')), 'No speech cache was created');
    // A new utility process proves the second read bypasses model preparation,
    // unlike a second request to an already-loaded inference session.
    const second = makeWorker(); const cached = await second.speak(CASES[0], 'cache-hit'); await second.stop();
    assert(!cached.statuses.includes('prepare'), 'Fresh worker did not reuse cached speech');
    assert.deepEqual(cached.parts, voices[0].parts, 'Cached IPC audio differs');
    assert.deepEqual(await inventory(config.cacheDir), cacheBefore, 'Speech cache was rewritten on second read');
    await finish({
      status: 'passed', selectedApplication: config.selected, version: config.manifestVersion,
      executable: config.executable, worker: config.worker, workerEntry: config.workerEntry, workerSha256: config.workerHash,
      workerIntegrityVerifiedAgainstAsar: config.packaged, voiceDirectory: config.voiceDirectory,
      workerEntryMode: 'native utilityProcess guard loader requires unmodified selected physical worker',
      pinnedModelSha256: MODEL_HASH, modelDir: config.modelDir,
      runtime: { electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch },
      voices, cacheReuse: { freshWorker: true, noModelPreparation: true, unchangedCache: true, samplesIdentical: true },
      networkRequests: 0, totalMs: Math.round(performance.now() - started),
      scope: 'Native utilityProcess guard loader requires the actual selected unpacked worker with the same Electron binary. Tests packaged ASAR/runtime language chunks, US+UK 24kHz neural IPC and fresh-process cache reuse. No model download, normal user profile, reader window or audible playback test; fork bootstrap differs from the reader app.'
    }, 0);
  } catch (error) { await finish({ status: 'failed', error: error.stack ?? String(error) }, 1); }
}

if (process.versions.electron && process.env.MD_DUCK_WORKER_CHECK_CONFIG && !process.env.ELECTRON_RUN_AS_NODE) {
  electronMain().catch((error) => { console.error(error.stack ?? String(error)); require('electron').app.exit(1); });
} else {
  launch().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
}
