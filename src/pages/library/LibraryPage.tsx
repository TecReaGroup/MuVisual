import { ArrowUpRight, AudioLines, FileMusic, LoaderCircle, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Instrument } from '../../entities/music';
import { MidiImportButton, parseMidiFile, type ImportedMidi, type MidiVariant } from '../../features/midi-import';
import { LanguageButton, useI18n, type TranslationKey } from '../../shared/i18n';
import { getBeatAnalysis, getLibrary, type LibraryItem } from './api';

const BAR_COUNT = 30;
const INSTRUMENT_ORDER: Instrument[] = ['piano', 'other', 'vocals', 'bass', 'drums', 'guitar'];

function waveform(id: string) {
  let seed = [...id].reduce((value, character) => value + character.charCodeAt(0), 0);
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    seed = (seed * 9301 + 49297 + index) % 233280;
    return 18 + Math.round((seed / 233280) * 70);
  });
}

function formatSize(bytes: number, mediaReady: string) {
  if (!bytes) return mediaReady;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type LibraryPageProps = {
  onOpenMidi: (midi: ImportedMidi) => void;
  onHome?: () => void;
};

export function LibraryPage({ onOpenMidi, onHome }: LibraryPageProps) {
  const { language, t } = useI18n();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<{ key: TranslationKey; title?: string } | null>(null);

  const goHome = () => {
    setQuery('');
    onHome?.();
  };

  useEffect(() => {
    const controller = new AbortController();
    async function loadLibrary() {
      try {
        const result = await getLibrary(controller.signal);
        setItems(result.items);
      } catch (loadError) {
        if ((loadError as Error).name !== 'AbortError') setError({ key: 'library.connectionError' });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadLibrary();
    return () => controller.abort();
  }, []);

  const filteredItems = useMemo(() => {
    const locale = language === 'zh' ? 'zh-CN' : 'en';
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (!normalized) return items;
    return items.filter(item => `${item.title} ${item.album}`.toLocaleLowerCase(locale).includes(normalized));
  }, [items, language, query]);

  const openTrack = async (item: LibraryItem) => {
    if (openingId) return;
    setOpeningId(item.id);
    setError(null);
    try {
      const loadMidi = async (url: string | null, instrument: Instrument) => {
        if (!url) return null;
        const response = await fetch(url);
        if (!response.ok) return null;
        const file = new File([await response.blob()], `${item.title}_${instrument}.mid`, { type: 'audio/midi' });
        return parseMidiFile(file);
      };
      const [loadedMidi, beatAnalysis] = await Promise.all([
        Promise.all(INSTRUMENT_ORDER.map(async instrument => [
          instrument,
          await loadMidi(item.instruments[instrument]?.midiUrl ?? null, instrument),
        ] as const)),
        getBeatAnalysis(item.beatUrl),
      ]);
      const midiByInstrument = Object.fromEntries(loadedMidi) as Partial<Record<Instrument, MidiVariant | null>>;
      const availableInstruments = INSTRUMENT_ORDER.filter(instrument => item.instruments[instrument]);
      const defaultInstrument = availableInstruments.find(instrument => midiByInstrument[instrument])
        ?? availableInstruments[0];
      if (!defaultInstrument) throw new Error('No instrument media found');
      const selected = midiByInstrument[defaultInstrument] ?? {
        backgroundDelayMs: 0,
        bpm: beatAnalysis?.beats[1] ? Math.round(60 / (beatAnalysis.beats[1] - beatAnalysis.beats[0])) : 120,
        keySignature: 'C:major',
        notes: [],
        tempoMap: [],
      };
      onOpenMidi({
        ...selected,
        audioUrls: { original: item.audioUrl, instrument: item.instruments[defaultInstrument]?.audioUrl ?? null },
        beatAnalysis,
        defaultInstrument,
        instruments: Object.fromEntries(availableInstruments.map(instrument => [instrument, {
          audioUrl: item.instruments[instrument]?.audioUrl ?? null,
          midi: midiByInstrument[instrument] ?? null,
        }])),
        name: item.title,
      });
    } catch {
      setError({ key: 'library.openError', title: item.title });
      setOpeningId(null);
    }
  };

  return <main className="library-app">
    <header className="library-header">
      <button className="library-brand" type="button" aria-label={t('library.home')} onClick={goHome}>
        <span className="brand-symbol"><AudioLines size={18} /></span>
        <span><strong>MuVisual</strong><small>{t('library.tagline')}</small></span>
      </button>

      <div className="library-search" role="search">
        <Search size={18} aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('library.search')} aria-label={t('library.search')} />
        {query && <button className="search-clear" type="button" onClick={() => setQuery('')} aria-label={t('library.clearSearch')} title={t('library.clearSearch')}><X size={16} aria-hidden="true" /></button>}
      </div>

      <div className="header-actions"><LanguageButton /><MidiImportButton onImport={onOpenMidi} /></div>
    </header>

    <section className="library-content" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <span className="section-kicker"><Sparkles size={13} /> {t('library.kicker')}</span>
          <h1 id="library-title">{t('library.title')}</h1>
          <p>{t('library.description')}</p>
        </div>
        <div className="library-count"><strong>{String(filteredItems.length).padStart(2, '0')}</strong><span>{t('library.arrangements')}</span></div>
      </div>

      {error && <div className="library-alert" role="alert">{t(error.key, error.title ? { title: error.title } : undefined)}</div>}

      {loading ? <div className="library-state"><LoaderCircle className="spin" size={24} /><span>{t('library.loading')}</span></div>
        : filteredItems.length === 0 ? <div className="library-state"><Search size={24} /><span>{t('library.noResults', { query })}</span></div>
          : <div className="library-grid">
            {filteredItems.map((item, index) => <button
              className="track-card"
              key={item.id}
              type="button"
              disabled={openingId !== null}
              onClick={() => void openTrack(item)}
              aria-label={t('library.openTrack', { title: item.title })}
            >
              <span className="track-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="track-arrow">{openingId === item.id ? <LoaderCircle className="spin" size={17} /> : <ArrowUpRight size={17} />}</span>
              <span className="waveform" aria-hidden="true">{waveform(item.id).map((height, barIndex) => <i key={barIndex} style={{ height: `${height}%` }} />)}</span>
              <span className="track-copy">
                <strong>{item.title}</strong>
                <small>{item.album}</small>
              </span>
              <span className="track-meta">
                <span><FileMusic size={13} /> {formatSize(item.size, t('library.mediaReady'))}</span>
                <span>{Object.keys(item.instruments).length} {t('library.instrumentTracks')}</span>
              </span>
            </button>)}
          </div>}
    </section>

    <footer className="library-footer"><span>{t('library.archive')}</span><span>{t('library.trackCount', { count: items.length })}</span></footer>
  </main>;
}
