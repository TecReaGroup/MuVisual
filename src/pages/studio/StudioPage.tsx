import { ArrowLeft, ListMusic, LoaderCircle, PanelRightClose, PanelRightOpen, Piano } from 'lucide-react';
import { useState } from 'react';
import { createDemoNotes, type AudioSource, type LabelMode, type Note, type ViewMode } from '../../entities/music';
import { MidiImportButton, type ImportedMidi, type MidiVariant, type MidiVersion } from '../../features/midi-import';
import { PianoRoll } from '../../features/piano-roll';
import { PlaybackControls, usePlayback } from '../../features/playback';
import { JianpuView } from '../../features/score';

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
  const initialMidiVersion = initialMidi?.defaultMidiVersion ?? (initialMidi?.variants?.quantized ? 'quantized' : 'original');
  const [notes, setNotes] = useState<Note[]>(() => initialMidi?.notes ?? createDemoNotes());
  const [bpm, setBpm] = useState(initialMidi?.bpm ?? 92);
  const [keySignature, setKeySignature] = useState(initialMidi?.keySignature ?? 'C:major');
  const [volume, setVolume] = useState(72);
  const [muted, setMuted] = useState(false);
  const [gridDelay, setGridDelay] = useState(initialMidi?.backgroundDelayMs ?? 0);
  const [loadedName, setLoadedName] = useState(initialMidi?.name ?? 'Demo arrangement');
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
    loading: '加载中',
    ready: '已就绪',
    error: '加载失败',
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
      {onBack ? <button className="brand brand-back" type="button" onClick={onBack} aria-label="Back to library"><ArrowLeft size={17} /><span className="brand-mark">MV</span><span><strong>MuVisual</strong><small>PIANO ROLL STUDIO</small></span></button>
        : <div className="brand"><span className="brand-mark">MV</span><div><strong>MuVisual</strong><span>PIANO ROLL STUDIO</span></div></div>}
      <div className={`session timbre-status ${playback.loadStatus}`} role="status" aria-live="polite"><span className="status-dot" />MIDI 音色 · {loadStatusLabel} <span className="divider" />{loadedName}</div>
      <MidiImportButton onImport={handleImport} />
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
          <span>{viewMode === 'roll' ? 'LIVE VISUALIZER' : 'MIDI 简谱 · NUMBERED NOTATION'}</span>
          <div className="view-switch" role="group" aria-label="Visualization and settings">
            <button className={viewMode === 'roll' ? 'selected' : ''} onClick={() => setViewMode('roll')} aria-label="Piano roll view" title="Piano roll view"><Piano size={15} /></button>
            <button className={viewMode === 'score' ? 'selected' : ''} onClick={() => setViewMode('score')} aria-label="MIDI numbered notation view" title="MIDI numbered notation view"><ListMusic size={15} /></button>
            <button onClick={() => setControlsCollapsed(value => !value)} aria-label={controlsCollapsed ? 'Open settings panel' : 'Close settings panel'} title={controlsCollapsed ? 'Open settings panel' : 'Close settings panel'}>{controlsCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}</button>
          </div>
        </div>
        {viewMode === 'roll' && <div className={`chord-display ${chordName ? 'visible' : ''}`} aria-live="polite">{chordName ?? ''}</div>}
        {playback.loadStatus === 'loading' && <div className="audio-loading-overlay" role="status" aria-live="polite">
          <LoaderCircle size={30} />
          <strong>正在加载 MIDI 音色</strong>
          <span>Splendid Grand Piano</span>
        </div>}
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
    <footer><span>SMPLR AUDIO ENGINE · @TONEJS/MIDI PARSER</span><span>88 KEYS · A0 — C8</span></footer>
  </main>;
}
