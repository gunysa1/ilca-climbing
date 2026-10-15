import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewerApp } from './ViewerApp';
import '../../styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><ViewerApp /></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
