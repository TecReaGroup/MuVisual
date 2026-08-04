import { useEffect, useMemo, useRef } from 'react';
import { END_MIDI, isWhitePitch, numberForPitch, PITCH_NAMES, START_MIDI } from '../../../entities/music/lib/pitch';
import type { LabelMode, Note } from '../../../entities/music/model/types';
import { recognizeChord } from '../model/recognizeChord';

type PianoKey = { x: number; w: number; h: number; black: boolean };

type PianoRollProps = {
  bpm: number;
  duration: number;
  elapsed: number;
  getElapsed: () => number;
  gridDelay: number;
  keySignature: string;
  labelMode: LabelMode;
  notes: Note[];
  onChordChange: (chord: string | null) => void;
  onSeek: (time: number) => void;
};

function pitchLabel(pitch: number, mode: LabelMode, keySignature: string) {
  return mode === 'name' ? PITCH_NAMES[pitch % 12] : numberForPitch(pitch, keySignature).text;
}

function lowerBound(notes: Note[], time: number, inclusive: boolean) {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const beforeBoundary = inclusive ? notes[middle].start < time : notes[middle].start <= time;
    if (beforeBoundary) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function PianoRoll({
  bpm,
  duration,
  elapsed,
  getElapsed,
  gridDelay,
  keySignature,
  labelMode,
  notes,
  onChordChange,
  onSeek,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sortedNotes = useMemo(() => [...notes].sort((first, second) => first.start - second.start), [notes]);
  const maxNoteDuration = useMemo(
    () => sortedNotes.reduce((maximum, note) => Math.max(maximum, note.duration), 0),
    [sortedNotes],
  );
  const notesRef = useRef(sortedNotes);
  const chordRef = useRef<string | null>(null);
  notesRef.current = sortedNotes;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    chordRef.current = null;
    onChordChange(null);

    let width = 0;
    let height = 0;
    let keys: Record<number, PianoKey> = {};
    let whiteKeys: Array<[number, PianoKey]> = [];
    let blackKeys: Array<[number, PianoKey]> = [];
    let needsRedraw = true;

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const keyHeight = Math.min(150, height * 0.2);
      const whiteCount = Array.from(
        { length: END_MIDI - START_MIDI + 1 },
        (_, index) => START_MIDI + index,
      ).filter(isWhitePitch).length;
      const whiteWidth = width / whiteCount;
      let x = 0;
      keys = {};

      for (let pitch = START_MIDI; pitch <= END_MIDI; pitch += 1) {
        if (isWhitePitch(pitch)) {
          keys[pitch] = { x, w: whiteWidth, h: keyHeight, black: false };
          x += whiteWidth;
        }
      }
      for (let pitch = START_MIDI; pitch <= END_MIDI; pitch += 1) {
        if (!isWhitePitch(pitch)) {
          const previous = keys[pitch - 1];
          if (previous) {
            keys[pitch] = {
              x: previous.x + previous.w - whiteWidth * 0.325,
              w: whiteWidth * 0.65,
              h: keyHeight * 0.65,
              black: true,
            };
          }
        }
      }
      whiteKeys = Object.entries(keys)
        .filter(([, key]) => !key.black)
        .map(([pitch, key]) => [+pitch, key]);
      blackKeys = Object.entries(keys)
        .filter(([, key]) => key.black)
        .map(([pitch, key]) => [+pitch, key]);
      needsRedraw = true;
    };

    const draw = (time: number) => {
      const keyHeight = Math.min(150, height * 0.2);
      const bottom = height - keyHeight;
      const pixelsPerSecond = 180;
      const beatSpacing = pixelsPerSecond * 60 / bpm;
      const gridPosition = time * pixelsPerSecond - gridDelay / 1000 * pixelsPerSecond;
      const beatOffset = ((gridPosition % beatSpacing) + beatSpacing) % beatSpacing;

      context.fillStyle = '#080a0f';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(255,255,255,.055)';
      context.lineWidth = 1;
      context.beginPath();
      whiteKeys.forEach(([, key]) => {
        context.moveTo(key.x, 0);
        context.lineTo(key.x, bottom);
      });
      for (let y = bottom + beatOffset; y > 0; y -= beatSpacing) {
        if (y <= bottom) {
          context.moveTo(0, y);
          context.lineTo(width, y);
        }
      }
      context.stroke();

      const activePitches = new Set<number>();
      let currentFont = '';
      context.textAlign = 'center';
      context.textBaseline = 'bottom';
      const viewEnd = time + bottom / pixelsPerSecond;
      const firstVisible = lowerBound(notesRef.current, time - maxNoteDuration, true);
      const afterLastVisible = lowerBound(notesRef.current, viewEnd, false);
      for (let index = firstVisible; index < afterLastVisible; index += 1) {
        const note = notesRef.current[index];
        const noteEnd = note.start + note.duration;
        const active = time >= note.start && time <= noteEnd;
        if (active) activePitches.add(note.pitch);
        const yBottom = bottom - (note.start - time) * pixelsPerSecond;
        const yTop = yBottom - note.duration * pixelsPerSecond;
        const key = keys[note.pitch];
        if (!key || yBottom < 0 || yTop > bottom) continue;
        const top = Math.max(0, yTop);
        const visibleBottom = Math.min(bottom, yBottom);
        const barHeight = visibleBottom - top;
        if (barHeight <= 0) continue;

        context.fillStyle = note.hand === 'left' ? '#ff6b5f' : '#ffab57';
        context.fillRect(key.x + 2, top, Math.max(1, key.w - 4), barHeight);

        if (time < noteEnd && barHeight >= 12) {
          const label = pitchLabel(note.pitch, labelMode, keySignature);
          const fontSize = Math.max(6, Math.min(9, key.w * 0.72));
          const font = `600 ${fontSize}px 'DM Mono'`;
          if (font !== currentFont) {
            context.font = font;
            currentFont = font;
          }
          context.fillStyle = '#ffffff';
          context.fillText(label, key.x + key.w / 2, visibleBottom - 3, Math.max(6, key.w - 4));
        }
      }

      const chord = recognizeChord(activePitches);
      if (chord !== chordRef.current) {
        chordRef.current = chord;
        onChordChange(chord);
      }

      whiteKeys.forEach(([pitch, key]) => {
        context.fillStyle = activePitches.has(pitch) ? '#ff6b5f' : '#e9ebef';
        context.fillRect(key.x, bottom, key.w, key.h);
        context.strokeStyle = '#15171c';
        context.strokeRect(key.x, bottom, key.w, key.h);
      });
      blackKeys.forEach(([pitch, key]) => {
        context.fillStyle = activePitches.has(pitch) ? '#ff6b5f' : '#1b1e26';
        context.fillRect(key.x, bottom, key.w, key.h);
      });
    };

    let drawRaf = 0;
    let lastFrameTime = 0;
    let lastPlaybackTime = Number.NaN;
    const loop = (frameTime: number) => {
      const playbackTime = getElapsed();
      if (needsRedraw || (frameTime - lastFrameTime >= 15 && playbackTime !== lastPlaybackTime)) {
        draw(playbackTime);
        lastFrameTime = frameTime;
        lastPlaybackTime = playbackTime;
        needsRedraw = false;
      }
      drawRaf = requestAnimationFrame(loop);
    };
    resize();
    window.addEventListener('resize', resize);
    drawRaf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(drawRaf);
      window.removeEventListener('resize', resize);
    };
  }, [bpm, getElapsed, gridDelay, keySignature, labelMode, maxNoteDuration, onChordChange, sortedNotes]);

  return <>
    <canvas ref={canvasRef} />
    <input
      className="roll-scrollbar"
      type="range"
      min="0"
      max={duration}
      step="0.01"
      value={Math.min(elapsed, duration)}
      onChange={event => onSeek(+event.target.value)}
      aria-label="Scroll piano visualizer playback position"
    />
  </>;
}
