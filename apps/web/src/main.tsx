import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root.tsx';
import './styles.css';

// El service worker (lectura sin conexión) solo se registra en la versión compilada: en
// desarrollo interferiría con el HMR de Vite.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
