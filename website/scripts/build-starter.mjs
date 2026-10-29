import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
const archiveName = process.argv[2] || 'md-duck-starter';
if (!['md-duck-starter', 'md-duck-workflow'].includes(archiveName)) throw new Error('Unknown example archive');
const root = resolve(import.meta.dirname, '../public/examples', archiveName);
const output = resolve(root, `../${archiveName}.zip`);
const paths = [];
async function walk(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Starter archive must not contain symlinks');
    if (entry.isDirectory()) await walk(path); else paths.push(path);
  }
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
await walk(root);
const locals = [], central = []; let offset = 0;
for (const path of paths) {
  const name = Buffer.from(archiveName + '/' + relative(root, path).split(sep).join('/'));
  const data = await readFile(path); const checksum = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(0x5c21, 12); // Fixed DOS date, 2026-01-01; reproducible archive.
  header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
  locals.push(header, name, data);
  const index = Buffer.alloc(46);
  index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8); index.writeUInt16LE(0x5c21, 14);
  index.writeUInt32LE(checksum, 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(name.length, 28); index.writeUInt32LE(offset, 42);
  central.push(index, name); offset += header.length + name.length + data.length;
}
const directory = Buffer.concat(central); const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
await writeFile(output, Buffer.concat([...locals, directory, end]));
console.log(`Prepared ${archiveName}: ${paths.length} files.`);
