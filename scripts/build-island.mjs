#!/usr/bin/env node
/**
 * build-island.mjs — bundle the Opal chat React island into public/opal-chat.js.
 * Single self-contained IIFE (React + Agents SDK + @cloudflare/ai-chat inlined),
 * mounted by the storefront into #opal-chat-root. Run: npm run build:island
 */
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['island/opal-chat.tsx'],
  bundle: true,
  outfile: 'public/opal-chat.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

console.log('✓ built public/opal-chat.js');
