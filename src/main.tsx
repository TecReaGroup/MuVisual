import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { preloadPiano } from './features/playback';

void preloadPiano();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
