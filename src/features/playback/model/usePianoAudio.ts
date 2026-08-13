import { useCallback, useEffect, useRef, useState } from 'react';
import { createTimbreLibrary, type TimbreLibrary } from './timbreLibrary';

type LoadStatus = 'loading' | 'ready' | 'error';

const CROSSFADE_SECONDS = 0.22;
const DEFAULT_MIDI_VELOCITY = 72;

const sharedAudio: {
  context?: AudioContext;
  muteGain?: GainNode;
  output?: GainNode;
  volumeGain?: GainNode;
  pianoBus?: GainNode;
  stringBus?: GainNode;
  synthBus?: GainNode;
  library?: TimbreLibrary;
  load?: Promise<boolean>;
  status: LoadStatus;
  timbre: 'synth' | 'piano' | 'string';
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
  const stringBus = context.createGain();
  const synthBus = context.createGain();
  const volumeGain = context.createGain();
  const muteGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  output.gain.value = 1;
  pianoBus.gain.value = sharedAudio.status === 'ready' ? 1 : 0;
  synthBus.gain.value = sharedAudio.status === 'ready' ? 0 : 1;
  stringBus.gain.value = 0;
  volumeGain.gain.value = 1;
  muteGain.gain.value = 1;
  compressor.threshold.value = -10;
  compressor.knee.value = 24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.2;
  pianoBus.connect(output);
  stringBus.connect(output);
  synthBus.connect(output);
  output.connect(compressor).connect(volumeGain).connect(muteGain).connect(context.destination);
  sharedAudio.context = context;
  sharedAudio.muteGain = muteGain;
  sharedAudio.output = output;
  sharedAudio.volumeGain = volumeGain;
  sharedAudio.pianoBus = pianoBus;
  sharedAudio.stringBus = stringBus;
  sharedAudio.synthBus = synthBus;
  return context;
}

export function preloadPiano() {
  const context = getSharedAudioContext();
  if (sharedAudio.library) return sharedAudio.load ?? Promise.resolve(true);
  if (sharedAudio.load) return sharedAudio.load;

  notifySharedStatus('loading');
  const library = createTimbreLibrary(context, {
    piano: sharedAudio.pianoBus!,
    string: sharedAudio.stringBus!,
  });
  sharedAudio.library = library;
  sharedAudio.load = library.load
    .then(() => {
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

export function usePianoAudio(muted: boolean, volume: number, instrument: 'piano' | 'string' = 'piano') {
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
    const targetGain = Math.max(0.22, 1 / Math.sqrt(voiceCount));
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
    await Promise.all([loadPiano(), context.resume()]);
  }, [getAudioContext, loadPiano]);

  useEffect(() => {
    void loadPiano();
  }, [loadPiano]);

  useEffect(() => {
    const context = getAudioContext();
    const volumeGain = sharedAudio.volumeGain;
    if (!volumeGain) return;
    volumeGain.gain.cancelScheduledValues(context.currentTime);
    volumeGain.gain.setTargetAtTime(volume / 100, context.currentTime, 0.008);
  }, [getAudioContext, volume]);

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
    const definition = sharedAudio.library?.definitions[instrument];
    if (definition) {
      if (sharedAudio.timbre !== instrument) {
        const fadeEnd = noteStart + CROSSFADE_SECONDS;
        const pianoLevel = instrument === 'piano' ? 1 : 0;
        const stringLevel = instrument === 'string' ? 1 : 0;
        sharedAudio.pianoBus?.gain.setValueAtTime(sharedAudio.timbre === 'piano' ? 1 : 0, noteStart);
        sharedAudio.pianoBus?.gain.linearRampToValueAtTime(pianoLevel, fadeEnd);
        sharedAudio.stringBus?.gain.setValueAtTime(sharedAudio.timbre === 'string' ? 1 : 0, noteStart);
        sharedAudio.stringBus?.gain.linearRampToValueAtTime(stringLevel, fadeEnd);
        sharedAudio.synthBus?.gain.setValueAtTime(sharedAudio.timbre === 'synth' ? 1 : 0, noteStart);
        sharedAudio.synthBus?.gain.linearRampToValueAtTime(0, fadeEnd);
        sharedAudio.timbre = instrument;
      }
      const endVoice = beginVoice(context);
      let stopNote: () => void = () => undefined;
      const cleanup = () => {
        activeStopsRef.current.delete(stopNote);
        endVoice();
      };
      const stop = definition.start({
        note: pitch,
        time: noteStart,
        duration: safeLength,
        velocity: definition.velocity(DEFAULT_MIDI_VELOCITY),
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
    const peak = 0.08;
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
  }, [beginVoice, getAudioContext, instrument]);

  const stopAll = useCallback(() => {
    activeStopsRef.current.forEach(stop => stop());
    activeStopsRef.current.clear();
  }, []);

  const getAudioTime = useCallback(() => getAudioContext().currentTime, [getAudioContext]);

  useEffect(() => () => {
    activeStopsRef.current.forEach(stop => stop());
    activeStopsRef.current.clear();
  }, []);

  return { getAudioContext, getAudioTime, loadStatus, playNote, prepare, stopAll };
}
