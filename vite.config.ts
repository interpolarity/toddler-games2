import { defineConfig } from 'vite';

// For GitHub Pages project sites the app is served from /<repo>/.
// Override with VITE_BASE=/ when deploying to Vercel/Netlify or a custom domain.
const base = process.env.VITE_BASE ?? '/toddler-games2/';

export default defineConfig({
  base,
  server: {
    host: true,
    port: 5173
  },
  build: {
    target: 'es2020',
    sourcemap: true
  }
});
