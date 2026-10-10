#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { selectedApplication } = require('./speech-check-common.cjs');

// Exercise the selected application's compiled engine and native library;
// no reader window, profile, speech/model cache, or model download is used.
let blockedRequests = 0;
globalThis.fetch = async () => {
  blockedRequests += 1;
  throw new Error('NETWORK_DISABLED_FOR_PACKAGING_SMOKE');
};
async function main() {
  assert(process.argv[2], 'Usage: verify-speech-runtime.cjs <app.asar or workspace root>');
  const selected = await selectedApplication(process.argv[2]);
  const ort = selected.fromApp('onnxruntime-node');
  const phonemes = [];
  for (const language of ['a', 'b']) {
    const output = await selected.runtime.phonemizeKokoroText('Hello, world.', language);
    assert(typeof output === 'string' && output.length > 5 && output.endsWith('.'), 'Phoneme engine or English data failed');
    phonemes.push({ language: language === 'a' ? 'en-US' : 'en-GB', text: output });
  }
  const model = Buffer.from('CAgSF01EIER1Y2sgcGFja2FnaW5nIHNtb2tlOjsKEAoBeBIBeSIISWRlbnRpdHkSBXNtb2tlWg8KAXgSCgoICAESBAoCCAFiDwoBeRIKCggIARIECgIIAUICEA0=', 'base64');
  const session = await ort.InferenceSession.create(model, { executionProviders: ['cpu'] });
  let identityOutput;
  try {
    const result = await session.run({ x: new ort.Tensor('float32', Float32Array.of(3), [1]) });
    identityOutput = result.y.data[0];
    assert.equal(identityOutput, 3, 'Native ONNX CPU inference failed');
  } finally { await session.release(); }
  assert.equal(blockedRequests, 0, 'A dependency attempted a network request');
  console.log(JSON.stringify({
    status: 'passed', appRoot: selected.appRoot,
    runtime: { electron: process.versions.electron ?? null, node: process.versions.node, platform: process.platform, arch: process.arch },
    dependencies: { onnxruntime: selected.nativePath, kokoroRuntime: selected.runtimePath },
    onnx: ort.env.versions, identityOutput, phonemes, voices: selected.voices,
    networkRequests: blockedRequests,
    scope: 'Actual compiled phoneme engine/US+UK data, five exact voice style arrays, native CPU inference; full neural synthesis and worker IPC are separate checks.'
  }, null, 2));
}
main().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
