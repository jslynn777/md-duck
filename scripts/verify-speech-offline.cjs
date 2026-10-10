#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { performance } = require('node:perf_hooks');
const { selectedApplication, VOICES } = require('./speech-check-common.cjs');

let blockedRequests = 0;
globalThis.fetch = async () => {
  blockedRequests += 1;
  throw new Error('NETWORK_DISABLED_FOR_OFFLINE_SPEECH_VERIFICATION');
};
const timeout = setTimeout(() => { console.error('Offline speech verification exceeded 120 seconds'); process.exit(2); }, 120_000);
timeout.unref();
async function inventory(directory, prefix = '') {
  const result = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Unexpected symlink in verification cache: ${name}`);
    if (entry.isDirectory()) result.push(...await inventory(path, name));
    else if (entry.isFile()) { const stat = await fs.stat(path); result.push({ name, size: stat.size, mtimeMs: stat.mtimeMs }); }
  }
  return result;
}
async function main() {
  assert(process.argv[2] && process.argv[3], 'Usage: verify-speech-offline.cjs <app.asar or workspace root> <existing model-cache directory>');
  const started = performance.now();
  const selected = await selectedApplication(process.argv[2]);
  const cacheDir = await fs.realpath(resolve(process.argv[3]));
  assert((await fs.stat(cacheDir)).isDirectory(), 'An existing public test model cache is required');
  const before = await inventory(cacheDir);
  const loadStarted = performance.now();
  const tts = await selected.runtime.KokoroRuntime.create({ cacheDir, voiceDirectory: selected.voiceDirectory, allowRemoteModels: false });
  const modelLoadMs = performance.now() - loadStarted;
  const reports = [];
  try {
    for (const voice of VOICES) {
      const text = voice.startsWith('b') ? 'A calm afternoon.' : 'A quiet morning.';
      const synthesisStarted = performance.now();
      const audio = await tts.generate(text, { voice, speed: 1 });
      assert(audio.audio instanceof Float32Array && audio.audio.length > 0, 'No Float32 speech audio');
      assert.equal(audio.sampling_rate, 24000);
      let peak = 0; let sumSquares = 0;
      for (const sample of audio.audio) { assert(Number.isFinite(sample), 'Non-finite audio'); peak = Math.max(peak, Math.abs(sample)); sumSquares += sample * sample; }
      assert(peak > 0.001, 'Only silent audio was generated');
      reports.push({ voice, text, synthesisMs: Math.round(performance.now() - synthesisStarted), samples: audio.audio.length, sampleRate: audio.sampling_rate, durationSeconds: audio.audio.length / audio.sampling_rate, peak, rms: Math.sqrt(sumSquares / audio.audio.length), allSamplesFinite: true });
    }
  } finally { await tts.dispose(); }
  assert.equal(blockedRequests, 0, 'A dependency attempted a network request');
  assert.deepEqual(await inventory(cacheDir), before, 'Model cache changed during offline verification');
  console.log(JSON.stringify({ status: 'passed', appRoot: selected.appRoot, cacheDir,
    runtime: { electron: process.versions.electron ?? null, node: process.versions.node, platform: process.platform, arch: process.arch },
    model: 'onnx-community/Kokoro-82M-v1.0-ONNX', revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231', dtype: 'q8', device: 'cpu',
    modelLoadMs: Math.round(modelLoadMs), voices: reports, totalMs: Math.round(performance.now() - started), networkRequests: blockedRequests, remoteModelsAllowed: false, modelCacheUnchanged: true, audioWrittenToDisk: false
  }, null, 2));
}
main().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; }).finally(() => clearTimeout(timeout));
