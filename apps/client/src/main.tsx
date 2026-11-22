import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './global.css';
import { applySettings, loadSettings } from './theme/runtime';

// Inject the theme before the first render so nothing flashes unstyled.
applySettings(loadSettings());

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
