import { ArrowRight, AudioLines, FileMusic, FileUp, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../../shared/i18n';
import { parseMidiFile, type ImportedMidi } from '../model/parseMidiFile';

export function MidiImportButton({ onImport, onProcessed }: { onImport: (midi: ImportedMidi) => void; onProcessed?: (item: unknown, modalOpen: boolean) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openRef = useRef(false);
  const midiInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const closeModal = () => { openRef.current = false; setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const chooseMidi = (file: File) => void parseMidiFile(file).then(result => result && onImport(result));
  const waitForAudioJob = async (jobId: string) => {
    const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
    while (true) {
      await new Promise(resolve => window.setTimeout(resolve, 3000));
      try {
        const response = await fetch(`/api/process-audio/${encodeURIComponent(jobId)}`);
        if (retryableStatuses.has(response.status)) continue;
        if (!response.ok && response.status !== 202) throw new Error('job request failed');
        const result = await response.json();
        if (result.job?.status === 'failed') {
          const error = new Error(result.job.error || 'audio processing failed');
          if (result.job.errorCode) Object.assign(error, { code: result.job.errorCode });
          throw error;
        }
        if (result.job?.status === 'completed' && result.item) return result.item;
      } catch (error) {
        if (error instanceof TypeError) continue;
        throw error;
      }
    }
  };
  const chooseAudio = async (file: File) => {
    setProcessing(true); setError(null);
    try {
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/process-audio', { method: 'POST', body: form });
      if (!response.ok) throw new Error('upload failed');
      const result = await response.json();
      if (!result.job?.id) throw new Error('job id missing');
      const item = await waitForAudioJob(result.job.id);
      onProcessed?.(item, openRef.current);
    } catch (processError) {
      setError(t((processError as Error & { code?: string }).code === 'AUDIO_PROCESSING_TIMEOUT' ? 'import.timeout' : 'import.error'));
      openRef.current = true;
      setOpen(true);
    } finally { setProcessing(false); }
  };

  return <>
    <button className="upload" type="button" onClick={() => { openRef.current = true; setOpen(true); }}><FileUp size={16} /> {t('import.label')}</button>
    {open && createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeModal(); }}><div className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="import-modal-header">
        <span className="import-modal-mark"><FileUp size={18} /></span>
        <div><span className="import-modal-kicker">MU VISUAL</span><h2 id="import-title">{t('import.title')}</h2></div>
        <button className="modal-close" type="button" onClick={closeModal} aria-label={t('import.close')} title={t('import.close')}><X size={18} /></button>
      </div>
      {processing ? <div className="processing-state"><span className="processing-spinner"><LoaderCircle className="spin" size={30} /></span><strong>{t('import.processing')}</strong><span>{t('import.processingHint')}</span></div> : <div className="import-options">
        <button className="import-option import-option-midi" type="button" onClick={() => midiInputRef.current?.click()}>
          <span className="import-option-icon"><FileMusic size={23} /></span><span className="import-option-copy"><strong>{t('import.midi')}</strong><small>{t('import.midiHint')}</small></span><ArrowRight className="import-option-arrow" size={18} />
        </button>
        <button className="import-option import-option-audio" type="button" onClick={() => audioInputRef.current?.click()}>
          <span className="import-option-icon"><AudioLines size={23} /></span><span className="import-option-copy"><strong>{t('import.audio')}</strong><small>{t('import.audioHint')}</small></span><ArrowRight className="import-option-arrow" size={18} />
        </button>
        <input ref={midiInputRef} className="import-file-input" type="file" accept=".mid,.midi" onChange={event => { const file = event.target.files?.[0]; if (file) chooseMidi(file); event.currentTarget.value = ''; }} />
        <input ref={audioInputRef} className="import-file-input" type="file" accept=".wav,.flac,.mp3,.ogg,.opus,.m4a,.aiff,.ac3,audio/*" onChange={event => { const file = event.target.files?.[0]; if (file) void chooseAudio(file); event.currentTarget.value = ''; }} />
      </div>}
      {error && <p className="import-error">{error}</p>}
    </div></div>, document.body)}
  </>;
}
