const [platform, architecture] = process.argv.slice(2)
if (!platform || !architecture) throw new Error('Usage: assert-build-host.mjs <platform> <architecture>')
if (process.platform !== platform || process.arch !== architecture) {
  throw new Error(`Build ${platform}/${architecture} on a matching host so optional native dependencies and notices match the package. Use the Windows build workflow for Windows x64.`)
}
