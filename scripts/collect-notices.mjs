#!/usr/bin/env node
/** Offline, allowlisted collection of the installed production dependency notices. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'build', 'third-party')
const sourceDirectory = join(root, 'scripts', 'notices-sources')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const slash = (path) => path.split(sep).join('/')
const readJSON = async (path) => JSON.parse(await fs.readFile(path, 'utf8'))
const licenseName = /^(?:licen[cs]es?|copying|notices?|copyright|third[-_ ]party(?:[-_ ]notices?)?)(?:$|[._ -])/i
const strict = process.argv.includes('--strict')
const releaseStrict = process.argv.includes('--release-strict')
const lock = await readJSON(join(root, 'package-lock.json'))
const app = await readJSON(join(root, 'package.json'))
if (!lock.packages || lock.lockfileVersion < 2) throw new Error('A package-lock v2 or newer is required')
const supplements = await readJSON(join(sourceDirectory, 'manifest.json')).catch((error) => {
  if (error.code === 'ENOENT') return []
  throw error
})

function publicURL(value, allowedQuery = []) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.replace(/^git\+/, '').replace(/\.git$/, ''))
    if (!['https:', 'http:'].includes(url.protocol)) return null
    const query = [...url.searchParams].filter(([key]) => allowedQuery.includes(key))
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''
    for (const [key, value] of query) url.searchParams.append(key, value)
    return url.href
  } catch { return null }
}
function inDirectory(parent, path) {
  const rel = relative(parent, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep)
}
async function assertLocalFile(parent, file) {
  if (!inDirectory(parent, file)) throw new Error('Notice path escapes its allowlisted source directory')
  if (!(await fs.lstat(file)).isFile()) throw new Error('Notice source must be a regular file')
  if (!inDirectory(await fs.realpath(parent), await fs.realpath(file))) throw new Error('Notice source resolves outside its allowlisted directory')
}
async function collectFiles(directory, path = directory) {
  const files = []
  for (const entry of (await fs.readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.isSymbolicLink()) continue
    const child = join(path, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(directory, child))
    else if (entry.isFile() && licenseName.test(entry.name)) files.push(child)
  }
  return files
}
async function copyNotice(source, destination, allowedRoot, extra = {}) {
  await assertLocalFile(allowedRoot, source)
  const content = await fs.readFile(source)
  if (content.includes(0)) throw new Error('A notice source unexpectedly contains binary data')
  await fs.mkdir(dirname(destination), { recursive: true })
  await fs.writeFile(destination, content)
  return { file: slash(relative(output, destination)), bytes: content.length, sha256: digest(content), ...extra }
}

// This generated directory contains no app state. Refuse a redirected output path.
await fs.mkdir(join(root, 'build'), { recursive: true })
if (!(await fs.lstat(join(root, 'build'))).isDirectory()) throw new Error('build must be a real directory')
const oldOutput = await fs.lstat(output).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
if (oldOutput?.isSymbolicLink()) throw new Error('third-party output must not be a symlink')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output)

const packages = []
const skipped = []
for (const [location, locked] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!location || locked.dev || locked.link) continue
  if (!location.startsWith('node_modules/') || location.split('/').some((part) => part === '..')) throw new Error('Unexpected production lock path')
  const directory = join(root, location)
  let installed
  try { await assertLocalFile(directory, join(directory, 'package.json')); installed = await readJSON(join(directory, 'package.json')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (!locked.optional) throw new Error(`Required production package is not installed: ${location}`)
    skipped.push({ location, version: locked.version, license: locked.license ?? null, reason: 'Optional package is not installed for this build host', os: locked.os ?? null, cpu: locked.cpu ?? null })
    continue
  }
  if (installed.version !== locked.version) throw new Error(`Installed version differs from lock: ${location}`)
  const id = `${installed.name}@${installed.version}`
  const folder = `${installed.name.replace(/[^a-zA-Z0-9._-]/g, '_')}@${installed.version}-${digest(location).slice(0, 8)}`
  const licenses = []
  for (const file of await collectFiles(directory)) {
    licenses.push(await copyNotice(file, join(output, 'packages', folder, 'installed', relative(directory, file)), directory,
      { origin: 'installed-package', originalFile: slash(relative(directory, file)) }))
  }
  for (const entry of supplements.filter((entry) => entry.appliesTo?.includes(id))) {
    const source = join(sourceDirectory, entry.file)
    const bytes = await fs.readFile(source)
    if (digest(bytes) !== entry.sha256) throw new Error(`Supplement hash mismatch: ${entry.file}`)
    if (entry.verifyPublishedPackageFiles) {
      const provenance = JSON.parse(bytes.toString('utf8'))
      if (provenance.name !== installed.name || provenance.version !== installed.version || provenance.archive.integrity !== locked.integrity) {
        throw new Error(`Published-package evidence differs from lock: ${id}`)
      }
      for (const file of provenance.installedFiles) {
        const installedFile = join(directory, file.file)
        await assertLocalFile(directory, installedFile)
        if (digest(await fs.readFile(installedFile)) !== file.sha256) throw new Error(`Installed file differs from published-package evidence: ${id}/${file.file}`)
      }
    }
    licenses.push(await copyNotice(source, join(output, 'packages', folder, 'upstream', entry.file), sourceDirectory,
      { origin: 'upstream-supplement', source: publicURL(entry.source, ['format']), kind: entry.kind,
        component: entry.component ?? null, componentVersion: entry.componentVersion ?? null,
        contentTransform: entry.contentTransform ?? null, comment: entry.comment ?? null }))
  }
  const hasLicenseText = licenses.some((file) => file.origin === 'installed-package' && /^(?:licen[cs]es?|copying)(?:$|[._ -])/i.test(file.originalFile.split('/').at(-1)) || file.kind === 'license')
  packages.push({ name: installed.name, version: installed.version, license: installed.license ?? locked.license ?? 'UNKNOWN',
    location, optional: !!locked.optional, repository: publicURL(typeof installed.repository === 'object' ? installed.repository.url : installed.repository),
    homepage: publicURL(installed.homepage), resolved: publicURL(locked.resolved), integrity: locked.integrity ?? null,
    licenseTextStatus: hasLicenseText ? 'collected' : 'MISSING_FULL_LICENSE_TEXT', files: licenses })
}

const references = []
for (const entry of supplements.filter((entry) => entry.referenceOnly && !entry.retired)) {
  const source = join(sourceDirectory, entry.file)
  const bytes = await fs.readFile(source)
  if (digest(bytes) !== entry.sha256) throw new Error(`Supplement hash mismatch: ${entry.file}`)
  references.push(await copyNotice(source, join(output, 'references', entry.file), sourceDirectory,
    { source: publicURL(entry.source), comment: entry.comment ?? null }))
}
const ipaSource = join(root, 'src', 'main', 'data', 'ipa-dict')
const ipa = []
for (const name of ['SOURCE.md', 'LICENSE', 'LICENSE-UK-GPL-3.0', 'UPSTREAM-README.md']) {
  ipa.push(await copyNotice(join(ipaSource, name), join(output, 'data', 'ipa-dict', name), ipaSource, { origin: 'bundled-pronunciation-data' }))
}
const ipaData = []
for (const name of ['en_US.txt', 'en_UK.txt']) {
  await assertLocalFile(ipaSource, join(ipaSource, name))
  const data = await fs.readFile(join(ipaSource, name))
  ipaData.push({ name, bytes: data.length, sha256: digest(data), packagedSeparately: true })
}
let neural = null
if (app.name === 'md-duck') {
  const engineRoot = join(root, 'src/main/kokoro-runtime-phonemizer')
  const voiceRoot = join(root, 'src/main/data/kokoro-voices')
  for (const directory of [engineRoot, voiceRoot]) if (!(await fs.lstat(directory)).isDirectory()) throw new Error('Neural source must be an allowlisted real directory')
  const engine = await readJSON(join(engineRoot, 'SOURCE.json'))
  const styles = await readJSON(join(voiceRoot, 'SOURCE.json'))
  if (engine.sourceCommit !== '4f6d246c1d3acf67a4d814e20da02fa3967bc92d' || !engine.emscripten.container.includes('@sha256:') || styles.files.length !== 5) throw new Error('Neural source identity is incomplete')
  for (const [directory, entries] of [[engineRoot, engine.outputs], [voiceRoot, [...styles.files, ...styles.notices]]]) {
    for (const file of entries) {
      const path = join(directory, file.file)
      await assertLocalFile(directory, path)
      const bytes = await fs.readFile(path)
      if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`Bundled neural resource identity differs: ${file.file}`)
    }
  }
  const notices = []
  for (const name of ['SOURCE.json', 'SOURCE.md', ...engine.outputs.filter(({ file }) => file.startsWith('COPYING')).map(({ file }) => file)]) {
    notices.push(await copyNotice(join(engineRoot, name), join(output, 'data/phonemizer', name), engineRoot, { origin: 'source-pinned-phoneme-engine' }))
  }
  for (const name of ['SOURCE.json', 'SOURCE.md', 'LICENSE']) notices.push(await copyNotice(join(voiceRoot, name), join(output, 'data/kokoro', name), voiceRoot, { origin: 'kokoro-model-voice-normalization-tokenizer-notices' }))
  neural = { engine, styles, notices,
    sourceDelivery: { file: `MD-Duck-${app.version}-Corresponding-Source.tar.gz`, requirement: 'Publish the complete MD Duck source and exact third-party source inputs alongside every public binary; do not substitute upstream homepage links for delivered corresponding source.' } }
  const retired = ['sharp', '@img/sharp', 'phonemizer', 'kokoro-js', '@huggingface/transformers', 'onnxruntime-web', 'guid-typescript']
  if (packages.some(({ name }) => retired.some((item) => name === item || item === '@img/sharp' && name.startsWith(item)))) throw new Error('Retired speech/image dependency is still installed for production')
}
const native = []
const releaseAuditPath = join(sourceDirectory, 'release-audit.json')
await assertLocalFile(sourceDirectory, releaseAuditPath)
const releaseAudit = await readJSON(releaseAuditPath)
if (releaseAudit.formatVersion !== 1 || !Array.isArray(releaseAudit.remainingItems)) throw new Error('Invalid release audit format')
// Windows sharp embeds libvips DLLs in the sharp package itself; other hosts
// use a separate @img/sharp-libvips-* optional package.
for (const pkg of packages.filter((pkg) => pkg.name.startsWith('@img/sharp-libvips-') || pkg.name.startsWith('@img/sharp-win32-'))) {
  const directory = join(root, pkg.location)
  const versions = await readJSON(join(directory, 'versions.json'))
  const files = []
  for (const name of ['README.md', 'versions.json']) files.push(await copyNotice(join(directory, name), join(output, 'native', pkg.name.replaceAll('/', '_'), name), directory))
  const evidence = releaseAudit.nativePackages.find((item) => item.name === pkg.name && item.version === pkg.version)
  if (!evidence || JSON.stringify(Object.entries(versions).sort()) !== JSON.stringify(evidence.components.map(({ name, version }) => [name, version]).sort())) {
    throw new Error(`Native release evidence does not match installed component versions: ${pkg.name}@${pkg.version}`)
  }
  const components = evidence.components.map((component) => {
    const notices = pkg.files.filter((file) => file.component === component.name)
    if (!notices.some((file) => file.kind === 'license')) throw new Error(`No component license text collected: ${component.name}`)
    return { ...component, notices }
  })
  const inventory = { ...evidence, components }
  const inventoryDestination = join(output, 'native', pkg.name.replaceAll('/', '_'), 'COMPONENTS.json')
  await fs.writeFile(inventoryDestination, JSON.stringify(inventory, null, 2) + '\n')
  files.push({ file: slash(relative(output, inventoryDestination)), bytes: (await fs.stat(inventoryDestination)).size,
    sha256: digest(await fs.readFile(inventoryDestination)) })
  native.push({ name: pkg.name, version: pkg.version, components: versions, files, sourceEvidence: inventory,
    caveat: `All ${components.length} installed component versions have collected upstream license texts and versioned source URLs. Platform-specific per-file/transitive notices, source archives and exact reproducible build/source-delivery closure remain pending; see COMPONENTS.json.` })
}
for (const name of ['phonemizer', 'kokoro-js']) {
  const pkg = packages.find((item) => item.name === name)
  if (pkg) references.push(await copyNotice(join(root, pkg.location, 'README.md'), join(output, 'references', `${name}-README.md`), join(root, pkg.location), { origin: 'installed-package-readme' }))
}
const missing = packages.filter((pkg) => pkg.licenseTextStatus !== 'collected').map(({ name, version, location, license, repository }) => ({ name, version, location, license, repository }))
const manifest = {
  formatVersion: 2, application: { name: app.name, version: app.version }, scope: 'Installed production package-lock entries and vendored neural engine/model/voice provenance on this build host; Electron runtime and pronunciation tables are packaged separately.',
  platform: process.platform, architecture: process.arch, packageLockSha256: digest(await fs.readFile(join(root, 'package-lock.json'))),
  packageCount: packages.length, uniquePackageVersions: new Set(packages.map((pkg) => `${pkg.name}@${pkg.version}`)).size,
  optionalNotInstalledCount: skipped.length, missingFullLicenseText: missing, packages, optionalNotInstalled: skipped,
  bundledPronunciationData: { notices: ipa, files: ipaData }, bundledNeuralSpeech: neural, nativeComponents: native, references,
  releaseAudit: { checkedAt: releaseAudit.checkedAt, remainingItems: releaseAudit.remainingItems, closedItems: releaseAudit.closedItems ?? [], correspondingSource: releaseAudit.correspondingSource ?? null },
  excluded: ['User settings and credentials', 'User articles, annotations, and drafts', 'User model/audio caches', 'Development-only dependencies', 'Electron runtime notices, retained by the application packager'],
  reviewStatus: 'Verified notice inventory and fixed-source build inputs; public release separately requires passing packaged checks and publishing the matching corresponding-source archive beside the binaries.'
}
await fs.writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const missingLines = missing.length ? missing.map((pkg) => `- ${pkg.name}@${pkg.version}: package metadata declares ${pkg.license}; full license/copyright text was not found in the installed package or verified supplements. Source: ${pkg.repository ?? 'not supplied'}.`) : ['- No installed npm package is missing a collected license text.']
const lines = [
  '# MD Duck — Third-party notices / 第三方声明', '',
  `Application build: ${app.version}. Target: ${process.platform}/${process.arch}.`, '',
  'This collection preserves the complete text of the license and notice files found in the installed production dependency tree, with separately sourced upstream supplements recorded by URL and SHA-256 in manifest.json. Original texts have not been translated or rewritten.', '',
  '本目录保留第三方原始版权与许可文本。MD Duck 自有代码采用根目录声明的 GPL-3.0-or-later；公开二进制必须同时提供匹配的完整源码包，并通过最终安装包验证。', '',
  `Installed production lock entries: **${packages.length}** (${manifest.uniquePackageVersions} unique name/version pairs). Optional packages absent on this build host: **${skipped.length}**.`, '',
  '## Scope and provenance', '',
  '- Only package-lock production entries installed for this build host are collected. Development tools are excluded; packages used by both development and production are retained.',
  '- Complete package texts are in packages/. Their byte hashes, source URLs, paths, declared SPDX expressions, and lock integrity values are in manifest.json. Metadata license names are preserved as declarations, not a compatibility conclusion.',
  '- Electron is supplied by the packager. Its runtime LICENSE and LICENSES.chromium.html must stay with the Electron distribution. They are intentionally not duplicated here.',
  '- User settings, API keys, reading folders, note backups, speech/model caches, and environment variables are never read by this generator.', '',
  '## Pronunciation tables / 内置音标数据', '',
  '- The ipa-dict source note, upstream README, MIT text, and UK GPL-3.0 text are preserved under data/ipa-dict/. US data is described by upstream as MIT; UK data retains its separate GPL terms and is not labelled MIT.',
  '- The unmodified en_US.txt and en_UK.txt files are copied separately by the app packager. manifest.json records their SHA-256 values; no runtime cache is used.',
  '- Source and derivation details: see data/ipa-dict/SOURCE.md, pinned upstream commit 43c3570eb3553bdd19fccd2bd0091534889af023.', '',
  '## Speech and native components / 语音及原生组件', '',
  '- Neural speech uses the native ONNX Runtime CPU implementation, the same fixed Kokoro q8 model, and five unmodified voice style arrays. Model revision, URL, exact byte size/SHA-256, tokenizer and normalization provenance, voice hashes, and complete Apache-2.0 text are under data/kokoro/. The model is downloaded only on a requested speech operation; user audio/model caches are excluded from this collection.',
  '- The phoneme engine is freshly built from ephone/eSpeak NG commit 4f6d246c1d3acf67a4d814e20da02fa3967bc92d with the fixed Emscripten 3.1.64 image and verified complete source archives. data/phonemizer/ contains the source manifest, build/replacement instructions, engine GPL text, Unicode text, and exact Emscripten/musl/LLVM library notices. Complete source archives retain all original per-file headers. Two isolated builds reproduced the recorded engine and English-data bytes.',
  '- The corresponding-source download contains the complete MD Duck source, exact ephone and Emscripten source inputs, original Kokoro package material, and the deterministic rebuild recipe. Follow data/phonemizer/SOURCE.md from the extracted source root to rebuild or replace the GPL engine and repackage the application. Maintainer build tools are not user installation requirements.',
  '- ONNX Runtime Node/Common license and broad upstream ThirdPartyNotices supplements are retained at the exact installed release. Electron LICENSE and LICENSES.chromium.html are retained by the packager. Broad upstream notices can include inactive components; their original texts remain intact.',
  '- The unused Transformers image/Web inference paths, sharp/libvips, GUID package, old precompiled phonemizer worker, and kokoro-js runtime dependency are absent from this production tree. Historical audit records remain in references/release-audit.json, without claiming that removed packages acquired missing grants or matching sources.', '',
  '## Remaining review items / 尚待核对', '',
  ...missingLines,
  ...releaseAudit.remainingItems.map((item) => `- **${item.id}**: ${item.summary} Resolution: ${item.resolution.join('; ')}.`),
  ...(releaseAudit.remainingItems.length ? [] : ['- No recorded embedded/source-input review item remains open for this configured build. This does not replace final packaged verification or delivery of the corresponding-source archive.']),
  '- This generator retains the explicit project LICENSE; it never invents or changes a third-party grant.', '',
  '## Installed production packages', '',
  '| Package | Version | Declared license | Texts |', '| --- | --- | --- | --- |',
  ...packages.map((pkg) => `| ${pkg.name} | ${pkg.version} | ${String(pkg.license).replaceAll('|', '\\|')} | ${pkg.licenseTextStatus === 'collected' ? pkg.files.map((file) => `[${file.kind ?? file.origin}](${encodeURI(file.file)})`).join(', ') : '**missing full text**'} |`), '',
  'Regenerate offline with: node scripts/collect-notices.mjs. --strict rejects installed npm packages missing a license text. --release-strict additionally rejects unresolved embedded/source-delivery review items; a successful basic collection is not a public-release clearance.', ''
]
const notice = lines.join('\n')
await fs.writeFile(join(output, 'THIRD_PARTY_NOTICES.md'), notice)
await fs.writeFile(join(root, 'build', 'THIRD_PARTY_NOTICES.md'), ['packages', 'native', 'references', 'data'].reduce((text, folder) => text.replaceAll(`](${folder}/`, `](third-party/${folder}/`), notice))
// The generated files may contain public upstream author contact addresses, never this machine's paths.
for (const file of [join(output, 'manifest.json'), join(output, 'THIRD_PARTY_NOTICES.md')]) {
  if ((await fs.readFile(file, 'utf8')).includes(root)) throw new Error('Generated metadata unexpectedly contains an absolute workspace path')
}
console.log(JSON.stringify({ output: 'build/third-party', packages: packages.length, uniquePackageVersions: manifest.uniquePackageVersions,
  optionalNotInstalled: skipped.length, missingFullLicenseText: missing.map((pkg) => `${pkg.name}@${pkg.version}`),
  remainingReleaseItems: releaseAudit.remainingItems.map((item) => item.id),
  nativeComponents: native.map((pkg) => ({ name: pkg.name, count: Object.keys(pkg.components).length })) }, null, 2))
if ((strict || releaseStrict) && missing.length || releaseStrict && releaseAudit.remainingItems.length) process.exitCode = 1
