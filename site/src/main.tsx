import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './site-kit/tokens.css';
import './site-kit/shell.css';
import './styles/global.css';

// The prerendered HTML in #root (README text, for search engines and no-JS readers) is replaced on mount.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
