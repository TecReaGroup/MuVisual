import { memo, useEffect, useMemo, useRef } from 'react';
import { END_MIDI, isWhitePitch, numberForPitch, PITCH_NAMES, START_MIDI } from '../../../entities/music/lib/pitch';
import type { MusicalTimeline } from '../../../entities/music/lib/musicalTimeline';
import type { LabelMode, Note } from '../../../entities/music/model/types';
import { useI18n } from '../../../shared/i18n';
import { recognizeChord } from '../model/recognizeChord';

const DRAW_FRAME_INTERVAL_MS = 1000 / 120;

type PianoKey = { x: number; w: number; h: number; black: boolean };

type PianoRollProps = {
  duration: number;
  getElapsed: () => number;
  keySignature: string;
  labelMode: LabelMode;
  notes: Note[];
  timeline: MusicalTimeline;
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

export const PianoRoll = memo(function PianoRoll({
  duration,
  getElapsed,
  keySignature,
  labelMode,
  notes,
  timeline,
  onChordChange,
  onSeek,
}: PianoRollProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollbarRef = useRef<HTMLInputElement>(null);
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
    let activePitchSignature = '';

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
      const viewEnd = time + bottom / pixelsPerSecond;

      context.fillStyle = '#080a0f';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(255,255,255,.055)';
      context.lineWidth = 1;
      context.beginPath();
      whiteKeys.forEach(([, key]) => {
        context.moveTo(key.x, 0);
        context.lineTo(key.x, bottom);
      });
      context.stroke();

      const gridLines = timeline.gridLines(time, viewEnd, 4);
      const drawGridLines = (
        matches: (line: (typeof gridLines)[number]) => boolean,
        strokeStyle: string,
        lineWidth: number,
      ) => {
        context.strokeStyle = strokeStyle;
        context.lineWidth = lineWidth;
        context.beginPath();
        gridLines.forEach(line => {
          if (!matches(line)) return;
          const y = bottom - (line.time - time) * pixelsPerSecond;
          context.moveTo(0, y);
          context.lineTo(width, y);
        });
        context.stroke();
      };
      drawGridLines(line => line.subdivision !== 0, 'rgba(255,255,255,.035)', 1);
      drawGridLines(line => line.subdivision === 0 && !line.downbeat, 'rgba(255,255,255,.11)', 1);
      drawGridLines(line => line.downbeat, 'rgba(255,107,95,.30)', 1.5);

      const activePitches = new Set<number>();
      let currentFont = '';
      context.textAlign = 'center';
      context.textBaseline = 'bottom';
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

      const nextActivePitchSignature = [...activePitches].sort((first, second) => first - second).join(',');
      if (nextActivePitchSignature !== activePitchSignature) {
        activePitchSignature = nextActivePitchSignature;
        const chord = recognizeChord(activePitches);
        if (chord !== chordRef.current) {
          chordRef.current = chord;
          onChordChange(chord);
        }
      }

      context.beginPath();
      whiteKeys.forEach(([pitch, key]) => {
        context.fillStyle = activePitches.has(pitch) ? '#ff6b5f' : '#e9ebef';
        context.fillRect(key.x, bottom, key.w, key.h);
        context.rect(key.x, bottom, key.w, key.h);
      });
      context.strokeStyle = '#15171c';
      context.lineWidth = 1;
      context.stroke();
      blackKeys.forEach(([pitch, key]) => {
        context.fillStyle = activePitches.has(pitch) ? '#ff6b5f' : '#1b1e26';
        context.fillRect(key.x, bottom, key.w, key.h);
      });
    };

    let drawRaf = 0;
    let lastFrameTime = 0;
    let lastPlaybackTime = Number.NaN;
    let lastScrollbarUpdateTime = 0;
    const loop = (frameTime: number) => {
      const playbackTime = getElapsed();
      const timeSinceLastFrame = frameTime - lastFrameTime;
      if (needsRedraw || (timeSinceLastFrame >= DRAW_FRAME_INTERVAL_MS && playbackTime !== lastPlaybackTime)) {
        draw(playbackTime);
        lastFrameTime = needsRedraw
          ? frameTime
          : frameTime - timeSinceLastFrame % DRAW_FRAME_INTERVAL_MS;
        lastPlaybackTime = playbackTime;
        needsRedraw = false;
      }
      if (frameTime - lastScrollbarUpdateTime >= 100 && scrollbarRef.current) {
        scrollbarRef.current.value = String(Math.min(playbackTime, duration));
        lastScrollbarUpdateTime = frameTime;
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
  }, [duration, getElapsed, keySignature, labelMode, maxNoteDuration, onChordChange, sortedNotes, timeline]);

  return <>
    <canvas ref={canvasRef} />
    <input
      ref={scrollbarRef}
      className="roll-scrollbar"
      type="range"
      min="0"
      max={duration}
      step="0.01"
      defaultValue="0"
      onChange={event => onSeek(+event.target.value)}
      aria-label={t('pianoRoll.scroll')}
    />
  </>;
});
