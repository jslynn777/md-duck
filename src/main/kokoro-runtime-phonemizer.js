// ephone is rebuilt from the complete pinned GPL eSpeak source tree.
// Preferred source, recipe, compiler/runtime sources and notices are documented
// in kokoro-runtime-phonemizer/SOURCE.json and the corresponding-source archive.
import createEphone, { en_all } from './kokoro-runtime-phonemizer/ephone.js'

let loaded
export async function phonemize(text, language = 'en-us') {
  if (language !== 'en-us' && language !== 'en') throw new Error('speech-language-invalid')
  if (!loaded) loaded = createEphone({ languages: en_all, print: () => {}, printErr: () => {} }).catch((error) => { loaded = undefined; throw error })
  const engine = await loaded
  engine.setVoice(language === 'en-us' ? 'en-US' : 'en')
  // ephone appends a synthetic full stop to the final clause. Kokoro already
  // retains the source punctuation separately, so omit that engine delimiter.
  return engine.textToIpa(text).replace(/\.$/, '').split('\n').filter((part) => part.length > 0)
}
