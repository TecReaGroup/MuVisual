import { useEffect, useState } from 'react';
import type { ImportedMidi } from '../features/midi-import';
import { preloadPiano } from '../features/playback';
import { LibraryPage } from '../pages/library';
import { StudioPage } from '../pages/studio';
import '../styles.css';

export function App() {
  const [activeMidi, setActiveMidi] = useState<ImportedMidi | null>(null);

  useEffect(() => {
    void preloadPiano();
  }, []);

  return activeMidi
    ? <StudioPage initialMidi={activeMidi} onBack={() => setActiveMidi(null)} />
    : <LibraryPage onOpenMidi={setActiveMidi} onHome={() => setActiveMidi(null)} />;
}
