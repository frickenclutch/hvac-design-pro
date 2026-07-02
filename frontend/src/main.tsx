import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Stale-chunk recovery. Every page is lazy-loaded, so a Pages deploy while a
// tab is open invalidates the hashed chunk URLs the running bundle points at —
// the next navigation then throws a dynamic-import error that the
// ErrorBoundary's Retry button can never fix (same dead URL). Vite surfaces
// exactly this as `vite:preloadError`; one hard reload picks up the new
// manifest. The sessionStorage flag stops a reload loop if the failure is
// something else, and is cleared once a session survives a successful load.
window.addEventListener('vite:preloadError', (event) => {
  const RELOADED_FLAG = 'hvac_chunk_reload';
  if (sessionStorage.getItem(RELOADED_FLAG)) return; // already tried — let the ErrorBoundary show
  sessionStorage.setItem(RELOADED_FLAG, '1');
  event.preventDefault();
  window.location.reload();
});
window.setTimeout(() => sessionStorage.removeItem('hvac_chunk_reload'), 30_000);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
