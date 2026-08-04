import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, TimedNote } from '../../../entities/music/model/types';
import { usePianoAudio } from './usePianoAudio';

export function usePlayback(notes: Note[], muted: boolean, volume: number) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const lastElapsedCommitRef = useRef(0);
  const startRef = useRef(0);
  const pausedRef = useRef(0);
  const playbackRafRef = useRef<number>();
  const toggleRef = useRef<() => void>(() => undefined);
  const { playNote, prepare } = usePianoAudio(muted, volume);
  const timedNotes = useMemo<TimedNote[]>(
    () => notes.map(note => ({ ...note, played: note.start < pausedRef.current })),
    [notes],
  );
  const notesRef = useRef(timedNotes);
  notesRef.current = timedNotes;
  const duration = Math.max(0, ...notes.map(note => note.start + note.duration));

  useEffect(() => {
    if (!playing) return;
    const loop = () => {
      const now = performance.now();
      const playbackTime = pausedRef.current + (now - startRef.current) / 1000;
      const current = Math.min(playbackTime, duration);
      notesRef.current.forEach(note => {
        if (!note.played && current >= note.start) {
          note.played = true;
          playNote(note.pitch, note.duration);
        }
      });
      elapsedRef.current = current;
      if (playbackTime >= duration) {
        pausedRef.current = duration;
        setElapsed(current);
        setPlaying(false);
        return;
      }
      if (now - lastElapsedCommitRef.current >= 100) {
        lastElapsedCommitRef.current = now;
        setElapsed(current);
      }
      playbackRafRef.current = requestAnimationFrame(loop);
    };

    playbackRafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(playbackRafRef.current!);
  }, [duration, playNote, playing]);

  const toggle = useCallback(() => {
    if (playing) {
      pausedRef.current = Math.min(
        duration,
        pausedRef.current + (performance.now() - startRef.current) / 1000,
      );
      elapsedRef.current = pausedRef.current;
      setElapsed(pausedRef.current);
      setPlaying(false);
      return;
    }

    if (pausedRef.current >= duration) {
      pausedRef.current = 0;
      elapsedRef.current = 0;
      setElapsed(0);
      notesRef.current.forEach(note => { note.played = false; });
    }
    prepare();
    startRef.current = performance.now();
    lastElapsedCommitRef.current = startRef.current;
    setPlaying(true);
  }, [duration, playing, prepare]);

  toggleRef.current = toggle;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, select, textarea, button, [contenteditable="true"]')) return;
      event.preventDefault();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const seek = useCallback((time: number) => {
    pausedRef.current = time;
    elapsedRef.current = time;
    startRef.current = performance.now();
    setElapsed(time);
    notesRef.current.forEach(note => { note.played = note.start < time; });
  }, []);

  const reset = useCallback(() => {
    pausedRef.current = 0;
    elapsedRef.current = 0;
    setElapsed(0);
    setPlaying(false);
    notesRef.current.forEach(note => { note.played = false; });
  }, []);

  const getElapsed = useCallback(() => elapsedRef.current, []);

  return { duration, elapsed, getElapsed, playing, reset, seek, toggle };
}
