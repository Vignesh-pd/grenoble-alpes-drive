import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Relative asset paths keep the build portable across GitHub Pages project
  // sites and local previews.
  base: command === 'build' ? './' : '/',
  build: {
    // Split the engine into its own long-lived vendor chunk so the game code
    // stays small and app updates do not invalidate the Three.js cache.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
}));
