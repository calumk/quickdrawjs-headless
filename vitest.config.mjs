import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // plain Node environment: no jsdom, no canvas stubs. If this package
    // ever needs a browser global, these tests fail — that is the point.
    include: ['test/**/*.test.js'],
  },
})
