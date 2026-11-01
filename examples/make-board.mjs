// Generates examples/board.json: a realistic Quickdraw document covering
// every supported shape kind. Ids are fixed so the hand-drawn wobble and the
// rendered PNG are deterministic.
//
//   node examples/make-board.mjs   # from packages/headless

import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Canvas } from 'skia-canvas'
import { Store } from '@quickdrawjs/core'

const dir = dirname(fileURLToPath(import.meta.url))
const store = new Store()
const put = (rec) => store.put(rec)

// Title.
put({
  id: 'shape:title', typeName: 'shape', type: 'text', x: 60, y: 40, rot: 0, z: 1,
  props: { text: 'Sprint plan', size: 'xl', color: 'black', font: 'draw', align: 'start' },
})

// Hand-drawn checkmark with pen pressure.
put({
  id: 'shape:check', typeName: 'shape', type: 'draw', x: 0, y: 0, rot: 0, z: 2,
  props: {
    pts: [70, 150, 0.4, 110, 200, 0.7, 150, 210, 0.6, 230, 120, 0.35],
    size: 'l', color: 'green', done: true, isPen: true,
  },
})

// Highlighter wash behind the plan items (renders beneath the ink).
put({
  id: 'shape:wash', typeName: 'shape', type: 'highlight', x: 0, y: 0, rot: 0, z: 0,
  props: { pts: [260, 150, 0.5, 700, 150, 0.5, 700, 420, 0.5, 260, 420, 0.5], size: 'l', color: 'yellow' },
})

// Task boxes: pattern, solid and semi fills, one with a label, one rotated.
put({
  id: 'shape:task1', typeName: 'shape', type: 'geo', x: 280, y: 180, rot: -0.02, z: 3,
  props: { geo: 'rectangle', w: 200, h: 90, color: 'blue', size: 'm', dash: 'draw', fill: 'solid', label: 'Ship it' },
})
put({
  id: 'shape:task2', typeName: 'shape', type: 'geo', x: 500, y: 180, rot: 0.03, z: 4,
  props: { geo: 'ellipse', w: 180, h: 90, color: 'violet', size: 'm', dash: 'solid', fill: 'pattern' },
})
put({
  id: 'shape:task3', typeName: 'shape', type: 'geo', x: 280, y: 300, rot: 0, z: 5,
  props: { geo: 'diamond', w: 160, h: 110, color: 'orange', size: 'm', dash: 'dashed', fill: 'semi' },
})
put({
  id: 'shape:star', typeName: 'shape', type: 'geo', x: 540, y: 300, rot: 0.2, z: 6,
  props: { geo: 'star', w: 130, h: 130, color: 'red', size: 'm', dash: 'draw', fill: 'solid', label: 'win' },
})

// Bent arrow between the boxes.
put({
  id: 'shape:flow', typeName: 'shape', type: 'arrow', x: 480, y: 225, rot: 0, z: 7,
  props: { dx: 60, dy: 10, bend: -8, size: 'm', color: 'black', dash: 'solid' },
})

// Sticky note with wrapping text.
put({
  id: 'shape:note', typeName: 'shape', type: 'note', x: 740, y: 170, rot: 0.04, z: 8,
  props: {
    text: 'Remember: demo on Friday. Keep the scope small and the coffee strong.',
    size: 'm', color: 'yellow', font: 'draw', scale: 1,
  },
})

// A small diagram image, embedded as a data URL (as the editor stores it).
const diagram = new Canvas(96, 64)
const dctx = diagram.getContext('2d')
dctx.fillStyle = '#e0f0fe'
dctx.fillRect(0, 0, 96, 64)
dctx.strokeStyle = '#4263eb'
dctx.lineWidth = 4
dctx.strokeRect(8, 8, 80, 48)
dctx.fillStyle = '#4263eb'
dctx.beginPath()
dctx.arc(48, 32, 12, 0, Math.PI * 2)
dctx.fill()
const src = 'data:image/png;base64,' + (await diagram.toBuffer('png')).toString('base64')
store.put({ id: 'asset:diagram', typeName: 'asset', src, w: 96, h: 64 })
put({
  id: 'shape:diagram', typeName: 'shape', type: 'image', x: 740, y: 420, rot: 0, z: 9,
  props: { w: 192, h: 128, assetId: 'asset:diagram' },
})

// A shape at negative coordinates, to exercise content-fit centering.
put({
  id: 'shape:cloud', typeName: 'shape', type: 'geo', x: -260, y: 120, rot: 0, z: 10,
  props: { geo: 'cloud', w: 180, h: 110, color: 'light-blue', size: 'm', dash: 'draw', fill: 'solid' },
})

await writeFile(join(dir, 'board.json'), JSON.stringify(store.getSnapshot(), null, 2) + '\n')
console.log(`wrote board.json (${store.size} records)`)
