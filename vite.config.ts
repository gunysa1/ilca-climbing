import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Two apps from one codebase: `--mode viewer` (default; public, view-only, no login) and
// `--mode staff` (judges, coaches, admins; login required). Each has its own page shell, manifest
// and service worker under apps/<app>/ and builds to dist/<app>/. Paths below are relative to the
// app root (apps/<app>); commands run from the repo root.
/** The viewer reads and listens only: every import of src/lib/supabase.ts becomes the lighter
 *  src/lib/supabaseViewer.ts (no sign-in or storage code in the public app). */
const viewerSupabase: Plugin = {
  name: 'viewer-supabase',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || !/(^|\/)supabase$/.test(source)) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id.endsWith('/src/lib/supabase.ts') ? decodeURIComponent(new URL('./src/lib/supabaseViewer.ts', import.meta.url).pathname) : null;
  },
};

export default defineConfig(({ mode }) => {
  const app = mode === 'staff' ? 'staff' : 'viewer';
  return {
    root: `apps/${app}`,
    envDir: '../..',
    plugins: app === 'viewer' ? [viewerSupabase, react()] : [react()],
    server: { port: app === 'staff' ? 5174 : 5173, fs: { allow: ['../..'] } },
    preview: { port: app === 'staff' ? 4174 : 4173 },
    build: { outDir: '../../dist/' + app, emptyOutDir: true },
  };
});
