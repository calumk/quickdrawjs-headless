import type { Store } from '@quickdrawjs/core'

export type HeadlessTheme = 'light' | 'dark'

export interface HeadlessViewport {
  x: number
  y: number
  w: number
  h: number
}

export interface RenderOptions {
  /** Output width in pixels, 1..8192. Default 1920. */
  width?: number
  /** Output height in pixels, 1..8192. Default 1080. */
  height?: number
  /** Board theme. Default 'light'. */
  theme?: HeadlessTheme
  /**
   * 'transparent' (default), 'theme' for the paper color, or any CSS color.
   */
  background?: string
  /**
   * 'content' (default) fits every shape; 'viewport' fits `viewport` exactly.
   */
  fit?: 'content' | 'viewport'
  /** Page-space rect to render. Required with fit 'viewport'. */
  viewport?: HeadlessViewport
  /** Output-pixel margin around the fitted rect. Default 40. */
  padding?: number
}

/** Snapshot envelope produced by `store.getSnapshot()`. */
export interface Snapshot {
  document: { store: Record<string, any> }
}

export declare const DEFAULTS: Required<Omit<RenderOptions, 'viewport'>> & { viewport: null }
export declare const LIMITS: {
  maxDimension: number
  maxPixels: number
  maxRecords: number
  visualMargin: number
  maxFitScale: number
}

/**
 * Render a Quickdraw snapshot to a PNG buffer. Node.js only — no browser.
 * Resolves after every asset is decoded and drawing is complete.
 */
export declare function renderPng(snapshot: Snapshot, options?: RenderOptions): Promise<Buffer>

export declare class RenderError extends Error {
  code: string
  constructor(code: string, message: string)
}

export declare function registerFonts(): boolean
export declare function fontsReady(): boolean
export declare function fontFiles(): string[]
export declare function installPlatform(): void
export declare function platformInfo(): {
  installed: boolean
  hasFontLibrary: boolean
  families: unknown
}
