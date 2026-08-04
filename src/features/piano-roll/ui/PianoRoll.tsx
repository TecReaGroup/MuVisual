import { useEffect, useRef } from 'react';
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
  const notesRef = useRef(notes);
  const chordRef = useRef<string | null>(null);
  notesRef.current = notes;

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

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = devicePixelRatio || 1;
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
      Object.values(keys).filter(key => !key.black).forEach(key => {
        context.beginPath();
        context.moveTo(key.x, 0);
        context.lineTo(key.x, bottom);
        context.stroke();
      });
      for (let y = bottom + beatOffset; y > 0; y -= beatSpacing) {
        if (y <= bottom) {
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(width, y);
          context.stroke();
        }
      }

      const activePitches = new Set<number>();
      notesRef.current.forEach(note => {
        const noteEnd = note.start + note.duration;
        const active = time >= note.start && time <= noteEnd;
        if (active) activePitches.add(note.pitch);
        const yBottom = bottom - (note.start - time) * pixelsPerSecond;
        const yTop = yBottom - note.duration * pixelsPerSecond;
        const key = keys[note.pitch];
        if (!key || yBottom < 0 || yTop > bottom) return;
        const top = Math.max(0, yTop);
        const visibleBottom = Math.min(bottom, yBottom);
        const barHeight = visibleBottom - top;
        if (barHeight <= 0) return;

        context.fillStyle = note.hand === 'left' ? '#ff6b5f' : '#ffab57';
        context.shadowBlur = active ? 20 : 8;
        context.shadowColor = context.fillStyle;
        context.beginPath();
        context.roundRect(key.x + 2, top, key.w - 4, barHeight, 4);
        context.fill();
        context.shadowBlur = 0;

        if (time < noteEnd) {
          const label = pitchLabel(note.pitch, labelMode, keySignature);
          const fontSize = Math.max(6, Math.min(9, key.w * 0.72));
          context.font = `600 ${fontSize}px 'DM Mono'`;
          context.textAlign = 'center';
          context.textBaseline = 'bottom';
          context.fillStyle = '#ffffff';
          context.shadowColor = 'rgba(8,10,15,.75)';
          context.shadowBlur = 2;
          context.fillText(label, key.x + key.w / 2, visibleBottom - 3, Math.max(6, key.w - 4));
          context.shadowBlur = 0;
        }
      });

      const chord = recognizeChord(activePitches);
      if (chord !== chordRef.current) {
        chordRef.current = chord;
        onChordChange(chord);
      }

      Object.entries(keys).filter(([, key]) => !key.black).forEach(([pitch, key]) => {
        context.fillStyle = activePitches.has(+pitch) ? '#ff6b5f' : '#e9ebef';
        context.fillRect(key.x, bottom, key.w, key.h);
        context.strokeStyle = '#15171c';
        context.strokeRect(key.x, bottom, key.w, key.h);
      });
      Object.entries(keys).filter(([, key]) => key.black).forEach(([pitch, key]) => {
        context.fillStyle = activePitches.has(+pitch) ? '#ff6b5f' : '#1b1e26';
        context.fillRect(key.x, bottom, key.w, key.h);
      });
    };

    let drawRaf = 0;
    const loop = () => {
      draw(getElapsed());
      drawRaf = requestAnimationFrame(loop);
    };
    resize();
    window.addEventListener('resize', resize);
    loop();
    return () => {
      cancelAnimationFrame(drawRaf);
      window.removeEventListener('resize', resize);
    };
  }, [bpm, getElapsed, gridDelay, keySignature, labelMode, onChordChange]);

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
