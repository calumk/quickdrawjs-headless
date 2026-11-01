// Embedded image assets: collect, validate and decode every image a render
// needs BEFORE drawing starts, so the returned PNG never contains image
// placeholders for valid assets and never resolves before decoding finishes.
//
// Policy for the initial implementation:
// - Embedded data-URL assets (data:image/...) are supported.
// - Anything else (http/https URLs, missing records, undecodable bytes)
//   throws a RenderError with a clear code — never fetched, never silent.
// - Decoded bitmaps live in a per-render Map: no cross-request cache.

import { loadImage } from 'skia-canvas'

import { RenderError } from './errors.js'

export const MAX_IMAGES = 200
export const MAX_ASSET_BYTES = 48 * 1024 * 1024

const DATA_IMAGE_RE = /^data:(image\/[a-zA-Z0-9.+-]+)(;charset=[^;,]+)?(;base64)?,/

// Every image shape's assetId referenced by the render, deduped.
export function referencedAssets(shapes) {
  const ids = new Set()
  for (const s of shapes) {
    if (s?.type === 'image' && typeof s.props?.assetId === 'string') ids.add(s.props.assetId)
  }
  return [...ids]
}

// Look up an asset record and validate everything short of decoding it:
// presence, embed policy (data URLs only, never fetched) and size caps.
// Returns the record. Throws RenderError. Shared by both decode paths.
export function getUsableAsset(store, id) {
  const asset = store.asset(id)
  if (!asset) {
    throw new RenderError(
      'ASSET_MISSING',
      `Image shape references asset '${id}', which is not in the snapshot. ` +
        `Snapshots must include their asset records under document.store.`,
    )
  }
  const src = asset.src
  if (typeof src !== 'string' || src.length === 0) {
    throw new RenderError('ASSET_MISSING', `Image asset '${asset.id}' has no embedded data.`)
  }
  if (/^https?:\/\//i.test(src) || /^\/\//.test(src)) {
    throw new RenderError(
      'ASSET_EXTERNAL_URL',
      `Image asset '${asset.id}' points at an external URL, which headless rendering does not fetch. ` +
        `Embed the image as a data URL to render it.`,
    )
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) && !src.startsWith('data:')) {
    throw new RenderError(
      'ASSET_EXTERNAL_URL',
      `Image asset '${asset.id}' uses an unsupported URI scheme. Only embedded data-URL images can be rendered.`,
    )
  }
  if (!DATA_IMAGE_RE.test(src)) {
    throw new RenderError(
      'ASSET_INVALID',
      `Image asset '${asset.id}' is not an embedded data-URL image. Only data:image/... assets can be rendered.`,
    )
  }
  if (Math.ceil(src.length * 0.75) > MAX_ASSET_BYTES) {
    throw new RenderError(
      'ASSET_TOO_LARGE',
      `Image asset '${asset.id}' is too large to decode (over ${MAX_ASSET_BYTES} bytes).`,
    )
  }
  return asset
}

// Decode one asset record into a Skia image. Throws RenderError.
async function decodeAsset(asset) {
  try {
    return await loadImage(asset.src)
  } catch (e) {
    throw new RenderError(
      'ASSET_DECODE_FAILED',
      `Image asset '${asset.id}' could not be decoded: ${e?.message ?? e}`,
    )
  }
}

// Decode every referenced asset. Returns Map assetId -> Skia image.
// Missing asset records throw ASSET_MISSING.
export async function loadAssets(store, assetIds) {
  const images = new Map()
  if (assetIds.length > MAX_IMAGES) {
    throw new RenderError(
      'TOO_MANY_IMAGES',
      `Snapshot references ${assetIds.length} images (limit ${MAX_IMAGES}).`,
    )
  }
  await Promise.all(
    assetIds.map(async (id) => {
      images.set(id, await decodeAsset(getUsableAsset(store, id)))
    }),
  )
  return images
}
