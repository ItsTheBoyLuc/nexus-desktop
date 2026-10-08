// Generates build/icon.ico (multi-size 16-256) and build/icon.png from build/icon.svg.
// Run with: npm run icon        (the generated files are committed, so this is only
// needed when build/icon.svg changes).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const renderPng = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
const pngs = SIZES.map((size) => ({ size, data: renderPng(size) }))

// ICO container: ICONDIR + one ICONDIRENTRY per image + the PNG payloads (PNG-in-ICO,
// supported by Windows Vista and later, which is also what electron-builder/rcedit expect).
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(pngs.length, 4)

let offset = 6 + 16 * pngs.length
const entries = pngs.map(({ size, data }) => {
  const entry = Buffer.alloc(16)
  entry.writeUInt8(size === 256 ? 0 : size, 0) // width  (0 means 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1) // height (0 means 256)
  entry.writeUInt8(0, 2) // palette colours
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(data.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += data.length
  return entry
})

mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]))
writeFileSync(join(root, 'build', 'icon.png'), pngs[pngs.length - 1].data)
console.info(`Wrote build/icon.ico (${SIZES.join(', ')}) and build/icon.png`)
