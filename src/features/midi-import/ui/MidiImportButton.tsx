import { FileUp } from 'lucide-react';
import { parseMidiFile, type ImportedMidi } from '../model/parseMidiFile';

export function MidiImportButton({ onImport }: { onImport: (midi: ImportedMidi) => void }) {
  return <label className="upload">
    <FileUp size={16} /> IMPORT MIDI
    <input
      type="file"
      accept=".mid,.midi"
      onChange={event => {
        const file = event.target.files?.[0];
        if (file) void parseMidiFile(file).then(result => result && onImport(result));
      }}
    />
  </label>;
}
