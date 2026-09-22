import { Check, FileUp, LoaderCircle, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../shared/i18n';
import { searchLibrarySongs, type NavidromeSong } from '../lib/libraryImport';

export function LibraryImportForm({ onConfirm }: { onConfirm: (song: NavidromeSong) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<NavidromeSong[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selectedSong, setSelectedSong] = useState<NavidromeSong | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const matches = await searchLibrarySongs(query.trim(), controller.signal);
        if (controller.signal.aborted) return;
        setSongs(matches.songs);
        setHasMore(matches.hasMore);
      } catch (searchError) {
        if (controller.signal.aborted) return;
        setError(t(searchError instanceof Error && searchError.message === 'NAVIDROME_NOT_CONFIGURED' ? 'import.libraryNotConfigured' : 'import.librarySearchError'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 500);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, t]);

  return <form className="library-import-form" onSubmit={event => { event.preventDefault(); if (selectedSong) onConfirm(selectedSong); }}>
    <label className="library-import-search">
      <Search size={17} />
      <input autoFocus aria-label={t('import.librarySearch')} placeholder={t('import.librarySearch')} value={query} onChange={event => {
        setQuery(event.target.value);
        setSelectedSong(null); setSongs([]); setError(null); setLoading(true);
      }} onKeyDown={event => {
        if (event.key === 'Enter') event.preventDefault();
      }} />
    </label>
    {!loading && !error && <small className="library-import-limit">{hasMore ? t('import.libraryLimit') : t('import.libraryCount', { count: songs.length })}</small>}
    <div className="library-import-results" aria-busy={loading} aria-label={t('import.library')}>
      {loading ? <p className="library-import-status" role="status"><LoaderCircle className="spin" size={18} />{t('import.libraryLoading')}</p>
        : error ? <p className="library-import-error" role="alert">{error}</p>
        : songs.length === 0 ? <p className="library-import-status" role="status">{t('import.libraryEmpty')}</p>
        : songs.map(song => <button key={song.id} type="button" className="library-import-song" aria-pressed={selectedSong?.id === song.id} onClick={() => setSelectedSong(song)}>
          <span><strong>{song.title}</strong><small>{[song.artist, song.album].filter(Boolean).join(' · ')}</small></span>
          {selectedSong?.id === song.id && <Check size={18} />}
        </button>)}
    </div>
    <button className="audio-upload-submit" type="submit" disabled={!selectedSong || loading}><FileUp size={16} />{t('import.libraryConfirm')}</button>
  </form>;
}
