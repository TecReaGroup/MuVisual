import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioSource, Note } from '../../../entities/music/model/types';
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

export function usePlayback(
  notes: Note[],
  muted: boolean,
  volume: number,
  audioSource: AudioSource = 'midi',
  audioUrl: string | null = null,
) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const elapsedRef = useRef(0);
  const lastElapsedCommitRef = useRef(0);
  const audioStartRef = useRef(0);
  const pausedRef = useRef(0);
  const preparingRef = useRef(false);
  const startRequestRef = useRef(0);
  const nextNoteIndexRef = useRef(0);
  const playbackRafRef = useRef<number>();
  const mediaRef = useRef<HTMLAudioElement>();
  const toggleRef = useRef<() => void>(() => undefined);
  const { getAudioTime, loadStatus, playNote, prepare, stopAll } = usePianoAudio(muted, volume);
  const sortedNotes = useMemo(() => [...notes].sort((first, second) => first.start - second.start), [notes]);
  const notesRef = useRef(sortedNotes);
  notesRef.current = sortedNotes;
  const midiDuration = useMemo(
    () => notes.reduce((maximum, note) => Math.max(maximum, note.start + note.duration), 0),
    [notes],
  );
  const duration = audioSource === 'midi' ? midiDuration : mediaDuration || midiDuration;

  useEffect(() => {
    if (audioSource === 'midi' || !audioUrl) {
      mediaRef.current?.pause();
      mediaRef.current = undefined;
      setMediaDuration(0);
      return;
    }

    setMediaDuration(0);
    const audio = new Audio(audioUrl);
    audio.preload = 'auto';
    audio.muted = muted;
    audio.volume = volume / 100;
    const updateDuration = () => {
      if (Number.isFinite(audio.duration)) {
        setMediaDuration(audio.duration);
        audio.currentTime = Math.min(pausedRef.current, audio.duration);
      }
    };
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.load();
    mediaRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', updateDuration);
      if (mediaRef.current === audio) mediaRef.current = undefined;
    };
  }, [audioSource, audioUrl]);

  useEffect(() => {
    const audio = mediaRef.current;
    if (!audio) return;
    audio.muted = muted;
    audio.volume = volume / 100;
  }, [muted, volume, audioSource]);

  useEffect(() => {
    startRequestRef.current += 1;
    preparingRef.current = false;
    stopAll();
    mediaRef.current?.pause();
    pausedRef.current = elapsedRef.current;
    nextNoteIndexRef.current = findNoteIndex(notesRef.current, pausedRef.current);
    setElapsed(elapsedRef.current);
    setPlaying(false);
  }, [audioSource, audioUrl, stopAll]);

  useEffect(() => {
    if (!playing) return;

    if (audioSource !== 'midi') {
      const updateMediaPosition = () => {
        const audio = mediaRef.current;
        if (!audio) return;
        const current = audio.currentTime;
        elapsedRef.current = current;
        if (audio.ended) {
          pausedRef.current = duration;
          setElapsed(duration);
          setPlaying(false);
          return;
        }
        const now = performance.now();
        if (now - lastElapsedCommitRef.current >= 100) {
          lastElapsedCommitRef.current = now;
          setElapsed(current);
        }
        playbackRafRef.current = requestAnimationFrame(updateMediaPosition);
      };
      playbackRafRef.current = requestAnimationFrame(updateMediaPosition);
      return () => cancelAnimationFrame(playbackRafRef.current!);
    }

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

    const updateMidiPosition = () => {
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
      playbackRafRef.current = requestAnimationFrame(updateMidiPosition);
    };

    schedule();
    const scheduleInterval = window.setInterval(schedule, SCHEDULE_INTERVAL_MS);
    playbackRafRef.current = requestAnimationFrame(updateMidiPosition);
    return () => {
      window.clearInterval(scheduleInterval);
      cancelAnimationFrame(playbackRafRef.current!);
    };
  }, [audioSource, duration, getAudioTime, playNote, playing]);

  useEffect(() => {
    if (muted) stopAll();
  }, [muted, stopAll]);

  const pause = useCallback(() => {
    startRequestRef.current += 1;
    preparingRef.current = false;
    if (audioSource === 'midi') {
      if (playing) {
        pausedRef.current = Math.min(
          duration,
          pausedRef.current + Math.max(0, getAudioTime() - audioStartRef.current),
        );
      }
      stopAll();
    } else {
      const audio = mediaRef.current;
      if (audio) {
        audio.pause();
        pausedRef.current = audio.currentTime;
      }
    }
    elapsedRef.current = pausedRef.current;
    setElapsed(pausedRef.current);
    setPlaying(false);
  }, [audioSource, duration, getAudioTime, playing, stopAll]);

  const toggle = useCallback(async () => {
    if (playing) {
      pause();
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

    if (audioSource !== 'midi') {
      const audio = mediaRef.current;
      if (!audio) {
        preparingRef.current = false;
        return;
      }
      audio.currentTime = pausedRef.current;
      try {
        await audio.play();
      } catch {
        preparingRef.current = false;
        return;
      }
      if (request !== startRequestRef.current) {
        audio.pause();
        return;
      }
      preparingRef.current = false;
      lastElapsedCommitRef.current = performance.now();
      setPlaying(true);
      return;
    }

    await prepare();
    if (request !== startRequestRef.current) return;
    preparingRef.current = false;
    nextNoteIndexRef.current = findNoteIndex(notesRef.current, pausedRef.current);
    audioStartRef.current = getAudioTime() + PLAYBACK_START_DELAY_SECONDS;
    lastElapsedCommitRef.current = performance.now();
    setPlaying(true);
  }, [audioSource, duration, getAudioTime, pause, playing, prepare]);

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
    if (audioSource === 'midi') {
      audioStartRef.current = getAudioTime() + PLAYBACK_START_DELAY_SECONDS;
    } else if (mediaRef.current) {
      mediaRef.current.currentTime = nextTime;
    }
    setElapsed(nextTime);
  }, [audioSource, duration, getAudioTime, stopAll]);

  const reset = useCallback(() => {
    startRequestRef.current += 1;
    preparingRef.current = false;
    stopAll();
    if (mediaRef.current) {
      mediaRef.current.pause();
      mediaRef.current.currentTime = 0;
    }
    pausedRef.current = 0;
    elapsedRef.current = 0;
    nextNoteIndexRef.current = 0;
    setElapsed(0);
    setPlaying(false);
  }, [stopAll]);

  const getElapsed = useCallback(() => {
    if (audioSource !== 'midi' && mediaRef.current) return mediaRef.current.currentTime;
    return elapsedRef.current;
  }, [audioSource]);

  return { duration, elapsed, getElapsed, loadStatus, pause, playing, reset, seek, toggle };
}
