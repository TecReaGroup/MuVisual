import { useState } from 'react';
import type { ImportedMidi } from '../features/midi-import';
import { LibraryPage } from '../pages/library';
import { StudioPage } from '../pages/studio';
import '../styles.css';

export function App() {
  const [activeMidi, setActiveMidi] = useState<ImportedMidi | null>(null);

  return activeMidi
    ? <StudioPage initialMidi={activeMidi} onBack={() => setActiveMidi(null)} />
    : <LibraryPage onOpenMidi={setActiveMidi} />;
}
