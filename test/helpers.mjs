// Shared fixtures + PNG inspection helpers for the headless tests.
// Shape ids are fixed strings: the hand-drawn wobble is seeded by shape id,
// so every fixture renders deterministically.

import { Canvas, loadImage } from 'skia-canvas'
import { Store } from '@quickdrawjs/core'

export const PNG_SIG = '89504e470d0a1a0a'

export function pngMeta(buf) {
  return {
    signature: buf.slice(0, 8).toString('hex'),
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  }
}

export async function readPixels(png) {
  const img = await loadImage(png)
  const c = new Canvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, img.width, img.height)
  return { width: img.width, height: img.height, data }
}

export const px = (pixels, x, y) => {
  const i = (y * pixels.width + x) * 4
  return [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], pixels.data[i + 3]]
}

export const countOpaque = (pixels) => {
  let n = 0
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] > 8) n++
  return n
}

// A store holding one of everything: pen, highlighter, every geo, bent
// arrow, dashed line, text, sticky note. Image shapes are added per-test
// (they need an asset record).
export function kitchenSink() {
  const store = new Store()
  const put = (rec) => store.put(rec)
  put({
    id: 'shape:pen1', typeName: 'shape', type: 'draw', x: 0, y: 0, rot: 0, z: 1,
    props: { pts: [10, 10, 0.5, 80, 40, 0.5, 150, 15, 0.5], size: 'm', color: 'black', done: true },
  })
  put({
    id: 'shape:hl1', typeName: 'shape', type: 'highlight', x: 0, y: 0, rot: 0, z: 0,
    props: { pts: [0, 70, 0.5, 200, 70, 0.5], size: 'm', color: 'yellow' },
  })
  const geos = ['rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'cloud']
  geos.forEach((geo, i) => {
    put({
      id: `shape:geo-${geo}`, typeName: 'shape', type: 'geo',
      x: 220 + (i % 2) * 130, y: 10 + Math.floor(i / 2) * 80, rot: geo === 'diamond' ? 0.4 : 0, z: 2 + i,
      props: {
        geo, w: 110, h: 56, color: 'blue', size: 'm', dash: 'draw',
        fill: i % 2 ? 'solid' : 'pattern', label: geo === 'star' ? 'star!' : undefined,
      },
    })
  })
  put({
    id: 'shape:arrow1', typeName: 'shape', type: 'arrow', x: 20, y: 220, rot: 0, z: 20,
    props: { dx: 160, dy: 60, bend: 12, size: 'l', color: 'red', dash: 'solid' },
  })
  put({
    id: 'shape:line1', typeName: 'shape', type: 'line', x: 20, y: 320, rot: 0, z: 21,
    props: { dx: 200, dy: -40, size: 'm', color: 'green', dash: 'dashed' },
  })
  put({
    id: 'shape:text1', typeName: 'shape', type: 'text', x: 260, y: 300, rot: 0, z: 22,
    props: { text: 'Hello quickdraw', size: 'm', color: 'black', font: 'draw', align: 'middle' },
  })
  put({
    id: 'shape:note1', typeName: 'shape', type: 'note', x: 460, y: 260, rot: -0.08, z: 23,
    props: { text: 'a sticky note with enough words to wrap onto several lines', size: 'm', color: 'yellow', font: 'draw', scale: 1 },
  })
  return store
}

// A tiny opaque PNG data URL (solid center, contrasting border) for image tests.
export async function testImageURL(size = 8, center = '#00c864', border = '#123456') {
  const c = new Canvas(size, size)
  const ctx = c.getContext('2d')
  ctx.fillStyle = border
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = center
  ctx.fillRect(1, 1, size - 2, size - 2)
  return 'data:image/png;base64,' + (await c.toBuffer('png')).toString('base64')
}

export function snapshotWithImage(src, { x = 10, y = 10, w = 40, h = 40, z = 5 } = {}) {
  const store = new Store()
  store.put({ id: 'asset:img1', typeName: 'asset', src, w: 8, h: 8 })
  store.put({
    id: 'shape:image1', typeName: 'shape', type: 'image', x, y, rot: 0, z,
    props: { w, h, assetId: 'asset:img1' },
  })
  return store.getSnapshot()
}
