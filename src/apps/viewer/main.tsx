import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ViewerApp } from './ViewerApp';
import '../../styles.css';

// No reporting here: the viewer never writes. The boundary only shows a message and a reload button.
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary viewer><ViewerApp /></ErrorBoundary></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // `v`: this build (the main bundle's hashed file name). A new deploy registers a new worker URL, so
  // the browser installs a worker that caches the new shell completely before it takes over.
  const build = new URL(import.meta.url).pathname.split('/').pop() ?? '';
  window.addEventListener('load', () => { navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(build)}`).catch(() => {}); });
}
