import { FileUp } from 'lucide-react';
import { useI18n } from '../../../shared/i18n';
import { parseMidiFile, type ImportedMidi } from '../model/parseMidiFile';

export function MidiImportButton({ onImport }: { onImport: (midi: ImportedMidi) => void }) {
  const { t } = useI18n();

  return <label className="upload">
    <FileUp size={16} /> {t('import.label')}
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
