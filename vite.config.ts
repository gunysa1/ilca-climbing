import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Two apps from one codebase: `--mode viewer` (default; public, view-only, no login) and
// `--mode staff` (judges, coaches, admins; login required). Each has its own page shell, manifest
// and service worker under apps/<app>/ and builds to dist/<app>/. Paths below are relative to the
// app root (apps/<app>); commands run from the repo root.
export default defineConfig(({ mode }) => {
  const app = mode === 'staff' ? 'staff' : 'viewer';
  return {
    root: `apps/${app}`,
    envDir: '../..',
    plugins: [react()],
    server: { port: app === 'staff' ? 5174 : 5173, fs: { allow: ['../..'] } },
    preview: { port: app === 'staff' ? 4174 : 4173 },
    build: { outDir: '../../dist/' + app, emptyOutDir: true },
  };
});
