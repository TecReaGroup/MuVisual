import { useCallback, useEffect, useRef, useState } from 'react';
import { CacheStorage, LAYERS, SplendidGrandPiano } from 'smplr';

type LoadStatus = 'loading' | 'ready' | 'error';

const PIANO_CACHE_NAME = 'muvisual-piano-v1';
const PIANO_BASE_URL = `${import.meta.env.BASE_URL}audio/splendid-grand-piano`;
const PIANO_VELOCITY_RANGE: [number, number] = [68, 84];
const CROSSFADE_SECONDS = 0.22;

const pianoLayer = LAYERS.find(layer => (
  layer.vel_range[0] === PIANO_VELOCITY_RANGE[0]
  && layer.vel_range[1] === PIANO_VELOCITY_RANGE[1]
));
const pianoNotes = (pianoLayer?.samples ?? [])
  .filter(([, name]) => !String(name).includes('#'))
  .filter((_, index, samples) => index % 2 === 0 || index === samples.length - 1)
  .map(([note]) => Number(note));

const sharedAudio: {
  context?: AudioContext;
  muteGain?: GainNode;
  output?: GainNode;
  pianoBus?: GainNode;
  synthBus?: GainNode;
  piano?: SplendidGrandPiano;
  load?: Promise<boolean>;
  status: LoadStatus;
  timbre: 'synth' | 'piano';
  synthVoiceCount: number;
  listeners: Set<() => void>;
} = {
  status: 'loading',
  timbre: 'synth',
  synthVoiceCount: 0,
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
  const pianoBus = context.createGain();
  const synthBus = context.createGain();
  const muteGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  output.gain.value = 0.72;
  pianoBus.gain.value = sharedAudio.status === 'ready' ? 1 : 0;
  synthBus.gain.value = sharedAudio.status === 'ready' ? 0 : 1;
  muteGain.gain.value = 1;
  compressor.threshold.value = -10;
  compressor.knee.value = 24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.2;
  pianoBus.connect(output);
  synthBus.connect(output);
  output.connect(muteGain).connect(compressor).connect(context.destination);
  sharedAudio.context = context;
  sharedAudio.muteGain = muteGain;
  sharedAudio.output = output;
  sharedAudio.pianoBus = pianoBus;
  sharedAudio.synthBus = synthBus;
  return context;
}

export function preloadPiano() {
  const context = getSharedAudioContext();
  if (sharedAudio.piano) return Promise.resolve(true);
  if (sharedAudio.load) return sharedAudio.load;

  notifySharedStatus('loading');
  const piano = new SplendidGrandPiano(context, {
    baseUrl: PIANO_BASE_URL,
    destination: sharedAudio.pianoBus,
    storage: new CacheStorage(PIANO_CACHE_NAME),
    notesToLoad: {
      notes: pianoNotes,
      velocityRange: PIANO_VELOCITY_RANGE,
    },
  });
  sharedAudio.load = piano.load
    .then(() => {
      sharedAudio.piano = piano;
      const now = context.currentTime;
      if (sharedAudio.synthVoiceCount === 0) {
        sharedAudio.pianoBus?.gain.setValueAtTime(1, now);
        sharedAudio.synthBus?.gain.setValueAtTime(0, now);
        sharedAudio.timbre = 'piano';
      }
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
    return () => {
      sharedAudio.listeners.delete(updateStatus);
    };
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
    void loadPiano();
    await context.resume();
  }, [getAudioContext, loadPiano]);

  useEffect(() => {
    void loadPiano();
  }, [loadPiano]);

  useEffect(() => {
    const context = getAudioContext();
    const muteGain = sharedAudio.muteGain;
    if (!muteGain) return;
    muteGain.gain.cancelScheduledValues(context.currentTime);
    muteGain.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.008);
  }, [getAudioContext, muted]);

  const playNote = useCallback((pitch: number, length: number, startTime?: number) => {
    const context = getAudioContext();
    const safeLength = Math.max(0.01, length);
    const noteStart = Math.max(context.currentTime, startTime ?? context.currentTime);
    if (sharedAudio.piano) {
      if (sharedAudio.timbre === 'synth') {
        const fadeEnd = noteStart + CROSSFADE_SECONDS;
        sharedAudio.pianoBus?.gain.setValueAtTime(0, noteStart);
        sharedAudio.pianoBus?.gain.linearRampToValueAtTime(1, fadeEnd);
        sharedAudio.synthBus?.gain.setValueAtTime(1, noteStart);
        sharedAudio.synthBus?.gain.linearRampToValueAtTime(0, fadeEnd);
        sharedAudio.timbre = 'piano';
      }
      const endVoice = beginVoice(context);
      let stopNote: () => void = () => {};
      const cleanup = () => {
        activeStopsRef.current.delete(stopNote);
        endVoice();
      };
      const stop = sharedAudio.piano.start({
        note: pitch,
        time: noteStart,
        duration: safeLength,
        decayTime: Math.max(0.025, Math.min(0.18, safeLength * 0.4)),
        velocity: Math.round(
          PIANO_VELOCITY_RANGE[0]
          + (PIANO_VELOCITY_RANGE[1] - PIANO_VELOCITY_RANGE[0]) * volume / 100,
        ),
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
    sharedAudio.synthVoiceCount += 1;
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
    oscillator.connect(gain).connect(sharedAudio.synthBus!);
    oscillator.onended = () => {
      activeStopsRef.current.delete(stopNote);
      sharedAudio.synthVoiceCount = Math.max(0, sharedAudio.synthVoiceCount - 1);
      endVoice();
    };
    activeStopsRef.current.add(stopNote);
    oscillator.start(now);
    oscillator.stop(releaseEnd + 0.002);
  }, [beginVoice, getAudioContext, volume]);

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
