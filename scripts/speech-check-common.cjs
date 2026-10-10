'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { dirname, join, resolve, sep } = require('node:path');

const VOICES = ['af_heart', 'af_bella', 'am_michael', 'bf_emma', 'bm_george'];
async function selectedApplication(value) {
  const appRoot = resolve(value);
  const manifest = join(appRoot, 'package.json');
  await fs.access(manifest);
  const fromApp = createRequire(manifest);
  const nativePath = fromApp.resolve('onnxruntime-node');
  assert(nativePath.startsWith(appRoot + sep) || nativePath.startsWith(appRoot + '.unpacked' + sep), 'Native runtime resolved outside the selected application');
  const runtimePath = join(appRoot, 'out/main/kokoro-runtime.js');
  const runtime = fromApp(runtimePath);
  assert.equal(typeof runtime.KokoroRuntime?.create, 'function', 'Compiled Kokoro runtime is missing');
  assert.equal(typeof runtime.phonemizeKokoroText, 'function', 'Compiled phonemizer is missing');
  const voiceDirectory = appRoot.endsWith('.asar') ? join(dirname(appRoot), 'kokoro-voices') : join(appRoot, 'src/main/data/kokoro-voices');
  const styles = JSON.parse(await fs.readFile(join(voiceDirectory, 'SOURCE.json'), 'utf8'));
  assert.deepEqual(styles.files.map(({ file }) => file.replace(/\.bin$/, '')).sort(), [...VOICES].sort());
  const voices = [];
  for (const expected of styles.files) {
    assert(VOICES.some((id) => expected.file === `${id}.bin`));
    const bytes = await fs.readFile(join(voiceDirectory, expected.file));
    assert.equal(bytes.length, 522240, 'Voice style size differs');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, 'Voice style hash differs');
    voices.push({ voice: expected.file.replace(/\.bin$/, ''), bytes: bytes.length, sha256: expected.sha256 });
  }
  return { appRoot, fromApp, runtime, voiceDirectory, voices, nativePath, runtimePath };
}
module.exports = { selectedApplication, VOICES };
