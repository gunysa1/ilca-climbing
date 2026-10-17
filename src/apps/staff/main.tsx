import './authLink'; // first: before the router reads the URL
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StaffApp } from './StaffApp';
import '../../styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><StaffApp /></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // `v`: this build (the main bundle's hashed file name). A new deploy registers a new worker URL, so
  // the browser installs a worker that caches the new shell completely before it takes over.
  const build = new URL(import.meta.url).pathname.split('/').pop() ?? '';
  window.addEventListener('load', () => { navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(build)}`).catch(() => {}); });
}
