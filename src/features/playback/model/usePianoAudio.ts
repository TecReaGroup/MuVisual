import { useCallback, useEffect, useRef, useState } from 'react';
import { SplendidGrandPiano } from 'smplr';
import { END_MIDI, START_MIDI } from '../../../entities/music/lib/pitch';

type LoadStatus = 'loading' | 'ready' | 'error';

const sharedAudio: {
  context?: AudioContext;
  output?: GainNode;
  piano?: SplendidGrandPiano;
  load?: Promise<boolean>;
  status: LoadStatus;
  listeners: Set<() => void>;
} = {
  status: 'loading',
  listeners: new Set(),
};

function notifySharedStatus(status: LoadStatus) {
  sharedAudio.status = status;
  sharedAudio.listeners.forEach(listener => listener());
}

function getSharedAudioContext() {
  if (sharedAudio.context) return sharedAudio.context;

  const context = new AudioContext();
  const output = context.createGain();
  const compressor = context.createDynamicsCompressor();
  output.gain.value = 0.72;
  compressor.threshold.value = -10;
  compressor.knee.value = 24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.2;
  output.connect(compressor).connect(context.destination);
  sharedAudio.context = context;
  sharedAudio.output = output;
  return context;
}

export function preloadPiano() {
  const context = getSharedAudioContext();
  if (sharedAudio.piano) return Promise.resolve(true);
  if (sharedAudio.load) return sharedAudio.load;

  notifySharedStatus('loading');
  const piano = new SplendidGrandPiano(context, {
    destination: sharedAudio.output,
    notesToLoad: {
      notes: Array.from({ length: END_MIDI - START_MIDI + 1 }, (_, index) => START_MIDI + index),
      velocityRange: [1, 127],
    },
  });
  sharedAudio.load = piano.load
    .then(() => {
      sharedAudio.piano = piano;
      notifySharedStatus('ready');
      return true;
    })
    .catch(() => {
      sharedAudio.load = undefined;
      notifySharedStatus('error');
      return false;
    });
  return sharedAudio.load;
}

export function usePianoAudio(muted: boolean, volume: number) {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(sharedAudio.status);
  const activeVoicesRef = useRef(0);
  const activeStopsRef = useRef(new Set<() => void>());

  useEffect(() => {
    const updateStatus = () => setLoadStatus(sharedAudio.status);
    sharedAudio.listeners.add(updateStatus);
    updateStatus();
    return () => sharedAudio.listeners.delete(updateStatus);
  }, []);

  const getAudioContext = useCallback(() => getSharedAudioContext(), []);

  const updateHeadroom = useCallback((context: AudioContext) => {
    const output = sharedAudio.output;
    if (!output) return;
    const voiceCount = Math.max(1, activeVoicesRef.current);
    const targetGain = Math.max(0.16, 0.72 / Math.sqrt(voiceCount));
    output.gain.cancelScheduledValues(context.currentTime);
    output.gain.setTargetAtTime(targetGain, context.currentTime, 0.006);
  }, []);

  const beginVoice = useCallback((context: AudioContext) => {
    activeVoicesRef.current += 1;
    updateHeadroom(context);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      activeVoicesRef.current = Math.max(0, activeVoicesRef.current - 1);
      updateHeadroom(context);
    };
  }, [updateHeadroom]);

  const loadPiano = useCallback(() => preloadPiano(), []);

  const prepare = useCallback(async () => {
    const context = getAudioContext();
    const [loaded] = await Promise.all([loadPiano(), context.resume()]);
    return loaded;
  }, [getAudioContext, loadPiano]);

  useEffect(() => {
    void loadPiano();
  }, [loadPiano]);

  const playNote = useCallback((pitch: number, length: number, startTime?: number) => {
    if (muted) return;
    const context = getAudioContext();
    const safeLength = Math.max(0.01, length);
    const noteStart = Math.max(context.currentTime, startTime ?? context.currentTime);
    if (sharedAudio.piano) {
      const endVoice = beginVoice(context);
      let stopNote = () => undefined;
      const cleanup = () => {
        activeStopsRef.current.delete(stopNote);
        endVoice();
      };
      const stop = sharedAudio.piano.start({
        note: pitch,
        time: noteStart,
        duration: safeLength,
        decayTime: Math.max(0.025, Math.min(0.18, safeLength * 0.4)),
        velocity: Math.max(20, Math.round(volume * 1.1)),
        onEnded: cleanup,
      });
      stopNote = () => stop(context.currentTime);
      activeStopsRef.current.add(stopNote);
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = noteStart;
    const duration = Math.max(0.02, Math.min(safeLength, 1.2));
    const attackTime = Math.min(0.006, duration * 0.25);
    const releaseTime = Math.min(0.016, duration * 0.35);
    const attackEnd = now + attackTime;
    const releaseStart = Math.max(attackEnd, now + duration - releaseTime);
    const releaseEnd = now + duration;
    const endVoice = beginVoice(context);
    let stopped = false;
    const stopNote = () => {
      if (stopped) return;
      stopped = true;
      const stopAt = Math.max(context.currentTime, now);
      gain.gain.cancelScheduledValues(stopAt);
      gain.gain.setTargetAtTime(0.0001, stopAt, 0.003);
      oscillator.stop(stopAt + 0.015);
    };
    oscillator.type = 'sine';
    oscillator.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
    const peak = (volume / 100) * 0.08;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, attackEnd);
    gain.gain.setValueAtTime(peak, releaseStart);
    gain.gain.linearRampToValueAtTime(0.0001, releaseEnd);
    oscillator.connect(gain).connect(sharedAudio.output!);
    oscillator.onended = () => {
      activeStopsRef.current.delete(stopNote);
      endVoice();
    };
    activeStopsRef.current.add(stopNote);
    oscillator.start(now);
    oscillator.stop(releaseEnd + 0.002);
  }, [beginVoice, getAudioContext, muted, volume]);

  const stopAll = useCallback(() => {
    activeStopsRef.current.forEach(stop => stop());
    activeStopsRef.current.clear();
  }, []);

  const getAudioTime = useCallback(() => getAudioContext().currentTime, [getAudioContext]);

  useEffect(() => () => {
    activeStopsRef.current.forEach(stop => stop());
    activeStopsRef.current.clear();
  }, []);

  return { getAudioTime, loadStatus, playNote, prepare, stopAll };
}
