import { useCallback, useEffect, useRef, useState } from 'react';
import type { Instrument } from '../../../entities/music/model/types';
import { createTimbreLibrary, type TimbreLibrary } from './timbreLibrary';

type LoadStatus = 'loading' | 'ready' | 'error';
const DEFAULT_MIDI_VELOCITY = 72;

const sharedAudio: {
  context?: AudioContext;
  muteGain?: GainNode;
  output?: GainNode;
  volumeGain?: GainNode;
  library?: TimbreLibrary;
} = {};

function getSharedAudioContext() {
  if (sharedAudio.context) return sharedAudio.context;

  const context = new AudioContext();
  const output = context.createGain();
  const volumeGain = context.createGain();
  const muteGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.knee.value = 24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.2;
  output.connect(compressor).connect(volumeGain).connect(muteGain).connect(context.destination);
  sharedAudio.context = context;
  sharedAudio.muteGain = muteGain;
  sharedAudio.output = output;
  sharedAudio.volumeGain = volumeGain;
  sharedAudio.library = createTimbreLibrary(context, output);
  return context;
}

export function usePianoAudio(muted: boolean, volume: number, instrument: Instrument = 'piano') {
  const [loadState, setLoadState] = useState<{ instrument: Instrument; status: LoadStatus }>({ instrument, status: 'loading' });
  const selectionRequestRef = useRef(0);
  const activeVoicesRef = useRef(0);
  const activeStopsRef = useRef(new Set<() => void>());
  const loadStatus = sharedAudio.library?.get(instrument) ? 'ready'
    : loadState.instrument === instrument ? loadState.status : 'loading';

  const getAudioContext = useCallback(() => getSharedAudioContext(), []);

  const loadTimbre = useCallback(async () => {
    getSharedAudioContext();
    const request = ++selectionRequestRef.current;
    setLoadState({ instrument, status: 'loading' });
    try {
      await sharedAudio.library!.load(instrument);
      if (request === selectionRequestRef.current) setLoadState({ instrument, status: 'ready' });
      return true;
    } catch (error) {
      console.error(`Unable to load ${instrument} timbre`, error);
      if (request === selectionRequestRef.current) setLoadState({ instrument, status: 'error' });
      return false;
    }
  }, [instrument]);

  const prepare = useCallback(async () => {
    const context = getAudioContext();
    const [ready] = await Promise.all([loadTimbre(), context.resume()]);
    return ready;
  }, [getAudioContext, loadTimbre]);

  useEffect(() => {
    void loadTimbre();
    return () => { selectionRequestRef.current += 1; };
  }, [loadTimbre]);

  const updateHeadroom = useCallback((context: AudioContext) => {
    const voiceCount = Math.max(1, activeVoicesRef.current);
    const targetGain = Math.max(0.22, 1 / Math.sqrt(voiceCount));
    sharedAudio.output!.gain.cancelScheduledValues(context.currentTime);
    sharedAudio.output!.gain.setTargetAtTime(targetGain, context.currentTime, 0.006);
  }, []);

  useEffect(() => {
    const context = getAudioContext();
    sharedAudio.volumeGain!.gain.cancelScheduledValues(context.currentTime);
    sharedAudio.volumeGain!.gain.setTargetAtTime(volume / 100, context.currentTime, 0.008);
  }, [getAudioContext, volume]);

  useEffect(() => {
    const context = getAudioContext();
    sharedAudio.muteGain!.gain.cancelScheduledValues(context.currentTime);
    sharedAudio.muteGain!.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.008);
  }, [getAudioContext, muted]);

  const playNote = useCallback((pitch: number, length: number, startTime?: number) => {
    const context = getAudioContext();
    const definition = sharedAudio.library!.get(instrument);
    if (!definition) return;
    activeVoicesRef.current += 1;
    updateHeadroom(context);
    let ended = false;
    let stopNote: () => void = () => undefined;
    const cleanup = () => {
      if (ended) return;
      ended = true;
      activeStopsRef.current.delete(stopNote);
      activeVoicesRef.current -= 1;
      updateHeadroom(context);
    };
    try {
      const stop = definition.start({
        note: pitch,
        time: Math.max(context.currentTime, startTime ?? context.currentTime),
        duration: Math.max(0.01, length),
        velocity: DEFAULT_MIDI_VELOCITY,
        onEnded: cleanup,
      });
      stopNote = () => {
        if (ended) return;
        stop(context.currentTime);
        cleanup();
      };
      if (!ended) activeStopsRef.current.add(stopNote);
    } catch (error) {
      cleanup();
      throw error;
    }
  }, [getAudioContext, instrument, updateHeadroom]);

  const stopAll = useCallback(() => {
    activeStopsRef.current.forEach(stop => stop());
    activeStopsRef.current.clear();
  }, []);

  const getAudioTime = useCallback(() => getAudioContext().currentTime, [getAudioContext]);

  useEffect(() => stopAll, [instrument, stopAll]);

  return { getAudioContext, getAudioTime, loadStatus, loadTimbre, playNote, prepare, stopAll };
}
