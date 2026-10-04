#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const { dirname, join, resolve, sep } = require('node:path');

// This check loads the selected application's real dependencies. It does not
// open a window, start the reader, access its profile, or download a TTS model.
let blockedRequests = 0;
globalThis.fetch = async () => {
  blockedRequests += 1;
  throw new Error('NETWORK_DISABLED_FOR_PACKAGING_SMOKE');
};

async function main() {
  if (!process.argv[2]) {
    throw new Error('Usage: verify-speech-runtime.cjs <app.asar or workspace root>');
  }
  const appRoot = resolve(process.argv[2]);
  const manifest = join(appRoot, 'package.json');
  await fs.access(manifest);
  const fromApp = createRequire(manifest);
  assert.equal(process.platform, 'darwin', 'This release check expects macOS');
  assert.equal(process.arch, 'arm64', 'This release check expects an arm64 runtime');

  const dependencies = {};
  for (const name of [
    'onnxruntime-node', 'sharp', '@huggingface/transformers',
    'phonemizer', 'kokoro-js'
  ]) {
    const resolved = fromApp.resolve(name);
    assert(
      resolved.startsWith(appRoot + sep) || resolved.startsWith(appRoot + '.unpacked' + sep),
      `Dependency resolved outside the selected application: ${name}`
    );
    dependencies[name] = resolved;
  }

  const ort = fromApp('onnxruntime-node');
  const sharp = fromApp('sharp');
  const { env } = fromApp('@huggingface/transformers');
  env.allowRemoteModels = false;
  const { phonemize } = fromApp('phonemizer');
  const { KokoroTTS } = fromApp('kokoro-js');
  assert.equal(typeof KokoroTTS, 'function');

  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#fff' }
  }).png().toBuffer();
  assert(png.length > 0, 'sharp returned an empty PNG');
  const phonemes = await phonemize('Hello, world.', 'en-us');
  assert(Array.isArray(phonemes) && phonemes.some((part) => typeof part === 'string' && part.length > 0), 'Phonemizer returned no phonemes');
  const voice = await fs.readFile(join(
    dirname(fromApp.resolve('kokoro-js')), '..', 'voices', 'af_heart.bin'
  ));
  assert(voice.length > 0 && voice.length % Float32Array.BYTES_PER_ELEMENT === 0, 'Kokoro voice data is missing or invalid');

  // A self-contained 92-byte ONNX float Identity graph exercises the native
  // runtime, including its dynamic libraries, without fetching a speech model.
  const model = Buffer.from(
    'CAgSF01EIER1Y2sgcGFja2FnaW5nIHNtb2tlOjsKEAoBeBIBeSIISWRlbnRpdHkSBXNtb2tlWg8KAXgSCgoICAESBAoCCAFiDwoBeRIKCggIARIECgIIAUICEA0=',
    'base64'
  );
  const session = await ort.InferenceSession.create(model, { executionProviders: ['cpu'] });
  let identityOutput;
  try {
    const result = await session.run({
      x: new ort.Tensor('float32', Float32Array.of(3), [1])
    });
    identityOutput = result.y.data[0];
    assert.equal(identityOutput, 3, 'ONNX CPU inference returned the wrong result');
  } finally {
    await session.release();
  }
  assert.equal(blockedRequests, 0, 'A dependency attempted a network request');

  process.stdout.write(JSON.stringify({
    status: 'passed',
    appRoot,
    runtime: { electron: process.versions.electron ?? null, node: process.versions.node, platform: process.platform, arch: process.arch },
    dependencies,
    onnx: ort.env.versions,
    identityOutput,
    sharp: sharp.versions.sharp,
    vips: sharp.versions.vips,
    pngBytes: png.length,
    phonemes,
    voiceBytes: voice.length,
    remoteModelsAllowed: env.allowRemoteModels,
    networkRequests: blockedRequests,
    scope: 'Native dependencies and packaged resources; not full speech synthesis or worker IPC.'
  }, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
