import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileUp, ListMusic, Minus, PanelRightClose, PanelRightOpen, Pause, Play, Plus, RotateCcw, Volume2, VolumeX, Piano } from 'lucide-react';
import { Midi } from '@tonejs/midi';
import { SplendidGrandPiano } from 'smplr';
import { JianpuView, numberForPitch } from './JianpuView';
import './styles.css';

type Hand = 'left' | 'right';
type LabelMode = 'name' | 'number';
type Note = { pitch: number; start: number; duration: number; beat: number; durationBeats: number; hand: Hand };
type TimedNote = Note & { played?: boolean };
type TempoPoint = { beat: number; time: number; bpm: number };
const START_MIDI = 21, END_MIDI = 108;
const whitePitch = (pitch: number) => [0, 2, 4, 5, 7, 9, 11].includes(pitch % 12);
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_SIGNATURE_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const KEY_SIGNATURE_OPTIONS = KEY_SIGNATURE_KEYS.flatMap(key => [
  { value: `${key}:major`, label: `${key} major` },
  { value: `${key}:minor`, label: `${key} minor` },
]);
const CHORDS = [
  { intervals: [0, 4, 7, 11], suffix: 'maj7' },
  { intervals: [0, 3, 7, 10], suffix: 'm7' },
  { intervals: [0, 4, 7, 10], suffix: '7' },
  { intervals: [0, 3, 6, 10], suffix: 'm7b5' },
  { intervals: [0, 3, 6, 9], suffix: 'dim7' },
  { intervals: [0, 4, 7, 9], suffix: '6' },
  { intervals: [0, 3, 7, 9], suffix: 'm6' },
  { intervals: [0, 2, 4, 7], suffix: 'add9' },
  { intervals: [0, 2, 3, 7], suffix: 'madd9' },
  { intervals: [0, 4, 7], suffix: '' },
  { intervals: [0, 3, 7], suffix: 'm' },
  { intervals: [0, 3, 6], suffix: 'dim' },
  { intervals: [0, 4, 8], suffix: 'aug' },
  { intervals: [0, 2, 7], suffix: 'sus2' },
  { intervals: [0, 5, 7], suffix: 'sus4' },
] as const;

function recognizeChord(activePitches: Set<number>): string | null {
  const pitchClasses = [...new Set([...activePitches].map(pitch => pitch % 12))].sort((a, b) => a - b);
  if (pitchClasses.length < 3) return null;
  const bass = Math.min(...activePitches) % 12;
  for (const root of pitchClasses) {
    const intervals = pitchClasses.map(note => (note - root + 12) % 12).sort((a, b) => a - b);
    const match = CHORDS.find(chord => chord.intervals.length === intervals.length && chord.intervals.every((interval, index) => interval === intervals[index]));
    if (match) return `${PITCH_NAMES[root]}${match.suffix}${bass === root ? '' : `/${PITCH_NAMES[bass]}`}`;
  }
  return null;
}

const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const pitchLabel = (pitch: number, mode: LabelMode, keySignature: string) => mode === 'name' ? PITCH_NAMES[pitch % 12] : numberForPitch(pitch, keySignature).text;

