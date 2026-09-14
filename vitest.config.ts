import { defineConfig } from 'vitest/config';

// Drawing tests render hundreds of 1080p frames; next to a render on the same machine they
// can take longer than vitest's 5 second default, which is not a failure of what they test.
export default defineConfig({ test: { testTimeout: 60_000 } });
