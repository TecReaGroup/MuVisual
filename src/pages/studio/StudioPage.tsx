import { ArrowLeft, AudioLines, ListMusic, PanelRightClose, PanelRightOpen, Piano } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createDemoNotes, createMusicalTimeline, type AudioSource, type BeatAnalysis, type Instrument, type LabelMode, type Note, type ViewMode } from '../../entities/music';
import { parseMidiFile, type ImportedMidi, type MidiVariant } from '../../features/midi-import';
import { PianoRoll } from '../../features/piano-roll';
import { PlaybackControls, usePlayback } from '../../features/playback';
import { JianpuView } from '../../features/score';
import { LanguageButton, useI18n } from '../../shared/i18n';
import { fetchMusicResource } from '../../shared/lib/fetchMusicResource';

type StudioPageProps = {
  initialMidi?: ImportedMidi;
  onBack?: () => void;
};

function toMidiVariant(midi: ImportedMidi): MidiVariant {
  return {
    backgroundDelayMs: midi.backgroundDelayMs,
    bpm: midi.bpm,
    keySignature: midi.keySignature,
    notes: midi.notes,
    tempoMap: midi.tempoMap,
  };
}

export function StudioPage({ initialMidi, onBack }: StudioPageProps) {
  const { t } = useI18n();
  const initialInstrument = initialMidi?.defaultInstrument ?? 'piano';
  const initialInstrumentMedia = initialMidi?.instruments?.[initialInstrument];
  const initialAudioSource: AudioSource = initialMidi?.instruments
    ? initialInstrumentMedia?.midi || initialInstrumentMedia?.midiUrl ? 'midi' : initialInstrumentMedia?.audioUrl ? 'instrument' : 'original'
    : 'midi';
  const [notes, setNotes] = useState<Note[]>(() => initialMidi?.notes ?? createDemoNotes());
  const [bpm, setBpm] = useState(initialMidi?.bpm ?? 92);
  const [keySignature, setKeySignature] = useState(initialMidi?.keySignature ?? 'C:major');
  const [volume, setVolume] = useState(72);
  const [muted, setMuted] = useState(false);
  const [gridDelay, setGridDelay] = useState(initialMidi?.backgroundDelayMs ?? 0);
  const [loadedName, setLoadedName] = useState(initialMidi?.name ?? '');
  const [labelMode, setLabelMode] = useState<LabelMode>('name');
  const [viewMode, setViewMode] = useState<ViewMode>('roll');
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [instrument, setInstrument] = useState<Instrument>(initialInstrument);
  const [instruments, setInstruments] = useState<NonNullable<ImportedMidi['instruments']>>(() => initialMidi?.instruments ?? (initialMidi ? { piano: { audioUrl: null, midi: toMidiVariant(initialMidi) } } : {}));
  const [audioSource, setAudioSource] = useState<AudioSource>(initialAudioSource);
  const [audioUrls, setAudioUrls] = useState(() => initialMidi?.audioUrls ?? { original: null, instrument: null });
  const [beatAnalysis, setBeatAnalysis] = useState<BeatAnalysis | null>(() => initialMidi?.beatAnalysis ?? null);
  const [beatEnhance, setBeatEnhance] = useState(true);
  const [midiErrorInstrument, setMidiErrorInstrument] = useState<Instrument | null>(null);
  const currentMedia = instruments[instrument];
  const midiLoadStatus = midiErrorInstrument === instrument ? 'error'
    : currentMedia?.midiUrl && !currentMedia.midi ? 'loading' : 'ready';
  useEffect(() => {
    if (!currentMedia?.midiUrl || currentMedia.midi) return;
    const midiUrl = currentMedia.midiUrl;
    const controller = new AbortController();
    async function loadCurrentMidi() {
      try {
        const bytes = await fetchMusicResource(midiUrl, controller.signal);
        const midi = await parseMidiFile(new File([bytes], `${instrument}.mid`, { type: 'audio/midi' }));
        if (controller.signal.aborted) return;
        if (!midi) throw new Error('Unable to parse instrument MIDI');
        setInstruments(current => ({ ...current, [instrument]: { ...current[instrument]!, midi } }));
        setNotes(midi.notes);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setMidiErrorInstrument(instrument);
      }
    }
    void loadCurrentMidi();
    return () => controller.abort();
  }, [currentMedia, instrument]);
  const timeline = useMemo(
    () => createMusicalTimeline(bpm, gridDelay, beatEnhance ? beatAnalysis : null),
    [beatAnalysis, beatEnhance, bpm, gridDelay],
  );
  const playback = usePlayback(notes, muted, volume, audioSource, instrument, audioUrls, midiLoadStatus);
  const chords = initialMidi?.metadata?.chords ?? [];
  let chordName = '';
  for (const entry of chords) {
    if (entry.time > playback.elapsed) break;
    chordName = entry.chord === 'N' ? '' : entry.chord;
  }
  const loadStatusLabel = {
    loading: t('studio.loadingResources'),
    ready: t('studio.ready'),
    error: t('studio.loadError'),
  }[playback.loadStatus];
  const resourcesReady = playback.loadStatus === 'ready';

  const handleInstrumentChange = (nextInstrument: Instrument) => {
    const next = instruments[nextInstrument];
    if (!next || nextInstrument === instrument) return;
    playback.pause();
    setMidiErrorInstrument(null);
    setInstrument(nextInstrument);
    setAudioUrls(current => ({ original: current.original, instrument: next.audioUrl }));
    if (next.midi) {
      setNotes(next.midi.notes);
    } else {
      setNotes([]);
      if (audioSource === 'midi' && !next.midiUrl) setAudioSource(next.audioUrl ? 'instrument' : 'original');
    }
  };

  const handleAudioSourceChange = (source: AudioSource) => {
    if (source === audioSource) return;
    setAudioSource(source);
  };

  return <main className="app">
    <header className="topbar">
      {onBack ? <button className="brand brand-back" type="button" onClick={onBack} aria-label={t('studio.back')}><ArrowLeft size={17} /><span className="brand-symbol"><AudioLines size={18} /></span><span><strong>MuVisual</strong><small>{t('studio.tagline')}</small></span></button>
        : <div className="brand"><span className="brand-symbol"><AudioLines size={18} /></span><div><strong>MuVisual</strong><span>{t('studio.tagline')}</span></div></div>}
      <div className={`session timbre-status ${playback.loadStatus}`} role="status" aria-live="polite"><span className="status-dot" />{resourcesReady ? `${t('studio.timbre')} · ${loadStatusLabel}` : loadStatusLabel} <span className="divider" /><span className="loaded-name">{loadedName || t('studio.demoArrangement')}</span></div>
      <div className="header-actions"><LanguageButton /></div>
    </header>
    <section className={`workspace ${controlsCollapsed ? 'controls-collapsed' : ''}`}>
      <div className={`canvas-wrap ${viewMode === 'score' ? 'score-mode' : ''}`} onWheel={viewMode === 'roll' ? event => {
        event.preventDefault();
        const currentPosition = timeline.positionAt(playback.getElapsed());
        const beatStep = timeline.timeAt(currentPosition + 1) - timeline.timeAt(currentPosition);
        playback.seek(Math.max(0, Math.min(playback.duration, playback.getElapsed() + event.deltaY / 240 * beatStep)));
      } : undefined}>
        {viewMode === 'roll'
          ? <PianoRoll duration={playback.duration} getElapsed={playback.getElapsed} keySignature={keySignature} labelMode={labelMode} notes={notes} timeline={timeline} onSeek={playback.seek} />
          : <JianpuView bpm={bpm} notes={notes} getElapsed={playback.getElapsed} keySignature={keySignature} timeline={timeline} metadata={initialMidi?.metadata} />}
        <div className="canvas-label">
          <span>{t(viewMode === 'roll' ? 'studio.liveVisualizer' : 'studio.numberedNotation')}</span>
          <div className="view-switch" role="group" aria-label={t('studio.viewSettings')}>
            <button className={viewMode === 'roll' ? 'selected' : ''} onClick={() => setViewMode('roll')} aria-label={t('studio.pianoRollView')} title={t('studio.pianoRollView')}><Piano size={15} /></button>
            <button className={viewMode === 'score' ? 'selected' : ''} onClick={() => setViewMode('score')} aria-label={t('studio.scoreView')} title={t('studio.scoreView')}><ListMusic size={15} /></button>
            <button onClick={() => setControlsCollapsed(value => !value)} aria-label={t(controlsCollapsed ? 'studio.openSettings' : 'studio.closeSettings')} title={t(controlsCollapsed ? 'studio.openSettings' : 'studio.closeSettings')}>{controlsCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}</button>
          </div>
        </div>
        {viewMode === 'roll' && <div className={`chord-display ${chordName ? 'visible' : ''}`} aria-live="polite">{chordName}</div>}
      </div>
      <aside className={`controls ${controlsCollapsed ? 'collapsed' : ''}`}>
        <PlaybackControls
          audioSource={audioSource}
          instrument={instrument}
          availableAudioSources={{ midi: Boolean(currentMedia?.midi || currentMedia?.midiUrl) || !initialMidi, instrument: Boolean(audioUrls.instrument), original: Boolean(audioUrls.original) }}
          availableInstruments={Object.fromEntries((Object.keys(instruments) as Instrument[]).map(name => [name, true]))}
          beatEnhanceAvailable={Boolean(beatAnalysis)}
          beatEnhanceEnabled={beatEnhance}
          bpm={bpm}
          duration={playback.duration}
          elapsed={playback.elapsed}
          gridDelay={gridDelay}
          keySignature={keySignature}
          labelMode={labelMode}
          muted={muted}
          noteCount={notes.length}
          playing={playback.playing}
          resourceLoadStatus={playback.loadStatus}
          volume={volume}
          onAudioSourceChange={handleAudioSourceChange}
          onBeatEnhanceChange={setBeatEnhance}
          onInstrumentChange={handleInstrumentChange}
          onBpmChange={setBpm}
          onGridDelayChange={setGridDelay}
          onKeySignatureChange={setKeySignature}
          onLabelModeChange={setLabelMode}
          onMutedChange={setMuted}
          onReset={playback.reset}
          onSeek={playback.seek}
          onToggle={playback.toggle}
          onVolumeChange={setVolume}
        />
      </aside>
    </section>
    <footer><span>{t('studio.footerEngine')}</span><span>{t('studio.footerKeys')}</span></footer>
  </main>;
}
