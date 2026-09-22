import { ArrowRight, AudioLines, FileMusic, FileUp, Library, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../../shared/i18n';
import { log, serializeError } from '../../../shared/lib/logger';
import { readAudioMetadata, supportedAudioAccept, supportsAudioMetadata } from '../lib/audioMetadata';
import { importAudio } from '../lib/audioImport';
import { importLibrarySong, type NavidromeSong } from '../lib/libraryImport';
import { parseMidiFile, type ImportedMidi } from '../model/parseMidiFile';
import { LibraryImportForm } from './LibraryImportForm';

export function MidiImportButton({ onImport, onProcessed }: { onImport: (midi: ImportedMidi) => void; onProcessed?: (item: unknown, modalOpen: boolean) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioFormOpen, setAudioFormOpen] = useState(false);
  const [libraryFormOpen, setLibraryFormOpen] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [songTitle, setSongTitle] = useState('');
  const [albumTitle, setAlbumTitle] = useState('');
  const openRef = useRef(false);
  const midiInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const closeModal = () => {
    openRef.current = false;
    setOpen(false);
    setAudioFormOpen(false);
    setLibraryFormOpen(false);
    setAudioFile(null);
    setSongTitle('');
    setAlbumTitle('');
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const chooseMidi = (file: File) => void parseMidiFile(file).then(result => result && onImport(result));
  const selectAudio = async (file: File) => {
    if (!supportsAudioMetadata(file)) {
      setAudioFile(null);
      setSongTitle('');
      setAlbumTitle('');
      setError(t('import.unsupportedAudio'));
      return;
    }
    try {
      const tags = await readAudioMetadata(file);
      setError(null);
      setAudioFile(file);
      setSongTitle(tags.title);
      setAlbumTitle(tags.album);
    } catch (error) {
      log('warn', 'AudioImport', '读取音频元数据失败', serializeError(error));
      setAudioFile(null);
      setSongTitle('');
      setAlbumTitle('');
      setError(t('import.unsupportedAudio'));
    }
  };
  const showProcessingError = (processError: unknown) => {
    log('error', 'AudioImport', '音频导入失败', serializeError(processError));
    const errorCode = (processError as Error & { code?: string }).code;
    setError(t(errorCode === 'AUDIO_METADATA_WRITE_FAILED' ? 'import.metadataWriteFailed'
      : errorCode === 'AUDIO_METADATA_REQUIRED' ? 'import.metadataRequired'
      : errorCode === 'AUDIO_FORMAT_UNSUPPORTED' ? 'import.unsupportedAudio'
      : errorCode === 'LIBRARY_DOWNLOAD_FAILED' ? 'import.libraryDownloadError'
      : errorCode === 'AUDIO_PROCESSING_TIMEOUT' ? 'import.timeout' : 'import.error'));
    openRef.current = true;
    setOpen(true);
  };
  const chooseLibrarySong = async (song: NavidromeSong) => {
    setProcessing(true); setError(null);
    try {
      const item = await importLibrarySong(song);
      onProcessed?.(item, openRef.current);
    } catch (processError) {
      showProcessingError(processError);
    } finally { setProcessing(false); }
  };
  const chooseAudio = async () => {
    const title = songTitle.trim();
    const album = albumTitle.trim();
    if (!audioFile || !title || !album) {
      setError(t('import.metadataRequired'));
      return;
    }
    setProcessing(true); setError(null);
    try {
      const item = await importAudio(audioFile, title, album);
      onProcessed?.(item, openRef.current);
    } catch (processError) {
      showProcessingError(processError);
    } finally { setProcessing(false); }
  };

  return <>
    <button className="upload" type="button" onClick={() => { openRef.current = true; setOpen(true); }}><FileUp size={16} /> {t('import.label')}</button>
    {open && createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeModal(); }}><div className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="import-modal-header">
        <span className="import-modal-mark"><FileUp size={18} /></span>
        <div><span className="import-modal-kicker">MUVISUAL</span><h2 id="import-title">{t('import.title')}</h2></div>
        <button className="modal-close" type="button" onClick={closeModal} aria-label={t('import.close')} title={t('import.close')}><X size={18} /></button>
      </div>
      {processing ? <div className="processing-state"><span className="processing-spinner"><LoaderCircle className="spin" size={30} /></span><strong>{t('import.processing')}</strong><span>{t('import.processingHint')}</span></div> : audioFormOpen ? <form className="audio-upload-form" onSubmit={event => { event.preventDefault(); void chooseAudio(); }}>
        <button className="audio-add-area" type="button" onClick={() => audioInputRef.current?.click()}>
          <span className="audio-add-icon"><AudioLines size={25} /></span>
          <strong>{audioFile ? audioFile.name : t('import.addAudio')}</strong>
          <small>{audioFile ? t('import.replaceAudio') : t('import.addAudioHint')}</small>
        </button>
        <label className="audio-metadata-field">
          <span>{t('import.songTitle')}</span>
          <input value={songTitle} onChange={event => { setSongTitle(event.target.value); setError(null); }} placeholder={t('import.songTitlePlaceholder')} required />
        </label>
        <label className="audio-metadata-field">
          <span>{t('import.albumTitle')}</span>
          <input value={albumTitle} onChange={event => { setAlbumTitle(event.target.value); setError(null); }} placeholder={t('import.albumTitlePlaceholder')} required />
        </label>
        <button className="audio-upload-submit" type="submit" disabled={!audioFile}><FileUp size={16} /> {t('import.submitAudio')}</button>
        <input ref={audioInputRef} className="import-file-input" type="file" accept={supportedAudioAccept} onChange={event => { const file = event.target.files?.[0]; if (file) void selectAudio(file); event.currentTarget.value = ''; }} />
      </form> : libraryFormOpen ? <LibraryImportForm onConfirm={song => { void chooseLibrarySong(song); }} /> : <div className="import-options">
        <button className="import-option import-option-midi" type="button" onClick={() => midiInputRef.current?.click()}>
          <span className="import-option-icon"><FileMusic size={23} /></span><span className="import-option-copy"><strong>{t('import.midi')}</strong><small>{t('import.midiHint')}</small></span><ArrowRight className="import-option-arrow" size={18} />
        </button>
        <button className="import-option import-option-audio" type="button" onClick={() => { setAudioFormOpen(true); setError(null); }}>
          <span className="import-option-icon"><AudioLines size={23} /></span><span className="import-option-copy"><strong>{t('import.audio')}</strong><small>{t('import.audioHint')}</small></span><ArrowRight className="import-option-arrow" size={18} />
        </button>
        <button className="import-option import-option-library" type="button" onClick={() => { setLibraryFormOpen(true); setError(null); }}>
          <span className="import-option-icon"><Library size={23} /></span><span className="import-option-copy"><strong>{t('import.library')}</strong><small>{t('import.libraryHint')}</small></span><ArrowRight className="import-option-arrow" size={18} />
        </button>
        <input ref={midiInputRef} className="import-file-input" type="file" accept=".mid,.midi" onChange={event => { const file = event.target.files?.[0]; if (file) chooseMidi(file); event.currentTarget.value = ''; }} />
      </div>}
      {error && <p className="import-error">{error}</p>}
    </div></div>, document.body)}
  </>;
}
