import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../../../entities/music/model/types';
import { usePianoAudio } from './usePianoAudio';

const SCHEDULE_INTERVAL_MS = 25;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.15;
const PLAYBACK_START_DELAY_SECONDS = 0.06;

function findNoteIndex(notes: Note[], time: number) {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (notes[middle].start < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function usePlayback(notes: Note[], muted: boolean, volume: number) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const lastElapsedCommitRef = useRef(0);
  const audioStartRef = useRef(0);
  const pausedRef = useRef(0);
  const preparingRef = useRef(false);
  const startRequestRef = useRef(0);
  const nextNoteIndexRef = useRef(0);
  const playbackRafRef = useRef<number>();
  const toggleRef = useRef<() => void>(() => undefined);
  const { getAudioTime, loadStatus, playNote, prepare, stopAll } = usePianoAudio(muted, volume);
  const sortedNotes = useMemo(() => [...notes].sort((first, second) => first.start - second.start), [notes]);
  const notesRef = useRef(sortedNotes);
  notesRef.current = sortedNotes;
  const duration = useMemo(
    () => notes.reduce((maximum, note) => Math.max(maximum, note.start + note.duration), 0),
    [notes],
  );

  useEffect(() => {
    if (!playing) return;

    const schedule = () => {
      const audioNow = getAudioTime();
      const timelineNow = pausedRef.current + Math.max(0, audioNow - audioStartRef.current);
      const scheduleThrough = timelineNow + SCHEDULE_LOOKAHEAD_SECONDS;
      while (nextNoteIndexRef.current < notesRef.current.length) {
        const note = notesRef.current[nextNoteIndexRef.current];
        if (note.start > scheduleThrough) break;
        const noteTime = audioStartRef.current + note.start - pausedRef.current;
        playNote(note.pitch, note.duration, Math.max(audioNow, noteTime));
        nextNoteIndexRef.current += 1;
      }
    };

    const updatePosition = () => {
      const now = performance.now();
      const playbackTime = pausedRef.current + Math.max(0, getAudioTime() - audioStartRef.current);
      const current = Math.min(playbackTime, duration);
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
      playbackRafRef.current = requestAnimationFrame(updatePosition);
    };

    schedule();
    const scheduleInterval = window.setInterval(schedule, SCHEDULE_INTERVAL_MS);
    playbackRafRef.current = requestAnimationFrame(updatePosition);
    return () => {
      window.clearInterval(scheduleInterval);
      cancelAnimationFrame(playbackRafRef.current!);
    };
  }, [duration, getAudioTime, playNote, playing]);

  useEffect(() => {
    if (muted) stopAll();
  }, [muted, stopAll]);

  const toggle = useCallback(async () => {
    if (playing) {
      startRequestRef.current += 1;
      pausedRef.current = Math.min(
        duration,
        pausedRef.current + Math.max(0, getAudioTime() - audioStartRef.current),
      );
      elapsedRef.current = pausedRef.current;
      setElapsed(pausedRef.current);
      stopAll();
      setPlaying(false);
      return;
    }

    if (preparingRef.current) {
      startRequestRef.current += 1;
      preparingRef.current = false;
      return;
    }

    if (pausedRef.current >= duration) {
      pausedRef.current = 0;
      elapsedRef.current = 0;
      setElapsed(0);
    }
    const request = ++startRequestRef.current;
    preparingRef.current = true;
    await prepare();
    if (request !== startRequestRef.current) return;
    preparingRef.current = false;
    nextNoteIndexRef.current = findNoteIndex(notesRef.current, pausedRef.current);
    audioStartRef.current = getAudioTime() + PLAYBACK_START_DELAY_SECONDS;
    lastElapsedCommitRef.current = performance.now();
    setPlaying(true);
  }, [duration, getAudioTime, playing, prepare, stopAll]);

  toggleRef.current = toggle;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const isTextEntry = target?.matches([
        'textarea',
        '[contenteditable="true"]',
        'input:not([type])',
        'input[type="text"]',
        'input[type="search"]',
        'input[type="email"]',
        'input[type="password"]',
        'input[type="url"]',
        'input[type="tel"]',
        'input[type="number"]',
      ].join(','));
      if (isTextEntry) return;
      event.preventDefault();
      event.stopPropagation();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const seek = useCallback((time: number) => {
    const nextTime = Math.max(0, Math.min(duration, time));
    stopAll();
    pausedRef.current = nextTime;
    elapsedRef.current = nextTime;
    nextNoteIndexRef.current = findNoteIndex(notesRef.current, nextTime);
    audioStartRef.current = getAudioTime() + PLAYBACK_START_DELAY_SECONDS;
    setElapsed(nextTime);
  }, [duration, getAudioTime, stopAll]);

  const reset = useCallback(() => {
    startRequestRef.current += 1;
    preparingRef.current = false;
    stopAll();
    pausedRef.current = 0;
    elapsedRef.current = 0;
    nextNoteIndexRef.current = 0;
    setElapsed(0);
    setPlaying(false);
  }, [stopAll]);

  const getElapsed = useCallback(() => elapsedRef.current, []);

  return { duration, elapsed, getElapsed, loadStatus, playing, reset, seek, toggle };
}
