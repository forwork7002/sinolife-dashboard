import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The domain layer is framework-free by design, so it runs in plain Node.
    // Component tests opt into jsdom per-file via a `@vitest-environment` docblock.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
})
