import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let crcTable
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(width, height, pixelFn) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y)
      const o = rowStart + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function shotIcon(size) {
  const h = (size - 1) / 2
  const corner = size * 0.24
  const cx = size * 0.5
  const cy = size * 0.5
  const R = size * 0.27
  const ringW = size * 0.055
  const fx = size * 0.74
  const fy = size * 0.26
  const fr = size * 0.075
  return png(size, size, (x, y) => {
    const qx = Math.max(Math.abs(x - h) - (h - corner), 0)
    const qy = Math.max(Math.abs(y - h) - (h - corner), 0)
    if (Math.hypot(qx, qy) > corner) return [0, 0, 0, 0]
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
    if (Math.hypot(x - fx, y - fy) < fr) return [250, 204, 21, 255]
    if (Math.abs(d - R) < ringW) return [255, 255, 255, 255]
    if (d < R * 0.42) return [255, 255, 255, 255]
    return [79, 70, 229, 255]
  })
}

function ico(pngBlob, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size
  entry[1] = size >= 256 ? 0 : size
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(pngBlob.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, pngBlob])
}

mkdirSync(join(root, 'build'), { recursive: true })
mkdirSync(join(root, 'resources'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.png'), shotIcon(512))
writeFileSync(join(root, 'resources', 'tray.png'), shotIcon(32))
writeFileSync(join(root, 'build', 'icon.ico'), ico(shotIcon(256), 256))
console.log('icons written: build/icon.png (512), build/icon.ico (256), resources/tray.png (32)')