function demoNotes(): Note[] {
  const chords = [[48, 55, 60, 63], [44, 51, 56, 60], [46, 53, 58, 62], [43, 50, 55, 59]];
  const notes: Note[] = [];
  for (let i = 0; i < 12; i++) {
    const chord = chords[i % chords.length], time = 1 + i * 2;
    chord.forEach((pitch, index) => notes.push({ pitch, start: time + index * 0.05, duration: 1.8, beat: (time + index * 0.05) * 92 / 60, durationBeats: 1.8 * 92 / 60, hand: 'left' }));
    [chord[3] + 12, chord[2] + 12, chord[3] + 12, chord[1] + 12].forEach((pitch, index) => notes.push({ pitch, start: time + index * .5, duration: .38, beat: (time + index * .5) * 92 / 60, durationBeats: .38 * 92 / 60, hand: 'right' }));
  }
  return notes;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null), playbackRafRef = useRef<number>(), audioRef = useRef<AudioContext>(), pianoRef = useRef<SplendidGrandPiano>(), pianoLoadingRef = useRef(false);
  const [notes, setNotes] = useState<Note[]>(demoNotes), [playing, setPlaying] = useState(false), [bpm, setBpm] = useState(92), [keySignature, setKeySignature] = useState('C:major'), [volume, setVolume] = useState(72), [muted, setMuted] = useState(false), [gridDelay, setGridDelay] = useState(0), [elapsed, setElapsed] = useState(0), [loadedName, setLoadedName] = useState('Demo arrangement'), [chordName, setChordName] = useState<string | null>(null), [viewMode, setViewMode] = useState<'roll' | 'score'>('roll');
  const [tempoMap, setTempoMap] = useState<TempoPoint[]>([{ beat: 0, time: 0, bpm: 92 }]);
  const [labelMode, setLabelMode] = useState<LabelMode>('name');
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const startRef = useRef(0), pausedRef = useRef(0), chordRef = useRef<string | null>(null);
  const keyboardToggleRef = useRef<() => void>(() => undefined);
  const timedNotes = useMemo<TimedNote[]>(() => notes.map(note => ({ ...note, played: note.start < pausedRef.current })), [notes]);
  const notesRef = useRef<TimedNote[]>(timedNotes); notesRef.current = timedNotes;
  const elapsedRef = useRef(elapsed); elapsedRef.current = elapsed;
  const duration = Math.max(0, ...timedNotes.map(n => n.start + n.duration));

  const tone = useCallback((pitch: number, length: number) => {
    if (muted) return;
    const ctx = audioRef.current ?? new AudioContext(); audioRef.current = ctx;
    if (pianoRef.current) {
      pianoRef.current.start({ note: pitch, duration: length, velocity: Math.max(20, Math.round(volume * 1.1)) });
      return;
    }
    const osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = 'sine'; osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
    gain.gain.setValueAtTime((volume / 100) * .08, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + Math.min(length, 1.2)); osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + Math.min(length, 1.2));
  }, [muted, volume]);

  useEffect(() => {
    if (!playing) return;
    const loop = () => {
      const playbackTime = pausedRef.current + (performance.now() - startRef.current) / 1000;
      const current = Math.min(playbackTime, duration);
      notesRef.current.forEach(note => {
        if (!note.played && current >= note.start) {
          note.played = true;
          tone(note.pitch, note.duration);
        }
      });
      elapsedRef.current = current;
      setElapsed(current);
      if (playbackTime >= duration) {
        pausedRef.current = duration;
        setPlaying(false);
        return;
      }
      playbackRafRef.current = requestAnimationFrame(loop);
    };
    playbackRafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(playbackRafRef.current!);
  }, [playing, duration, tone]);

  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return;
    let width = 0, height = 0, keys: Record<number, { x: number; w: number; h: number; black: boolean }> = {};
    const resize = () => { width = canvas.clientWidth; height = canvas.clientHeight; const dpr = devicePixelRatio || 1; canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); const keyH = Math.min(150, height * .2); const whiteCount = Array.from({ length: END_MIDI - START_MIDI + 1 }, (_, i) => START_MIDI + i).filter(whitePitch).length; const ww = width / whiteCount; let x = 0; keys = {}; for (let p = START_MIDI; p <= END_MIDI; p++) if (whitePitch(p)) { keys[p] = { x, w: ww, h: keyH, black: false }; x += ww; } for (let p = START_MIDI; p <= END_MIDI; p++) if (!whitePitch(p)) { const prev = keys[p - 1]; if (prev) keys[p] = { x: prev.x + prev.w - ww * .325, w: ww * .65, h: keyH * .65, black: true }; } };
    const draw = (time: number) => { const keyH = Math.min(150, height * .2), bottom = height - keyH, pxPerSecond = 180, beatSpacing = pxPerSecond * 60 / bpm, gridPosition = time * pxPerSecond - gridDelay / 1000 * pxPerSecond, beatOffset = ((gridPosition % beatSpacing) + beatSpacing) % beatSpacing; ctx.fillStyle = '#080a0f'; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 1; Object.values(keys).filter(k => !k.black).forEach(k => { ctx.beginPath(); ctx.moveTo(k.x, 0); ctx.lineTo(k.x, bottom); ctx.stroke(); }); for (let y = bottom + beatOffset; y > 0; y -= beatSpacing) { if (y <= bottom) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); } }
      const active = new Set<number>(); notesRef.current.forEach(n => { const noteEnd = n.start + n.duration, on = time >= n.start && time <= noteEnd; if (on) active.add(n.pitch); const yBottom = bottom - (n.start - time) * pxPerSecond, yTop = yBottom - n.duration * pxPerSecond, key = keys[n.pitch]; if (!key || yBottom < 0 || yTop > bottom) return; const top = Math.max(0, yTop), visibleBottom = Math.min(bottom, yBottom), h = visibleBottom - top; if (h <= 0) return; ctx.fillStyle = n.hand === 'left' ? '#ff6b5f' : '#ffab57'; ctx.shadowBlur = on ? 20 : 8; ctx.shadowColor = ctx.fillStyle; ctx.beginPath(); ctx.roundRect(key.x + 2, top, key.w - 4, h, 4); ctx.fill(); ctx.shadowBlur = 0; if (time < noteEnd) { const label = pitchLabel(n.pitch, labelMode, keySignature); const fontSize = Math.max(6, Math.min(9, key.w * .72)); ctx.font = `600 ${fontSize}px 'DM Mono'`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(8,10,15,.75)'; ctx.shadowBlur = 2; ctx.fillText(label, key.x + key.w / 2, visibleBottom - 3, Math.max(6, key.w - 4)); ctx.shadowBlur = 0; } });
      const recognizedChord = recognizeChord(active);
      if (recognizedChord !== chordRef.current) { chordRef.current = recognizedChord; setChordName(recognizedChord); }
      Object.entries(keys).filter(([, k]) => !k.black).forEach(([p, k]) => { ctx.fillStyle = active.has(+p) ? '#ff6b5f' : '#e9ebef'; ctx.fillRect(k.x, bottom, k.w, k.h); ctx.strokeStyle = '#15171c'; ctx.strokeRect(k.x, bottom, k.w, k.h); }); Object.entries(keys).filter(([, k]) => k.black).forEach(([p, k]) => { ctx.fillStyle = active.has(+p) ? '#ff6b5f' : '#1b1e26'; ctx.fillRect(k.x, bottom, k.w, k.h); }); };
    let drawRaf = 0;
    const loop = () => { draw(elapsedRef.current); drawRaf = requestAnimationFrame(loop); };
    resize(); window.addEventListener('resize', resize); loop();
    return () => { cancelAnimationFrame(drawRaf); window.removeEventListener('resize', resize); };
  }, [bpm, gridDelay, viewMode, labelMode, keySignature]);
  const toggle = () => { if (playing) { pausedRef.current = Math.min(duration, pausedRef.current + (performance.now() - startRef.current) / 1000); elapsedRef.current = pausedRef.current; setElapsed(pausedRef.current); setPlaying(false); } else { if (pausedRef.current >= duration) { pausedRef.current = 0; elapsedRef.current = 0; setElapsed(0); notesRef.current.forEach(note => { note.played = false; }); } const ctx = audioRef.current ?? new AudioContext(); audioRef.current = ctx; void ctx.resume(); if (!pianoRef.current && !pianoLoadingRef.current) { pianoLoadingRef.current = true; const piano = new SplendidGrandPiano(ctx, { notesToLoad: { notes: Array.from({ length: END_MIDI - START_MIDI + 1 }, (_, i) => START_MIDI + i), velocityRange: [1, 127] } }); void piano.load.then(() => { pianoRef.current = piano; }).catch(() => undefined).finally(() => { pianoLoadingRef.current = false; }); } startRef.current = performance.now(); setPlaying(true); } };
  keyboardToggleRef.current = toggle;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, select, textarea, button, [contenteditable="true"]')) return;
      event.preventDefault();
      keyboardToggleRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const seek = (time: number) => { pausedRef.current = time; startRef.current = performance.now(); setElapsed(time); notesRef.current.forEach(note => { note.played = note.start < time; }); };
  const reset = () => { pausedRef.current = 0; setElapsed(0); setPlaying(false); notesRef.current.forEach(n => { n.played = false; }); };
  const changeBpm = (nextBpm: number) => setBpm(Math.max(30, Math.min(300, nextBpm)));
  const upload = async (file: File) => { const midi = new Midi(await file.arrayBuffer()); const noteTracks = midi.tracks.filter(track => track.notes.length); const ppq = midi.header.ppq; const parsed: Note[] = noteTracks.flatMap(track => track.notes.map(n => ({ pitch: n.midi, start: n.time, duration: n.duration, beat: n.ticks / ppq, durationBeats: n.durationTicks / ppq, hand: (track.channel % 2 ? 'right' : 'left') as Hand }))); if (parsed.length) { const midiBpm = midi.header.tempos[0]?.bpm ?? 120; setBpm(Math.round(midiBpm)); const parsedTempoMap = midi.header.tempos.length ? midi.header.tempos.map(tempo => ({ beat: tempo.ticks / ppq, time: tempo.time ?? midi.header.ticksToSeconds(tempo.ticks), bpm: tempo.bpm })) : [{ beat: 0, time: 0, bpm: midiBpm }]; setTempoMap(parsedTempoMap); const midiKey = [...midi.header.keySignatures].sort((a, b) => a.ticks - b.ticks)[0]; setKeySignature(midiKey ? `${midiKey.key}:${midiKey.scale}` : 'C:major'); setNotes(parsed); setLoadedName(file.name); reset(); } };
  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">MV</span><div><strong>MuVisual</strong><span>PIANO ROLL STUDIO</span></div></div>
        <div className="session"><span className="status-dot" />SESSION 04 <span className="divider" />{loadedName}</div>
        <label className="upload"><FileUp size={16} /> IMPORT MIDI<input type="file" accept=".mid,.midi" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} /></label>
      </header>
      <section className={`workspace ${controlsCollapsed ? 'controls-collapsed' : ''}`}>
        <div className={`canvas-wrap ${viewMode === 'score' ? 'score-mode' : ''}`} onWheel={viewMode === 'roll' ? event => {
          event.preventDefault();
          const beatStep = 60 / bpm;
          seek(Math.max(0, Math.min(duration, elapsed + event.deltaY / 240 * beatStep)));
        } : undefined}>
          {viewMode === 'roll' ? <>
            <canvas ref={canvasRef} />
            <div className={`chord-display ${chordName ? 'visible' : ''}`} aria-live="polite">{chordName ?? ''}</div>
            <input className="roll-scrollbar" type="range" min="0" max={duration} step="0.01" value={Math.min(elapsed, duration)} onChange={event => seek(+event.target.value)} aria-label="Scroll piano visualizer playback position" />
          </> : <JianpuView notes={timedNotes} elapsed={elapsed} tempoMap={tempoMap} keySignature={keySignature} />}
          <div className="canvas-label"><span>{viewMode === 'roll' ? 'LIVE VISUALIZER' : 'MIDI 简谱 · NUMBERED NOTATION'}</span><div className="view-switch" role="group" aria-label="Visualization and settings"><button className={viewMode === 'roll' ? 'selected' : ''} onClick={() => setViewMode('roll')} aria-label="Piano roll view" title="Piano roll view"><Piano size={15} /></button><button className={viewMode === 'score' ? 'selected' : ''} onClick={() => setViewMode('score')} aria-label="MIDI numbered notation view" title="MIDI numbered notation view"><ListMusic size={15} /></button><button onClick={() => setControlsCollapsed(value => !value)} aria-label={controlsCollapsed ? 'Open settings panel' : 'Close settings panel'} title={controlsCollapsed ? 'Open settings panel' : 'Close settings panel'}>{controlsCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}</button></div></div>
        </div>
        <aside className={`controls ${controlsCollapsed ? 'collapsed' : ''}`}>
          <div className="controls-header">
            <div className="eyebrow">PLAYBACK CONTROL</div>
          </div>
          <div className="progress-control">
            <input type="range" min="0" max={duration} step="0.01" value={Math.min(elapsed, duration)} onChange={e => seek(+e.target.value)} aria-label="Playback progress" />
            <div><span>{formatTime(elapsed)}</span><span>{formatTime(duration)}</span></div>
          </div>
          <div className="transport">
            <button className="primary" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}</button>
            <button onClick={reset} aria-label="Reset"><RotateCcw size={18} /></button>
            <div className="transport-copy"><strong>{playing ? 'Playing arrangement' : 'Ready to play'}</strong><span>{bpm} BPM · {notes.length} notes</span></div>
          </div>
          <div className="key-control">
            <label htmlFor="key-signature">KEY SIGNATURE</label>
            <select id="key-signature" value={keySignature} onChange={e => setKeySignature(e.target.value)}>
              {KEY_SIGNATURE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="label-control">
            <span>NOTE LABELS</span>
            <div className="label-switch" role="group" aria-label="Piano roll note label format">
              <button className={labelMode === 'name' ? 'selected' : ''} onClick={() => setLabelMode('name')} aria-pressed={labelMode === 'name'}>C D E</button>
              <button className={labelMode === 'number' ? 'selected' : ''} onClick={() => setLabelMode('number')} aria-pressed={labelMode === 'number'}>1 2 3</button>
            </div>
          </div>
          <div className="control tempo-control">
            <div><span>TEMPO</span><b>{bpm}<small>BPM</small></b></div>
            <input type="range" min="30" max="300" step="1" value={bpm} onChange={e => changeBpm(+e.target.value)} />
            <div className="step-actions">
              <button onClick={() => changeBpm(bpm + 1)} disabled={bpm >= 300} aria-label="Increase tempo by 1 BPM"><Plus size={16} />1 BPM</button>
              <button onClick={() => changeBpm(bpm - 1)} disabled={bpm <= 30} aria-label="Decrease tempo by 1 BPM"><Minus size={16} />1 BPM</button>
            </div>
          </div>
          <div className="control delay-control">
            <div><span>BACKGROUND DELAY</span><b>{gridDelay}<small>MS</small></b></div>
            <input type="range" min="0" max="2000" step="10" value={gridDelay} onChange={e => setGridDelay(+e.target.value)} />
            <div className="delay-actions step-actions">
              <button onClick={() => setGridDelay(value => Math.min(2000, value + 10))} disabled={gridDelay >= 2000} aria-label="Increase background delay by 10 milliseconds"><Plus size={16} />10 MS</button>
              <button onClick={() => setGridDelay(value => Math.max(0, value - 10))} disabled={gridDelay <= 0} aria-label="Decrease background delay by 10 milliseconds"><Minus size={16} />10 MS</button>
            </div>
          </div>
          <div className="control">
            <div><span>MASTER VOLUME</span><b>{muted ? 0 : volume}<small>%</small></b></div>
            <input type="range" min="0" max="100" value={volume} onChange={e => setVolume(+e.target.value)} />
          </div>
          <button className="mute" onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}{muted ? 'UNMUTE AUDIO' : 'MUTE AUDIO'}</button>
          <div className="legend"><div><i className="left" />LEFT HAND</div><div><i className="right" />RIGHT HAND</div></div>
        </aside>
      </section>
      <footer><span>SMPLR AUDIO ENGINE · @TONEJS/MIDI PARSER</span><span>88 KEYS · A0 — C8</span></footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
