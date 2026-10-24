import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { createAppStore } from './state/appStore.js';
import { StoreProvider } from './state/StoreContext.jsx';
import { createBackendApi } from './api/switchBackend.js';
import './styles.css';
import './experience.css';

const initialPage = (window.location.hash.match(/^#\/([a-z]+)/) || [])[1];
// The canonical SWITCH backend is used whenever it is reachable; ?offline (or VITE_SWITCH_OFFLINE=1) forces the
// browser-only simulator, which is also the labelled fallback when the backend cannot be reached.
const offline = new URLSearchParams(window.location.search).has('offline') || import.meta.env.VITE_SWITCH_OFFLINE === '1';
const store = createAppStore({
  initialPage: ['home', 'why', 'replay', 'requirements', 'reports', 'devices', 'settings'].includes(initialPage) ? initialPage : 'home',
  backend: offline ? null : createBackendApi(),
});
if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')) window.__switch = store; // test/debug hook

createRoot(document.getElementById('root')).render(
  <React.StrictMode><StoreProvider store={store}><App /></StoreProvider></React.StrictMode>
);
