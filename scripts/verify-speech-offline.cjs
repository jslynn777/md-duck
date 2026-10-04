#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const { join, resolve, sep } = require('node:path');
const { performance } = require('node:perf_hooks');

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const TEXT = 'A quiet morning.';
const VOICE = 'af_heart';
let blockedRequests = 0;
globalThis.fetch = async () => {
  blockedRequests += 1;
  throw new Error('NETWORK_DISABLED_FOR_OFFLINE_SPEECH_VERIFICATION');
};

// Bound this standalone verification process even if a native call stalls.
const timeout = setTimeout(() => {
  console.error('Offline speech verification exceeded 60 seconds');
  process.exit(2);
}, 60_000);
timeout.unref();

async function inventory(directory, prefix = '') {
  const result = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Unexpected symlink in the verification cache: ${name}`);
    if (entry.isDirectory()) result.push(...await inventory(path, name));
    else if (entry.isFile()) {
      const stat = await fs.stat(path);
      result.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return result;
}

async function main() {
  assert(process.argv[2] && process.argv[3], 'Usage: verify-speech-offline.cjs <app.asar or workspace root> <existing model-cache directory>');
  const started = performance.now();
  const appRoot = resolve(process.argv[2]);
  const cacheDir = await fs.realpath(resolve(process.argv[3]));
  assert((await fs.stat(cacheDir)).isDirectory(), 'The model cache must be an existing directory');
  const manifest = join(appRoot, 'package.json');
  await fs.access(manifest);
  const fromApp = createRequire(manifest);
  const dependencies = {};
  for (const name of ['kokoro-js', '@huggingface/transformers']) {
    const path = fromApp.resolve(name);
    assert(path.startsWith(appRoot + sep) || path.startsWith(appRoot + '.unpacked' + sep), `Dependency resolved outside the selected application: ${name}`);
    dependencies[name] = path;
  }
  const before = await inventory(cacheDir);
  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
    assert(before.some((entry) => entry.name === `${MODEL}/${file}` && entry.size > 0), `Required model file is not cached: ${file}`);
  }

  const { env } = fromApp('@huggingface/transformers');
  env.cacheDir = cacheDir;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = cacheDir;
  env.useBrowserCache = false;
  env.useCustomCache = false;
  env.useFSCache = true;
  const { KokoroTTS } = fromApp('kokoro-js');
  const loadStarted = performance.now();
  const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' });
  const modelLoadMs = performance.now() - loadStarted;
  let report;
  try {
    const synthesisStarted = performance.now();
    // Generate directly from the model; never read the reader's speech-cache.
    const audio = await tts.generate(TEXT, { voice: VOICE, speed: 1 });
    const synthesisMs = performance.now() - synthesisStarted;
    assert(audio.audio instanceof Float32Array && audio.audio.length > 0, 'Synthesis returned no Float32 audio');
    assert.equal(audio.sampling_rate, 24000, 'Unexpected speech sample rate');
    let peak = 0;
    let sumSquares = 0;
    for (const sample of audio.audio) {
      assert(Number.isFinite(sample), 'Synthesis returned a non-finite sample');
      peak = Math.max(peak, Math.abs(sample));
      sumSquares += sample * sample;
    }
    assert(peak > 0, 'Synthesis returned only silence');
    const wav = Buffer.from(audio.toWav());
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    report = {
      text: TEXT,
      voice: VOICE,
      model: MODEL,
      dtype: 'q8',
      device: 'cpu',
      modelLoadMs: Math.round(modelLoadMs),
      synthesisMs: Math.round(synthesisMs),
      sampleRate: audio.sampling_rate,
      samples: audio.audio.length,
      floatBytes: audio.audio.byteLength,
      wavBytes: wav.byteLength,
      durationSeconds: audio.audio.length / audio.sampling_rate,
      peak,
      rms: Math.sqrt(sumSquares / audio.audio.length),
      allSamplesFinite: true
    };
  } finally {
    await tts.model.dispose();
  }

  assert.equal(blockedRequests, 0, 'A dependency attempted a network request');
  assert.deepEqual(await inventory(cacheDir), before, 'Model-cache files changed during offline verification');
  process.stdout.write(JSON.stringify({
    status: 'passed',
    appRoot,
    cacheDir,
    runtime: { electron: process.versions.electron ?? null, node: process.versions.node, platform: process.platform, arch: process.arch },
    dependencies,
    ...report,
    totalMs: Math.round(performance.now() - started),
    networkRequests: blockedRequests,
    remoteModelsAllowed: env.allowRemoteModels,
    modelCacheUnchanged: true,
    audioWrittenToDisk: false
  }, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}).finally(() => clearTimeout(timeout));
