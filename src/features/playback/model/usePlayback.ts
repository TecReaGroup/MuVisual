import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioSource, MidiInstrument, Note } from '../../../entities/music/model/types';
import { usePianoAudio } from './usePianoAudio';

const SCHEDULE_INTERVAL_MS = 25;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.15;

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
  midiInstrument: MidiInstrument = 'piano',
  audioUrls: { original: string | null; piano: string | null } = { original: null, piano: null },
) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const elapsedRef = useRef(0);
  const lastElapsedCommitRef = useRef(0);
  const timelineStartRef = useRef(0);
  const pausedRef = useRef(0);
  const preparingRef = useRef(false);
  const startRequestRef = useRef(0);
  const nextNoteIndexRef = useRef(0);
  const playbackRafRef = useRef<number>();
  const lastMediaSyncRef = useRef(0);
  const toggleRef = useRef<() => void>(() => undefined);
  const midiMuted = muted || audioSource !== 'midi';
  const { getAudioTime, loadStatus, playNote, prepare, stopAll } = usePianoAudio(midiMuted, volume, midiInstrument);
  const sortedNotes = useMemo(() => [...notes].sort((first, second) => first.start - second.start), [notes]);
  const notesRef = useRef(sortedNotes);
  notesRef.current = sortedNotes;
  const midiDuration = useMemo(
    () => notes.reduce((maximum, note) => Math.max(maximum, note.start + note.duration), 0),
    [notes],
  );
  const duration = Math.max(midiDuration, mediaDuration);
  const mediaRefs = useRef<Record<'original' | 'piano', HTMLAudioElement | undefined>>({ original: undefined, piano: undefined });
  const getMasterAudio = useCallback(() => {
    if (audioSource === 'original') return mediaRefs.current.original;
    if (audioSource === 'piano') return mediaRefs.current.piano;
    return undefined;
  }, [audioSource]);
  const getTimelineTime = useCallback(() => {
    const masterAudio = getMasterAudio();
    return masterAudio && !masterAudio.paused
      ? masterAudio.currentTime
      : Math.max(0, performance.now() / 1000 - timelineStartRef.current);
  }, [getMasterAudio]);

  useEffect(() => {
    setMediaDuration(0);
    const entries: Array<['original' | 'piano', string | null]> = [
      ['original', audioUrls.original],
      ['piano', audioUrls.piano],
    ];
    const audios = entries.map(([kind, url]) => {
      if (!url) return null;
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.muted = true;
      audio.volume = volume / 100;
      const updateDuration = () => {
        if (Number.isFinite(audio.duration)) setMediaDuration(current => Math.max(current, audio.duration));
      };
      audio.addEventListener('loadedmetadata', updateDuration);
      audio.load();
      mediaRefs.current[kind] = audio;
      return { audio, updateDuration };
    }).filter(Boolean) as Array<{ audio: HTMLAudioElement; updateDuration: () => void }>;

    return () => {
      audios.forEach(({ audio, updateDuration }) => {
        audio.pause();
        audio.removeEventListener('loadedmetadata', updateDuration);
      });
      mediaRefs.current = { original: undefined, piano: undefined };
    };
  }, [audioUrls.original, audioUrls.piano]);

  useEffect(() => {
    (Object.entries(mediaRefs.current) as Array<['original' | 'piano', HTMLAudioElement | undefined]>).forEach(([kind, audio]) => {
      if (!audio) return;
      audio.muted = muted || !['original', 'piano'].includes(audioSource) || kind !== audioSource;
      audio.volume = volume / 100;
    });
  }, [audioSource, muted, volume, mediaDuration]);

  useEffect(() => {
    if (!playing) return;

    const schedule = () => {
      const audioNow = getAudioTime();
      const timelineNow = getTimelineTime();
      const scheduleThrough = timelineNow + SCHEDULE_LOOKAHEAD_SECONDS;
      while (nextNoteIndexRef.current < notesRef.current.length) {
        const note = notesRef.current[nextNoteIndexRef.current];
        if (note.start > scheduleThrough) break;
        const noteTime = audioNow + Math.max(0, note.start - timelineNow);
        playNote(note.pitch, note.duration, Math.max(audioNow, noteTime));
        nextNoteIndexRef.current += 1;
      }
    };

    const updateMidiPosition = () => {
      const now = performance.now();
      const masterAudio = getMasterAudio();
      if (masterAudio && !masterAudio.paused && now - lastMediaSyncRef.current >= 1000) {
        Object.values(mediaRefs.current).forEach(audio => {
          if (audio && audio !== masterAudio && audio.muted && !audio.paused && Math.abs(audio.currentTime - masterAudio.currentTime) > 0.15) {
            audio.currentTime = masterAudio.currentTime;
          }
        });
        lastMediaSyncRef.current = now;
      }
      const playbackTime = getTimelineTime();
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
  }, [duration, getAudioTime, getMasterAudio, getTimelineTime, playNote, playing]);

  const pause = useCallback(() => {
    startRequestRef.current += 1;
    preparingRef.current = false;
    if (playing) {
      pausedRef.current = Math.min(duration, getTimelineTime());
    }
    stopAll();
    Object.values(mediaRefs.current).forEach(audio => audio?.pause());
    elapsedRef.current = pausedRef.current;
    setElapsed(pausedRef.current);
    setPlaying(false);
  }, [duration, getTimelineTime, playing, stopAll]);

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

    Object.values(mediaRefs.current).forEach(audio => {
      if (!audio) return;
      audio.currentTime = pausedRef.current;
      void audio.play().catch(() => undefined);
    });
    await prepare();
    if (request !== startRequestRef.current) return;
    preparingRef.current = false;
    timelineStartRef.current = performance.now() / 1000 - pausedRef.current;
    nextNoteIndexRef.current = findNoteIndex(notesRef.current, getTimelineTime());
    lastElapsedCommitRef.current = performance.now();
    setPlaying(true);
  }, [duration, getTimelineTime, pause, playing, prepare]);

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
    timelineStartRef.current = performance.now() / 1000 - nextTime;
    Object.values(mediaRefs.current).forEach(audio => {
      if (audio) audio.currentTime = nextTime;
    });
    setElapsed(nextTime);
  }, [duration, stopAll]);

  const reset = useCallback(() => {
    startRequestRef.current += 1;
    preparingRef.current = false;
    stopAll();
    Object.values(mediaRefs.current).forEach(audio => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    });
    pausedRef.current = 0;
    elapsedRef.current = 0;
    nextNoteIndexRef.current = 0;
    setElapsed(0);
    setPlaying(false);
  }, [stopAll]);

  const getElapsed = useCallback(() => {
    return playing ? getTimelineTime() : elapsedRef.current;
  }, [getTimelineTime, playing]);

  return { duration, elapsed, getElapsed, loadStatus, pause, playing, reset, seek, toggle };
}
