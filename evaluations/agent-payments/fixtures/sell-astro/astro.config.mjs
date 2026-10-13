import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server', // SSR: pages are rendered per request unless they opt in with `export const prerender = true`
  adapter: node({ mode: 'standalone' }),
  // Astro 5 only: without allowedDomains, Astro ignores Host / X-Forwarded-Host when it builds request.url.
  ...(process.env.EVAL_ALLOWED_HOST ? { security: { allowedDomains: [{ hostname: process.env.EVAL_ALLOWED_HOST }] } } : {}),
});
