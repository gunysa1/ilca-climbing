import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StaffApp } from './StaffApp';
import '../../styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><StaffApp /></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
