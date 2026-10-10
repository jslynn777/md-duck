import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function verifyNeuralPackage(resources, inventory) {
  const speech = inventory.bundledNeuralSpeech
  assert(speech, 'The bundled neural source inventory is required')
  assert.equal(speech.engine.sourceCommit, '4f6d246c1d3acf67a4d814e20da02fa3967bc92d')
  assert.equal(speech.styles.model.revision, '1939ad2a8e416c0acfeecc08a694d14ef25f2231')
  assert.equal(speech.styles.model.sha256, 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478')
  const voiceRoot = join(resources, 'kokoro-voices')
  const expected = [...speech.styles.files, ...speech.styles.notices]
  assert.deepEqual(readdirSync(voiceRoot).sort(), [...expected.map(({ file }) => file), 'SOURCE.json'].sort(), 'Only fixed voice resources and notices may be copied')
  for (const file of expected) {
    const bytes = readFileSync(join(voiceRoot, file.file))
    assert.equal(bytes.length, file.bytes, `Packaged voice resource size differs: ${file.file}`)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Packaged voice resource hash differs: ${file.file}`)
  }
  assert.deepEqual(JSON.parse(readFileSync(join(voiceRoot, 'SOURCE.json'), 'utf8')), speech.styles)
  for (const file of speech.notices) {
    const bytes = readFileSync(join(resources, 'third-party', file.file))
    assert.equal(bytes.length, file.bytes, `Packaged neural notice size differs: ${file.file}`)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Packaged neural notice hash differs: ${file.file}`)
  }
  return { exactVoices: speech.styles.files.length, sourceCommit: speech.engine.sourceCommit, runtimeNotices: speech.notices.length }
}
