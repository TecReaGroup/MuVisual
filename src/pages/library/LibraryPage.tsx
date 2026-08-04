import { ArrowUpRight, AudioLines, FileMusic, LoaderCircle, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MidiImportButton, parseMidiFile, type ImportedMidi } from '../../features/midi-import';
import { getLibrary, type LibraryItem } from './api';

const BAR_COUNT = 30;

function waveform(id: string) {
  let seed = [...id].reduce((value, character) => value + character.charCodeAt(0), 0);
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    seed = (seed * 9301 + 49297 + index) % 233280;
    return 18 + Math.round((seed / 233280) * 70);
  });
}

function formatSize(bytes: number) {
  if (!bytes) return 'MIDI READY';
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type LibraryPageProps = {
  onOpenMidi: (midi: ImportedMidi) => void;
  onHome?: () => void;
};

export function LibraryPage({ onOpenMidi, onHome }: LibraryPageProps) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadLibrary() {
      try {
        const result = await getLibrary(controller.signal);
        setItems(result.items);
      } catch (loadError) {
        if ((loadError as Error).name !== 'AbortError') setError('无法连接素材库，请确认后端服务已启动。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadLibrary();
    return () => controller.abort();
  }, []);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return items;
    return items.filter(item => `${item.title} ${item.album}`.toLocaleLowerCase('zh-CN').includes(normalized));
  }, [items, query]);

  const openTrack = async (item: LibraryItem) => {
    if (!item.midiUrl || openingId) return;
    setOpeningId(item.id);
    setError(null);
    try {
      const loadMidi = async (url: string | null, suffix: string) => {
        if (!url) return null;
        const response = await fetch(url);
        if (!response.ok) return null;
        const file = new File([await response.blob()], `${item.title}_${suffix}.mid`, { type: 'audio/midi' });
        return parseMidiFile(file);
      };
      const [original, quantized] = await Promise.all([
        loadMidi(item.originalMidiUrl, 'original'),
        loadMidi(item.quantizedMidiUrl, 'quantized'),
      ]);
      const selected = quantized ?? original;
      if (!selected) throw new Error('MIDI request failed');
      onOpenMidi({
        ...selected,
        audioUrls: { original: item.audioUrl, piano: item.pianoUrl },
        defaultMidiVersion: quantized ? 'quantized' : 'original',
        name: item.title,
        variants: {
          ...(original ? { original } : {}),
          ...(quantized ? { quantized } : {}),
        },
      });
    } catch {
      setError(`无法打开《${item.title}》，请稍后重试。`);
      setOpeningId(null);
    }
  };

  return <main className="library-app">
    <header className="library-header">
      <button className="library-brand" type="button" aria-label="MuVisual home" onClick={onHome}>
        <span className="brand-symbol"><AudioLines size={18} /></span>
        <span><strong>MuVisual</strong><small>MAKE MUSIC VISIBLE</small></span>
      </button>

      <label className="library-search">
        <span className="sr-only">搜索曲目或专辑</span>
        <Search size={18} aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索曲目或专辑" />
        {query && <kbd>{filteredItems.length}</kbd>}
      </label>

      <MidiImportButton onImport={onOpenMidi} />
    </header>

    <section className="library-content" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <span className="section-kicker"><Sparkles size={13} /> VISUAL COLLECTION</span>
          <h1 id="library-title">Library</h1>
          <p>选择一首曲目，进入可视化演奏空间。</p>
        </div>
        <div className="library-count"><strong>{String(filteredItems.length).padStart(2, '0')}</strong><span>ARRANGEMENTS</span></div>
      </div>

      {error && <div className="library-alert" role="alert">{error}</div>}

      {loading ? <div className="library-state"><LoaderCircle className="spin" size={24} /><span>正在读取曲库</span></div>
        : filteredItems.length === 0 ? <div className="library-state"><Search size={24} /><span>没有找到“{query}”</span></div>
          : <div className="library-grid">
            {filteredItems.map((item, index) => <button
              className="track-card"
              key={item.id}
              type="button"
              disabled={!item.midiUrl || openingId !== null}
              onClick={() => void openTrack(item)}
              aria-label={`打开 ${item.title}`}
            >
              <span className="track-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="track-arrow">{openingId === item.id ? <LoaderCircle className="spin" size={17} /> : <ArrowUpRight size={17} />}</span>
              <span className="waveform" aria-hidden="true">{waveform(item.id).map((height, barIndex) => <i key={barIndex} style={{ height: `${height}%` }} />)}</span>
              <span className="track-copy">
                <strong>{item.title}</strong>
                <small>{item.album}</small>
              </span>
              <span className="track-meta">
                <span><FileMusic size={13} /> {formatSize(item.size)}</span>
                <span>{item.pianoUrl ? 'PIANO + MIDI' : 'MIDI'}</span>
              </span>
            </button>)}
          </div>}
    </section>

    <footer className="library-footer"><span>MU VISUAL ARCHIVE</span><span>{items.length} TRACKS · LOCAL COLLECTION</span></footer>
  </main>;
}
