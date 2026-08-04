import { useCallback, useRef } from 'react';
import { SplendidGrandPiano } from 'smplr';
import { END_MIDI, START_MIDI } from '../../../entities/music/lib/pitch';

export function usePianoAudio(muted: boolean, volume: number) {
  const audioRef = useRef<AudioContext>();
  const pianoRef = useRef<SplendidGrandPiano>();
  const pianoLoadingRef = useRef(false);

  const getAudioContext = useCallback(() => {
    const context = audioRef.current ?? new AudioContext();
    audioRef.current = context;
    return context;
  }, []);

  const prepare = useCallback(() => {
    const context = getAudioContext();
    void context.resume();
    if (pianoRef.current || pianoLoadingRef.current) return;

    pianoLoadingRef.current = true;
    const piano = new SplendidGrandPiano(context, {
      notesToLoad: {
        notes: Array.from({ length: END_MIDI - START_MIDI + 1 }, (_, index) => START_MIDI + index),
        velocityRange: [1, 127],
      },
    });
    void piano.load
      .then(() => { pianoRef.current = piano; })
      .catch(() => undefined)
      .finally(() => { pianoLoadingRef.current = false; });
  }, [getAudioContext]);

  const playNote = useCallback((pitch: number, length: number) => {
    if (muted) return;
    const context = getAudioContext();
    if (pianoRef.current) {
      pianoRef.current.start({
        note: pitch,
        duration: length,
        velocity: Math.max(20, Math.round(volume * 1.1)),
      });
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
    gain.gain.setValueAtTime((volume / 100) * 0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + Math.min(length, 1.2));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + Math.min(length, 1.2));
  }, [getAudioContext, muted, volume]);

  return { playNote, prepare };
}
