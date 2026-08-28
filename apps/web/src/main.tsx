import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App, { AppErrorBoundary } from './App.js';
import './styles.css';

if (import.meta.env.PROD) registerSW({ immediate: true });
else void navigator.serviceWorker?.getRegistrations().then((registrations) => registrations.forEach((registration) => void registration.unregister()));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>,
);
