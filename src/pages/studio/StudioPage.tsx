import { ArrowLeft, AudioLines, ListMusic, PanelRightClose, PanelRightOpen, Piano } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createDemoNotes, createMusicalTimeline, type AudioSource, type BeatAnalysis, type Instrument, type LabelMode, type Note, type ViewMode } from '../../entities/music';
import { MidiImportButton, type ImportedMidi, type MidiVariant } from '../../features/midi-import';
import { PianoRoll } from '../../features/piano-roll';
import { PlaybackControls, usePlayback } from '../../features/playback';
import { JianpuView } from '../../features/score';
import { LanguageButton, useI18n } from '../../shared/i18n';

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
    ? initialInstrumentMedia?.midi ? 'midi' : initialInstrumentMedia?.audioUrl ? 'instrument' : 'original'
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
  const [chordName, setChordName] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<Instrument>(initialInstrument);
  const [instruments, setInstruments] = useState<Partial<Record<Instrument, { audioUrl: string | null; midi: MidiVariant | null }>>>(() => initialMidi?.instruments ?? (initialMidi ? { piano: { audioUrl: null, midi: toMidiVariant(initialMidi) } } : {}));
  const [audioSource, setAudioSource] = useState<AudioSource>(initialAudioSource);
  const [audioUrls, setAudioUrls] = useState(() => initialMidi?.audioUrls ?? { original: null, instrument: null });
  const [beatAnalysis, setBeatAnalysis] = useState<BeatAnalysis | null>(() => initialMidi?.beatAnalysis ?? null);
  const [beatEnhance, setBeatEnhance] = useState(true);
  const resourceAudioUrls = useMemo(
    () => [...new Set([audioUrls.original, ...Object.values(instruments).map(media => media?.audioUrl)].filter((url): url is string => Boolean(url)))],
    [audioUrls.original, instruments],
  );
  const timeline = useMemo(
    () => createMusicalTimeline(bpm, gridDelay, beatEnhance ? beatAnalysis : null),
    [beatAnalysis, beatEnhance, bpm, gridDelay],
  );
  const playback = usePlayback(notes, muted, volume, audioSource, instrument, audioUrls, resourceAudioUrls);
  const loadStatusLabel = {
    loading: t('studio.loadingResources'),
    ready: t('studio.ready'),
    error: t('studio.loadError'),
  }[playback.loadStatus];
  const resourcesReady = playback.loadStatus === 'ready';

  const handleImport = (midi: ImportedMidi) => {
    playback.reset();
    setNotes(midi.notes);
    setBpm(midi.bpm);
    setKeySignature(midi.keySignature);
    setGridDelay(midi.backgroundDelayMs);
    setLoadedName(midi.name);
    setInstrument('piano');
    setInstruments({ piano: { audioUrl: null, midi: toMidiVariant(midi) } });
    setAudioSource('midi');
    setAudioUrls({ original: null, instrument: null });
    setBeatAnalysis(null);
  };

  const handleInstrumentChange = (nextInstrument: Instrument) => {
    const next = instruments[nextInstrument];
    if (!next || nextInstrument === instrument) return;
    playback.reset();
    setInstrument(nextInstrument);
    setAudioUrls(current => ({ original: current.original, instrument: next.audioUrl }));
    if (next.midi) {
      setNotes(next.midi.notes);
      setBpm(next.midi.bpm);
      setKeySignature(next.midi.keySignature);
      setGridDelay(next.midi.backgroundDelayMs);
    } else {
      setNotes([]);
      if (audioSource === 'midi') setAudioSource(next.audioUrl ? 'instrument' : 'original');
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
      <div className="header-actions"><LanguageButton /><MidiImportButton onImport={handleImport} /></div>
    </header>
    <section className={`workspace ${controlsCollapsed ? 'controls-collapsed' : ''}`}>
      <div className={`canvas-wrap ${viewMode === 'score' ? 'score-mode' : ''}`} onWheel={viewMode === 'roll' ? event => {
        event.preventDefault();
        const currentPosition = timeline.positionAt(playback.getElapsed());
        const beatStep = timeline.timeAt(currentPosition + 1) - timeline.timeAt(currentPosition);
        playback.seek(Math.max(0, Math.min(playback.duration, playback.getElapsed() + event.deltaY / 240 * beatStep)));
      } : undefined}>
        {viewMode === 'roll'
          ? <PianoRoll duration={playback.duration} getElapsed={playback.getElapsed} keySignature={keySignature} labelMode={labelMode} notes={notes} timeline={timeline} onChordChange={setChordName} onSeek={playback.seek} />
          : <JianpuView bpm={bpm} notes={notes} getElapsed={playback.getElapsed} keySignature={keySignature} timeline={timeline} />}
        <div className="canvas-label">
          <span>{t(viewMode === 'roll' ? 'studio.liveVisualizer' : 'studio.numberedNotation')}</span>
          <div className="view-switch" role="group" aria-label={t('studio.viewSettings')}>
            <button className={viewMode === 'roll' ? 'selected' : ''} onClick={() => setViewMode('roll')} aria-label={t('studio.pianoRollView')} title={t('studio.pianoRollView')}><Piano size={15} /></button>
            <button className={viewMode === 'score' ? 'selected' : ''} onClick={() => setViewMode('score')} aria-label={t('studio.scoreView')} title={t('studio.scoreView')}><ListMusic size={15} /></button>
            <button onClick={() => setControlsCollapsed(value => !value)} aria-label={t(controlsCollapsed ? 'studio.openSettings' : 'studio.closeSettings')} title={t(controlsCollapsed ? 'studio.openSettings' : 'studio.closeSettings')}>{controlsCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}</button>
          </div>
        </div>
        {viewMode === 'roll' && <div className={`chord-display ${chordName ? 'visible' : ''}`} aria-live="polite">{chordName ?? ''}</div>}
      </div>
      <aside className={`controls ${controlsCollapsed ? 'collapsed' : ''}`}>
        <PlaybackControls
          audioSource={audioSource}
          instrument={instrument}
          availableAudioSources={{ midi: Boolean(instruments[instrument]?.midi) || !initialMidi, instrument: Boolean(audioUrls.instrument), original: Boolean(audioUrls.original) }}
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
