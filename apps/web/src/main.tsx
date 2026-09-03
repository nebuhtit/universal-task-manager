import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Automerge from '@automerge/automerge/slim';
import automergeWasmUrl from '@automerge/automerge/automerge.wasm?url';
import { registerSW } from 'virtual:pwa-register';
import App, { AppErrorBoundary } from './App.js';
import './styles.css';

if (import.meta.env.PROD) registerSW({ immediate: true });
else void navigator.serviceWorker?.getRegistrations().then((registrations) => registrations.forEach((registration) => void registration.unregister()));

const root = ReactDOM.createRoot(document.getElementById('root')!);

void Automerge.initializeWasm(automergeWasmUrl).then(() => {
  root.render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);
}).catch((reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  root.render(<main className="lock-shell"><section className="lock-card"><h1>Universal could not start</h1><p className="error" role="alert">Automerge initialization failed: {message}</p><button className="primary" onClick={() => window.location.reload()}>Retry</button></section></main>);
});
