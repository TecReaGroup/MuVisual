import { Disc3, Minus, Music2, Pause, Piano, Play, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { KEY_SIGNATURE_OPTIONS } from '../../../entities/music/lib/pitch';
import type { AudioSource, LabelMode, MidiInstrument } from '../../../entities/music/model/types';
import { formatTime } from '../../../shared/lib/formatTime';
import { useI18n } from '../../../shared/i18n';

const rangePointerHandlers = {
  draggable: false,
  onDragStart: (event: React.DragEvent<HTMLInputElement>) => event.preventDefault(),
  onPointerDown: (event: React.PointerEvent<HTMLInputElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
  },
  onPointerUp: (event: React.PointerEvent<HTMLInputElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  },
};

type PlaybackControlsProps = {
  bpm: number;
  audioSource: AudioSource;
  midiInstrument: MidiInstrument;
  availableAudioSources: Record<AudioSource, boolean>;
  availableMidiVersions: Record<'original' | 'quantized', boolean>;
  duration: number;
  elapsed: number;
  gridDelay: number;
  keySignature: string;
  labelMode: LabelMode;
  muted: boolean;
  midiVersion: 'original' | 'quantized';
  noteCount: number;
  playing: boolean;
  volume: number;
  onBpmChange: (bpm: number) => void;
  onAudioSourceChange: (source: AudioSource) => void;
  onMidiInstrumentChange: (instrument: MidiInstrument) => void;
  onGridDelayChange: (delay: number) => void;
  onKeySignatureChange: (keySignature: string) => void;
  onLabelModeChange: (mode: LabelMode) => void;
  onMutedChange: (muted: boolean) => void;
  onMidiVersionChange: (version: 'original' | 'quantized') => void;
  onReset: () => void;
  onSeek: (time: number) => void;
  onToggle: () => void;
  onVolumeChange: (volume: number) => void;
};

export function PlaybackControls(props: PlaybackControlsProps) {
  const { t } = useI18n();
  const changeBpm = (nextBpm: number) => props.onBpmChange(Math.max(30, Math.min(300, nextBpm)));
  const gridDelayMax = Math.max(2000, Math.ceil(props.gridDelay / 1000) * 1000);

  return <>
    <div className="controls-header"><div className="eyebrow">{t('playback.control')}</div></div>
    <div className="progress-control">
      <input {...rangePointerHandlers} type="range" min="0" max={props.duration} step="0.01" value={Math.min(props.elapsed, props.duration)} onChange={event => props.onSeek(+event.target.value)} aria-label={t('playback.progress')} />
      <div><span>{formatTime(props.elapsed)}</span><span>{formatTime(props.duration)}</span></div>
    </div>
    <div className="transport">
      <button className="primary" onClick={props.onToggle} aria-label={t(props.playing ? 'playback.pause' : 'playback.play')}>{props.playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}</button>
      <button onClick={props.onReset} aria-label={t('playback.reset')}><RotateCcw size={18} /></button>
      <div className="transport-copy"><strong>{t(props.playing ? 'playback.playing' : 'playback.ready')}</strong><span>{t('playback.summary', { bpm: props.bpm, count: props.noteCount })}</span></div>
    </div>
    <div className="key-control">
      <label htmlFor="key-signature">{t('playback.keySignature')}</label>
      <select id="key-signature" value={props.keySignature} onChange={event => props.onKeySignatureChange(event.target.value)}>
        {KEY_SIGNATURE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
    <div className="label-control">
      <span>{t('playback.noteLabels')}</span>
      <div className="label-switch" role="group" aria-label={t('playback.noteLabelFormat')}>
        <button className={props.labelMode === 'name' ? 'selected' : ''} onClick={() => props.onLabelModeChange('name')} aria-pressed={props.labelMode === 'name'}>C D E</button>
        <button className={props.labelMode === 'number' ? 'selected' : ''} onClick={() => props.onLabelModeChange('number')} aria-pressed={props.labelMode === 'number'}>1 2 3</button>
      </div>
    </div>
    <div className="control tempo-control">
      <div><span>{t('playback.tempo')}</span><b>{props.bpm}<small>BPM</small></b></div>
      <input {...rangePointerHandlers} type="range" min="30" max="300" step="1" value={props.bpm} onChange={event => changeBpm(+event.target.value)} />
      <div className="step-actions">
        <button onClick={() => changeBpm(props.bpm + 1)} disabled={props.bpm >= 300} aria-label={t('playback.increaseTempo')}><Plus size={16} />1 BPM</button>
        <button onClick={() => changeBpm(props.bpm - 1)} disabled={props.bpm <= 30} aria-label={t('playback.decreaseTempo')}><Minus size={16} />1 BPM</button>
      </div>
    </div>
    <div className="control delay-control">
      <div><span>{t('playback.backgroundDelay')}</span><b>{props.gridDelay}<small>MS</small></b></div>
      <input {...rangePointerHandlers} type="range" min="0" max={gridDelayMax} step="10" value={props.gridDelay} onChange={event => props.onGridDelayChange(+event.target.value)} />
      <div className="delay-actions step-actions">
        <button onClick={() => props.onGridDelayChange(Math.min(gridDelayMax, props.gridDelay + 10))} disabled={props.gridDelay >= gridDelayMax} aria-label={t('playback.increaseDelay')}><Plus size={16} />10 MS</button>
        <button onClick={() => props.onGridDelayChange(Math.max(0, props.gridDelay - 10))} disabled={props.gridDelay <= 0} aria-label={t('playback.decreaseDelay')}><Minus size={16} />10 MS</button>
      </div>
    </div>
    <div className="control">
      <div><span>{t('playback.masterVolume')}</span><b>{props.muted ? 0 : props.volume}<small>%</small></b></div>
      <input {...rangePointerHandlers} type="range" min="0" max="100" value={props.volume} onChange={event => props.onVolumeChange(+event.target.value)} />
    </div>
    <div className="audio-source-control">
      <span>{t('playback.audioSource')}</span>
      <div className="audio-source-switch" role="group" aria-label={t('playback.audioSource')}>
        <button className={props.audioSource === 'midi' ? 'selected' : ''} disabled={!props.availableAudioSources.midi} onClick={() => props.onAudioSourceChange('midi')} aria-pressed={props.audioSource === 'midi'}><Music2 size={14} />MIDI</button>
        <button className={props.audioSource === 'piano' ? 'selected' : ''} disabled={!props.availableAudioSources.piano} onClick={() => props.onAudioSourceChange('piano')} aria-pressed={props.audioSource === 'piano'}><Piano size={14} />{t('playback.piano')}</button>
        <button className={props.audioSource === 'original' ? 'selected' : ''} disabled={!props.availableAudioSources.original} onClick={() => props.onAudioSourceChange('original')} aria-pressed={props.audioSource === 'original'}><Disc3 size={14} />{t('playback.originalAudio')}</button>
      </div>
    </div>
    <div className="midi-instrument-control">
      <label htmlFor="midi-instrument">{t('playback.midiInstrument')}</label>
      <select id="midi-instrument" value={props.midiInstrument} onChange={event => props.onMidiInstrumentChange(event.target.value as MidiInstrument)}>
        <option value="piano">{t('playback.piano')}</option>
        <option value="string">{t('playback.string')}</option>
      </select>
    </div>
    <button className="mute" onClick={() => props.onMutedChange(!props.muted)}>{props.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}{t(props.muted ? 'playback.unmute' : 'playback.mute')}</button>
    <div className="midi-version-control">
      <span>{t('playback.midiVersion')}</span>
      <div className="midi-version-switch" role="group" aria-label={t('playback.midiVersion')}>
        <button className={props.midiVersion === 'original' ? 'selected' : ''} disabled={!props.availableMidiVersions.original} onClick={() => props.onMidiVersionChange('original')} aria-pressed={props.midiVersion === 'original'}>{t('playback.original')}</button>
        <button className={props.midiVersion === 'quantized' ? 'selected' : ''} disabled={!props.availableMidiVersions.quantized} onClick={() => props.onMidiVersionChange('quantized')} aria-pressed={props.midiVersion === 'quantized'}>{t('playback.quantized')}</button>
      </div>
    </div>
    <div className="legend"><div><i className="left" />{t('playback.leftHand')}</div><div><i className="right" />{t('playback.rightHand')}</div></div>
  </>;
}
