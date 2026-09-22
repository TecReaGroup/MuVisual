import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioSource, Instrument, Note } from '../../../entities/music/model/types';
import { fetchMusicResource } from '../../../shared/lib/fetchMusicResource';
import { log, serializeError } from '../../../shared/lib/logger';
import { usePianoAudio } from './usePianoAudio';

const SCHEDULE_INTERVAL_MS = 25;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.15;
const START_LEAD_SECONDS = 0.1;
const SEEK_SETTLE_MS = 80;

type MediaKind = 'original' | 'instrument';
type MediaBuffers = Partial<Record<MediaKind, AudioBuffer>>;
type MediaSources = Partial<Record<MediaKind, AudioBufferSourceNode>>;
type MediaGains = Partial<Record<MediaKind, GainNode>>;
type LoadStatus = 'loading' | 'ready' | 'error';
type MediaLoadState = { key: string; status: LoadStatus };

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
  midiLoadStatus: LoadStatus = 'ready',
) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const allAudioUrls = useMemo(
    () => [...new Set([audioUrls.original, audioUrls.instrument].filter((url): url is string => Boolean(url)))].sort(),
    [audioUrls.instrument, audioUrls.original],
  );
  const mediaLoadKey = allAudioUrls.join('\n');
  const [mediaLoadState, setMediaLoadState] = useState<MediaLoadState>(() => ({
    key: mediaLoadKey,
    status: allAudioUrls.length ? 'loading' : 'ready',
  }));
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
  const resourceBuffersRef = useRef(new Map<string, AudioBuffer>());
  const mediaSourcesRef = useRef<MediaSources>({});
  const mediaGainsRef = useRef<MediaGains>({});
  const mediaLoadRef = useRef<Promise<void>>(Promise.resolve());
  const midiMuted = muted || audioSource !== 'midi';
  const { getAudioContext, getAudioTime, getOutputTime, loadStatus: timbreLoadStatus, loadTimbre, playNote, prepare, stopAll } = usePianoAudio(midiMuted, volume, instrument);
  const sortedNotes = useMemo(() => [...notes].sort((first, second) => first.start - second.start), [notes]);
  const notesRef = useRef(sortedNotes);
  notesRef.current = sortedNotes;
  const midiDuration = useMemo(
    () => notes.reduce((maximum, note) => Math.max(maximum, note.start + note.duration), 0),
    [notes],
  );
  const duration = Math.max(midiDuration, mediaDuration);
  const mediaLoadStatus = mediaLoadState.key === mediaLoadKey ? mediaLoadState.status : 'loading';
  const loadStatus: LoadStatus = timbreLoadStatus === 'error' || mediaLoadStatus === 'error' || midiLoadStatus === 'error'
    ? 'error'
    : timbreLoadStatus === 'ready' && mediaLoadStatus === 'ready' && midiLoadStatus === 'ready' ? 'ready' : 'loading';

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

  const getOutputPosition = useCallback(() => {
    // Hold the start position during pre-roll and ignore backward output-clock corrections.
    const position = Math.min(duration, Math.max(
      elapsedRef.current,
      getOutputTime() - transportStartAudioTimeRef.current,
    ));
    elapsedRef.current = position;
    return position;
  }, [duration, getOutputTime]);

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
    mediaBuffersRef.current = {};
    setMediaDuration(0);
    setMediaLoadState({ key: mediaLoadKey, status: allAudioUrls.length ? 'loading' : 'ready' });
    const load = Promise.all(allAudioUrls.map(async url => {
      if (resourceBuffersRef.current.has(url)) return;
      const resourceBytes = await fetchMusicResource(url, controller.signal);
      if (controller.signal.aborted) return;
      const buffer = await context.decodeAudioData(resourceBytes);
      if (controller.signal.aborted) return;
      resourceBuffersRef.current.set(url, buffer);
    })).then(() => {
      if (controller.signal.aborted) return;
      setMediaLoadState({ key: mediaLoadKey, status: 'ready' });
    }).catch(error => {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      log('error', 'Playback', '音频资源加载失败', serializeError(error));
      setMediaLoadState({ key: mediaLoadKey, status: 'error' });
    });
    mediaLoadRef.current = load;

    return () => {
      controller.abort();
      stopMedia();
    };
  }, [getAudioContext, mediaLoadKey, stopMedia]);

  useEffect(() => {
    if (mediaLoadStatus !== 'ready') return;
    mediaBuffersRef.current = {};
    if (audioUrls.original) mediaBuffersRef.current.original = resourceBuffersRef.current.get(audioUrls.original);
    if (audioUrls.instrument) mediaBuffersRef.current.instrument = resourceBuffersRef.current.get(audioUrls.instrument);
    const buffers = Object.values(mediaBuffersRef.current);
    setMediaDuration(buffers.reduce((maximum, buffer) => Math.max(maximum, buffer?.duration ?? 0), 0));
  }, [audioUrls.instrument, audioUrls.original, mediaLoadStatus]);

  const scheduleMidiNotes = useCallback((timelineTime = getTimelineTime()) => {
    const audioNow = getAudioTime();
    const scheduleThrough = timelineTime + SCHEDULE_LOOKAHEAD_SECONDS;
    while (nextNoteIndexRef.current < notesRef.current.length) {
      const note = notesRef.current[nextNoteIndexRef.current];
      if (note.start > scheduleThrough) break;
      const noteTime = transportStartAudioTimeRef.current + note.start;
      playNote(note, Math.max(audioNow, noteTime));
      nextNoteIndexRef.current += 1;
    }
  }, [getAudioTime, getTimelineTime, playNote]);

  useEffect(() => {
    if (!playing) return;

    const updatePosition = () => {
      const now = performance.now();
      const current = getOutputPosition();
      if (current >= duration) {
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

    scheduleMidiNotes();
    const scheduleInterval = window.setInterval(scheduleMidiNotes, SCHEDULE_INTERVAL_MS);
    playbackRafRef.current = requestAnimationFrame(updatePosition);
    return () => {
      window.clearInterval(scheduleInterval);
      cancelAnimationFrame(playbackRafRef.current!);
    };
  }, [duration, getOutputPosition, playing, scheduleMidiNotes, stopAll, stopMedia]);

  const pause = useCallback(() => {
    startRequestRef.current += 1;
    seekRequestRef.current += 1;
    window.clearTimeout(seekTimerRef.current);
    seekActiveRef.current = false;
    resumeAfterSeekRef.current = false;
    preparingRef.current = false;
    if (playing) pausedRef.current = getOutputPosition();
    stopAll();
    stopMedia();
    elapsedRef.current = pausedRef.current;
    setElapsed(pausedRef.current);
    setPlaying(false);
  }, [getOutputPosition, playing, stopAll, stopMedia]);

  const startAt = useCallback((position: number) => {
    const when = getAudioTime() + START_LEAD_SECONDS;
    transportStartAudioTimeRef.current = when - position;
    elapsedRef.current = position;
    pausedRef.current = position;
    nextNoteIndexRef.current = findNoteIndex(notesRef.current, position);
    startMedia(when, position);
    scheduleMidiNotes(position);
    lastElapsedCommitRef.current = performance.now();
    setPlaying(true);
  }, [getAudioTime, scheduleMidiNotes, startMedia]);

  const toggle = useCallback(async () => {
    if (playing) {
      pause();
      return;
    }
    if (midiLoadStatus !== 'ready' || mediaLoadStatus !== 'ready' || timbreLoadStatus === 'loading') return;
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
    let timbreReady: boolean;
    try {
      [timbreReady] = await Promise.all([prepare(), mediaLoadRef.current]);
    } catch {
      if (request === startRequestRef.current) preparingRef.current = false;
      return;
    }
    if (request !== startRequestRef.current) return;
    preparingRef.current = false;
    if (!timbreReady) return;
    startAt(pausedRef.current);
  }, [duration, midiLoadStatus, mediaLoadStatus, timbreLoadStatus, pause, playing, prepare, startAt]);

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
    if (timbreLoadStatus === 'error') void loadTimbre();
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
  }, [loadTimbre, stopAll, stopMedia, timbreLoadStatus]);

  useEffect(() => () => {
    startRequestRef.current += 1;
    seekRequestRef.current += 1;
    preparingRef.current = false;
    window.clearTimeout(seekTimerRef.current);
  }, [instrument]);

  useEffect(() => () => {
    startRequestRef.current += 1;
    seekRequestRef.current += 1;
    window.clearTimeout(seekTimerRef.current);
    stopMedia();
    Object.values(mediaGainsRef.current).forEach(gain => gain?.disconnect());
    mediaGainsRef.current = {};
  }, [stopMedia]);

  const getElapsed = useCallback(() => {
    if (!playing) return elapsedRef.current;
    return getOutputPosition();
  }, [getOutputPosition, playing]);

  return { duration, elapsed, getElapsed, loadStatus, pause, playing, reset, seek, toggle };
}
