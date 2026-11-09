import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Tests measure time; keep them from competing for the CPU.
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
  },
})
