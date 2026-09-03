import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/tests/testUtils/setup.ts'],
    globalSetup: ['./src/tests/testUtils/globalSetup.ts'],
    // Integration tests share one Postgres test DB; run test files serially
    // so their table truncation between tests doesn't race across files.
    fileParallelism: false,
    reporters: process.env.CI ? ['verbose', 'junit'] : ['verbose'],
    outputFile: {
      junit: './test-results/junit.xml',
    },
  },
})
