// Typed errors for every documented failure mode. `code` is stable and safe
// to branch on; `message` explains what to do about it.

export class RenderError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RenderError'
    this.code = code
  }
}
