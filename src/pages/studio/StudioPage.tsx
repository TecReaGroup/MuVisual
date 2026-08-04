import { ListMusic, PanelRightClose, PanelRightOpen, Piano } from 'lucide-react';
import { useState } from 'react';
import { createDemoNotes, type LabelMode, type Note, type ViewMode } from '../../entities/music';
import { MidiImportButton, type ImportedMidi } from '../../features/midi-import';
import { PianoRoll } from '../../features/piano-roll';
import { PlaybackControls, usePlayback } from '../../features/playback';
import { JianpuView } from '../../features/score';

export function StudioPage() {
  const [notes, setNotes] = useState<Note[]>(createDemoNotes);
  const [bpm, setBpm] = useState(92);
  const [keySignature, setKeySignature] = useState('C:major');
  const [volume, setVolume] = useState(72);
  const [muted, setMuted] = useState(false);
  const [gridDelay, setGridDelay] = useState(0);
  const [loadedName, setLoadedName] = useState('Demo arrangement');
  const [labelMode, setLabelMode] = useState<LabelMode>('name');
  const [viewMode, setViewMode] = useState<ViewMode>('roll');
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [chordName, setChordName] = useState<string | null>(null);
  const playback = usePlayback(notes, muted, volume);

  const handleImport = (midi: ImportedMidi) => {
    setNotes(midi.notes);
    setBpm(midi.bpm);
    setKeySignature(midi.keySignature);
    setGridDelay(midi.backgroundDelayMs);
    setLoadedName(midi.name);
    playback.reset();
  };

  return <main className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">MV</span><div><strong>MuVisual</strong><span>PIANO ROLL STUDIO</span></div></div>
      <div className="session"><span className="status-dot" />SESSION 04 <span className="divider" />{loadedName}</div>
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
      </div>
      <aside className={`controls ${controlsCollapsed ? 'collapsed' : ''}`}>
        <PlaybackControls
          bpm={bpm}
          duration={playback.duration}
          elapsed={playback.elapsed}
          gridDelay={gridDelay}
          keySignature={keySignature}
          labelMode={labelMode}
          muted={muted}
          noteCount={notes.length}
          playing={playback.playing}
          volume={volume}
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
    <footer><span>SMPLR AUDIO ENGINE · @TONEJS/MIDI PARSER</span><span>88 KEYS · A0 — C8</span></footer>
  </main>;
}
