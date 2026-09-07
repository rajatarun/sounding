import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite writes absolute asset URLs, so a bundle built for the domain root asks
 * for /assets/… and 404s the moment it is served from a subdirectory — the
 * document loads and nothing but unstyled text appears, which looks like a
 * broken deploy rather than a misconfigured one.
 *
 * The deploy sets SOUNDING_BASE_PATH=/sounding/ (see the `sounding` job in
 * aiweave's .github/workflows/deploy.yaml, which is where the credentials for
 * that bucket live). Locally it stays at the root. Same convention that repo
 * already uses for its Storybook and playground builds.
 */
export default defineConfig({
  base: process.env.SOUNDING_BASE_PATH || '/',
  plugins: [react()],
});
