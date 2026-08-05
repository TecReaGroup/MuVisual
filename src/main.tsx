import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { preloadPiano } from './features/playback';
import { I18nProvider } from './shared/i18n';

void preloadPiano();

createRoot(document.getElementById('root')!).render(<StrictMode><I18nProvider><App /></I18nProvider></StrictMode>);
