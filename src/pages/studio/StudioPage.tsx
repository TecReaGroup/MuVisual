import { ArrowLeft, ListMusic, PanelRightClose, PanelRightOpen, Piano } from 'lucide-react';
import { useState } from 'react';
import { createDemoNotes, type AudioSource, type LabelMode, type Note, type ViewMode } from '../../entities/music';
import { MidiImportButton, type ImportedMidi, type MidiVariant, type MidiVersion } from '../../features/midi-import';
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
  const initialMidiVersion = initialMidi?.defaultMidiVersion ?? (initialMidi?.variants?.quantized ? 'quantized' : 'original');
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
  const [midiVersion, setMidiVersion] = useState<MidiVersion>(initialMidiVersion);
  const [midiVariants, setMidiVariants] = useState<Partial<Record<MidiVersion, MidiVariant>>>(() => initialMidi?.variants ?? (initialMidi ? { [initialMidiVersion]: toMidiVariant(initialMidi) } : {}));
  const [audioSource, setAudioSource] = useState<AudioSource>('midi');
  const [audioUrls, setAudioUrls] = useState(() => initialMidi?.audioUrls ?? { original: null, piano: null });
  const playback = usePlayback(notes, muted, volume, audioSource, audioUrls);
  const loadStatusLabel = {
    loading: t('studio.loading'),
    ready: t('studio.ready'),
    error: t('studio.loadError'),
  }[playback.loadStatus];

  const handleImport = (midi: ImportedMidi) => {
    playback.reset();
    setNotes(midi.notes);
    setBpm(midi.bpm);
    setKeySignature(midi.keySignature);
    setGridDelay(midi.backgroundDelayMs);
    setLoadedName(midi.name);
    setMidiVersion('original');
    setMidiVariants({ original: toMidiVariant(midi) });
    setAudioSource('midi');
    setAudioUrls({ original: null, piano: null });
  };

  const handleMidiVersionChange = (version: MidiVersion) => {
    const variant = midiVariants[version];
    if (!variant || version === midiVersion) return;
    playback.reset();
    setMidiVersion(version);
    setNotes(variant.notes);
    setBpm(variant.bpm);
    setKeySignature(variant.keySignature);
    setGridDelay(variant.backgroundDelayMs);
  };

  const handleAudioSourceChange = (source: AudioSource) => {
    if (source === audioSource) return;
    setAudioSource(source);
  };

  return <main className="app">
    <header className="topbar">
      {onBack ? <button className="brand brand-back" type="button" onClick={onBack} aria-label={t('studio.back')}><ArrowLeft size={17} /><span className="brand-mark">MV</span><span><strong>MuVisual</strong><small>{t('studio.tagline')}</small></span></button>
        : <div className="brand"><span className="brand-mark">MV</span><div><strong>MuVisual</strong><span>{t('studio.tagline')}</span></div></div>}
      <div className={`session timbre-status ${playback.loadStatus}`} role="status" aria-live="polite"><span className="status-dot" />{t('studio.timbre')} · {loadStatusLabel} <span className="divider" /><span className="loaded-name">{loadedName || t('studio.demoArrangement')}</span></div>
      <div className="header-actions"><LanguageButton /><MidiImportButton onImport={handleImport} /></div>
    </header>
    <section className={`workspace ${controlsCollapsed ? 'controls-collapsed' : ''}`}>
      <div className={`canvas-wrap ${viewMode === 'score' ? 'score-mode' : ''}`} onWheel={viewMode === 'roll' ? event => {
        event.preventDefault();
        const beatStep = 60 / bpm;
        playback.seek(Math.max(0, Math.min(playback.duration, playback.getElapsed() + event.deltaY / 240 * beatStep)));
      } : undefined}>
        {viewMode === 'roll'
          ? <PianoRoll bpm={bpm} duration={playback.duration} elapsed={playback.elapsed} getElapsed={playback.getElapsed} gridDelay={gridDelay} keySignature={keySignature} labelMode={labelMode} notes={notes} onChordChange={setChordName} onSeek={playback.seek} />
          : <JianpuView bpm={bpm} gridDelay={gridDelay} notes={notes} getElapsed={playback.getElapsed} keySignature={keySignature} />}
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
          availableAudioSources={{ midi: true, piano: Boolean(audioUrls.piano), original: Boolean(audioUrls.original) }}
          availableMidiVersions={{ original: Boolean(midiVariants.original), quantized: Boolean(midiVariants.quantized) }}
          bpm={bpm}
          duration={playback.duration}
          elapsed={playback.elapsed}
          gridDelay={gridDelay}
          keySignature={keySignature}
          labelMode={labelMode}
          muted={muted}
          midiVersion={midiVersion}
          noteCount={notes.length}
          playing={playback.playing}
          volume={volume}
          onAudioSourceChange={handleAudioSourceChange}
          onBpmChange={setBpm}
          onGridDelayChange={setGridDelay}
          onKeySignatureChange={setKeySignature}
          onLabelModeChange={setLabelMode}
          onMutedChange={setMuted}
          onMidiVersionChange={handleMidiVersionChange}
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
