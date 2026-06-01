/**
 * 生成参考图样本（开发用）
 * 运行: node scripts/generate-ref-images.js
 */
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import zlib from 'zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '../public/config/images')
mkdirSync(outDir, { recursive: true })

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
  }
  return ~c >>> 0
}

function createPNG(width, height, drawFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawFn(x, y, width, height)
      const i = rowStart + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }

  const compressed = zlib.deflateSync(raw)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  function chunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
    return Buffer.concat([len, typeBuf, data, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))])
}

function drawSunflower(x, y, w, h) {
  const cx = w / 2
  const cy = h / 2
  const dx = x - cx
  const dy = y - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  const angle = Math.atan2(dy, dx)

  if (dist < w * 0.15) return [220, 180, 40, 255]
  if (dist < w * 0.42 && Math.abs(Math.sin(angle * 8)) > 0.3) return [255, 210, 50, 255]
  if (dist < w * 0.45) return [240, 190, 45, 255]
  return [180, 200, 160, 255]
}

function drawCrystal(x, y, w, h) {
  const cx = w / 2
  const cy = h / 2
  const dx = (x - cx) / (w * 0.35)
  const dy = (y - cy) / (h * 0.4)
  const inside = Math.abs(dx) + Math.abs(dy * 1.2) < 1
  if (inside) {
    const shade = 40 + Math.floor((1 - Math.abs(dx) - Math.abs(dy * 1.2)) * 80)
    return [shade, shade, shade + 30, 255]
  }
  return [170, 185, 200, 255]
}

writeFileSync(join(outDir, 'sunflower.png'), createPNG(64, 64, drawSunflower))
writeFileSync(join(outDir, 'black_crystal.png'), createPNG(64, 64, drawCrystal))
console.log('Reference images generated in public/config/images/')
