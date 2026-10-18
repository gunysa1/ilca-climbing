import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ViewerApp } from './ViewerApp';
import '../../styles.css';

// No reporting here: the viewer never writes. The boundary only shows a message and a reload button.
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary viewer><ViewerApp /></ErrorBoundary></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
