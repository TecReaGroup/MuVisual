import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioSource, Instrument, Note } from '../../../entities/music/model/types';
import { usePianoAudio } from './usePianoAudio';

const SCHEDULE_INTERVAL_MS = 25;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.15;
const START_LEAD_SECONDS = 0.1;
const SEEK_SETTLE_MS = 80;

type MediaKind = 'original' | 'instrument';
type MediaBuffers = Partial<Record<MediaKind, AudioBuffer>>;
type MediaSources = Partial<Record<MediaKind, AudioBufferSourceNode>>;
type MediaGains = Partial<Record<MediaKind, GainNode>>;

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
  instrument: Instrument = 'piano',
  audioUrls: { original: string | null; instrument: string | null } = { original: null, instrument: null },
) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const elapsedRef = useRef(0);
  const lastElapsedCommitRef = useRef(0);
  const transportStartAudioTimeRef = useRef(0);
  const pausedRef = useRef(0);
  const preparingRef = useRef(false);
  const startRequestRef = useRef(0);
  const nextNoteIndexRef = useRef(0);
  const playbackRafRef = useRef<number>();
  const seekActiveRef = useRef(false);
  const seekRequestRef = useRef(0);
  const seekTimerRef = useRef<number>();
  const resumeAfterSeekRef = useRef(false);
  const toggleRef = useRef<() => void>(() => undefined);
  const mediaBuffersRef = useRef<MediaBuffers>({});
  const mediaSourcesRef = useRef<MediaSources>({});
  const mediaGainsRef = useRef<MediaGains>({});
  const mediaLoadRef = useRef<Promise<void>>(Promise.resolve());
  const midiMuted = muted || audioSource !== 'midi';
  const midiTimbre = instrument === 'piano' ? 'piano' : 'string';
  const { getAudioContext, getAudioTime, loadStatus, playNote, prepare, stopAll } = usePianoAudio(midiMuted, volume, midiTimbre);
  const sortedNotes = useMemo(() => [...notes].sort((first, second) => first.start - second.start), [notes]);
  const notesRef = useRef(sortedNotes);
  notesRef.current = sortedNotes;
  const midiDuration = useMemo(
    () => notes.reduce((maximum, note) => Math.max(maximum, note.start + note.duration), 0),
    [notes],
  );
  const duration = Math.max(midiDuration, mediaDuration);

  const ensureMediaGains = useCallback(() => {
    const context = getAudioContext();
    (['original', 'instrument'] as MediaKind[]).forEach(kind => {
      if (mediaGainsRef.current[kind]) return;
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
      mediaGainsRef.current[kind] = gain;
    });
  }, [getAudioContext]);

  const stopMedia = useCallback(() => {
    Object.values(mediaSourcesRef.current).forEach(source => {
      try {
        source.stop();
      } catch {
        // A source may already have ended.
      }
      source.disconnect();
    });
    mediaSourcesRef.current = {};
  }, []);

  const startMedia = useCallback((when: number, offset: number) => {
    stopMedia();
    ensureMediaGains();
    const context = getAudioContext();
    (Object.entries(mediaBuffersRef.current) as Array<[MediaKind, AudioBuffer]>).forEach(([kind, buffer]) => {
      if (offset >= buffer.duration) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(mediaGainsRef.current[kind]!);
      source.start(when, offset);
      mediaSourcesRef.current[kind] = source;
    });
  }, [ensureMediaGains, getAudioContext, stopMedia]);

  const getTimelineTime = useCallback(() => {
    return Math.max(0, getAudioTime() - transportStartAudioTimeRef.current);
  }, [getAudioTime]);

  useEffect(() => {
    ensureMediaGains();
    const context = getAudioContext();
    const now = context.currentTime;
    (['original', 'instrument'] as MediaKind[]).forEach(kind => {
      const gain = mediaGainsRef.current[kind];
      if (!gain) return;
      const enabled = !muted && audioSource === kind;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(enabled ? volume / 100 : 0, now, 0.008);
    });
  }, [audioSource, ensureMediaGains, getAudioContext, muted, volume]);

  useEffect(() => {
    const context = getAudioContext();
    const controller = new AbortController();
    const entries: Array<[MediaKind, string | null]> = [
      ['original', audioUrls.original],
      ['instrument', audioUrls.instrument],
    ];
    mediaBuffersRef.current = {};
    setMediaDuration(0);
    const load = Promise.all(entries.map(async ([kind, url]) => {
      if (!url) return;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Unable to load ${kind} audio`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (!controller.signal.aborted) mediaBuffersRef.current[kind] = buffer;
    })).then(() => {
      if (controller.signal.aborted) return;
      const buffers = Object.values(mediaBuffersRef.current);
      setMediaDuration(buffers.reduce((maximum, buffer) => Math.max(maximum, buffer?.duration ?? 0), 0));
    }).catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error(error);
    });
    mediaLoadRef.current = load;

    return () => {
      controller.abort();
      stopMedia();
    };
  }, [audioUrls.instrument, audioUrls.original, getAudioContext, stopMedia]);

  useEffect(() => {
    if (!playing) return;

    const schedule = () => {
      const audioNow = getAudioTime();
      const timelineNow = getTimelineTime();
      const scheduleThrough = timelineNow + SCHEDULE_LOOKAHEAD_SECONDS;
      while (nextNoteIndexRef.current < notesRef.current.length) {
        const note = notesRef.current[nextNoteIndexRef.current];
        if (note.start > scheduleThrough) break;
        const noteTime = transportStartAudioTimeRef.current + note.start;
        playNote(note.pitch, note.duration, Math.max(audioNow, noteTime));
        nextNoteIndexRef.current += 1;
      }
    };

    const updatePosition = () => {
      const now = performance.now();
      const playbackTime = getTimelineTime();
      const current = Math.min(playbackTime, duration);
      elapsedRef.current = current;
      if (playbackTime >= duration) {
        stopAll();
        stopMedia();
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
  }, [duration, getAudioTime, getTimelineTime, playNote, playing, stopAll, stopMedia]);

  const pause = useCallback(() => {
    startRequestRef.current += 1;
    seekRequestRef.current += 1;
    window.clearTimeout(seekTimerRef.current);
    seekActiveRef.current = false;
    resumeAfterSeekRef.current = false;
    preparingRef.current = false;
    if (playing) pausedRef.current = Math.min(duration, getTimelineTime());
    stopAll();
    stopMedia();
    elapsedRef.current = pausedRef.current;
    setElapsed(pausedRef.current);
    setPlaying(false);
  }, [duration, getTimelineTime, playing, stopAll, stopMedia]);

  const startAt = useCallback((position: number) => {
    const when = getAudioTime() + START_LEAD_SECONDS;
    transportStartAudioTimeRef.current = when - position;
    nextNoteIndexRef.current = findNoteIndex(notesRef.current, position);
    startMedia(when, position);
    lastElapsedCommitRef.current = performance.now();
    setPlaying(true);
  }, [getAudioTime, startMedia]);

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
    await Promise.all([prepare(), mediaLoadRef.current]);
    if (request !== startRequestRef.current) return;
    preparingRef.current = false;
    startAt(pausedRef.current);
  }, [duration, pause, playing, prepare, startAt]);

  toggleRef.current = toggle;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const isTextEntry = target?.matches([
        'textarea', '[contenteditable="true"]', 'input:not([type])', 'input[type="text"]',
        'input[type="search"]', 'input[type="email"]', 'input[type="password"]',
        'input[type="url"]', 'input[type="tel"]', 'input[type="number"]',
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
    if (!seekActiveRef.current) {
      seekActiveRef.current = true;
      resumeAfterSeekRef.current = playing;
    }
    const request = ++seekRequestRef.current;
    window.clearTimeout(seekTimerRef.current);
    startRequestRef.current += 1;
    preparingRef.current = false;
    stopAll();
    stopMedia();
    pausedRef.current = nextTime;
    elapsedRef.current = nextTime;
    nextNoteIndexRef.current = findNoteIndex(notesRef.current, nextTime);
    setElapsed(nextTime);
    setPlaying(false);

    seekTimerRef.current = window.setTimeout(() => {
      seekTimerRef.current = undefined;
      void mediaLoadRef.current.then(() => {
        if (request !== seekRequestRef.current) return;
        seekActiveRef.current = false;
        transportStartAudioTimeRef.current = getAudioTime() - nextTime;
        if (!resumeAfterSeekRef.current) return;
        resumeAfterSeekRef.current = false;
        startAt(nextTime);
      });
    }, SEEK_SETTLE_MS);
  }, [duration, getAudioTime, playing, startAt, stopAll, stopMedia]);

  const reset = useCallback(() => {
    startRequestRef.current += 1;
    seekRequestRef.current += 1;
    window.clearTimeout(seekTimerRef.current);
    seekTimerRef.current = undefined;
    seekActiveRef.current = false;
    resumeAfterSeekRef.current = false;
    preparingRef.current = false;
    stopAll();
    stopMedia();
    pausedRef.current = 0;
    elapsedRef.current = 0;
    nextNoteIndexRef.current = 0;
    setElapsed(0);
    setPlaying(false);
  }, [stopAll, stopMedia]);

  useEffect(() => () => {
    window.clearTimeout(seekTimerRef.current);
    stopMedia();
    Object.values(mediaGainsRef.current).forEach(gain => gain?.disconnect());
    mediaGainsRef.current = {};
  }, [stopMedia]);

  const getElapsed = useCallback(() => {
    return playing ? getTimelineTime() : elapsedRef.current;
  }, [getTimelineTime, playing]);

  return { duration, elapsed, getElapsed, loadStatus, pause, playing, reset, seek, toggle };
}
