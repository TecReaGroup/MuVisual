import { AudioWaveform, Disc3, Minus, Music2, Pause, Play, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { KEY_SIGNATURE_OPTIONS } from '../../../entities/music/lib/pitch';
import type { AudioSource, Instrument, LabelMode } from '../../../entities/music/model/types';
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
  instrument: Instrument;
  availableAudioSources: Record<AudioSource, boolean>;
  availableInstruments: Partial<Record<Instrument, boolean>>;
  beatEnhanceAvailable: boolean;
  beatEnhanceEnabled: boolean;
  duration: number;
  elapsed: number;
  gridDelay: number;
  keySignature: string;
  labelMode: LabelMode;
  muted: boolean;
  noteCount: number;
  playing: boolean;
  resourceLoadStatus: 'loading' | 'ready' | 'error';
  volume: number;
  onBpmChange: (bpm: number) => void;
  onAudioSourceChange: (source: AudioSource) => void;
  onBeatEnhanceChange: (enabled: boolean) => void;
  onInstrumentChange: (instrument: Instrument) => void;
  onGridDelayChange: (delay: number) => void;
  onKeySignatureChange: (keySignature: string) => void;
  onLabelModeChange: (mode: LabelMode) => void;
  onMutedChange: (muted: boolean) => void;
  onReset: () => void;
  onSeek: (time: number) => void;
  onToggle: () => void;
  onVolumeChange: (volume: number) => void;
};

export function PlaybackControls(props: PlaybackControlsProps) {
  const { t } = useI18n();
  const beatEnhanceActive = props.beatEnhanceEnabled && props.beatEnhanceAvailable;
  const resourcesReady = props.resourceLoadStatus === 'ready';
  const changeBpm = (nextBpm: number) => props.onBpmChange(Math.max(30, Math.min(300, nextBpm)));
  const gridDelayMax = Math.max(2000, Math.ceil(props.gridDelay / 1000) * 1000);

  return <>
    <div className="controls-header"><div className="eyebrow">{t('playback.control')}</div></div>
    <div className="progress-control">
      <input {...rangePointerHandlers} type="range" min="0" max={props.duration} step="0.01" value={Math.min(props.elapsed, props.duration)} onChange={event => props.onSeek(+event.target.value)} aria-label={t('playback.progress')} />
      <div><span>{formatTime(props.elapsed)}</span><span>{formatTime(props.duration)}</span></div>
    </div>
    <div className="transport">
      <button className="primary" disabled={!props.playing && !resourcesReady} onClick={props.onToggle} aria-label={t(props.playing ? 'playback.pause' : resourcesReady ? 'playback.play' : 'playback.loadingResources')}>{props.playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}</button>
      <button onClick={props.onReset} aria-label={t('playback.reset')}><RotateCcw size={18} /></button>
      <div className="transport-copy"><strong>{t(props.playing ? 'playback.playing' : resourcesReady ? 'playback.ready' : props.resourceLoadStatus === 'error' ? 'playback.loadError' : 'playback.loadingResources')}</strong><span>{t('playback.summary', { bpm: props.bpm, count: props.noteCount })}</span></div>
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
    <div className="control">
      <div><span>{t('playback.masterVolume')}</span><b>{props.muted ? 0 : props.volume}<small>%</small></b></div>
      <input {...rangePointerHandlers} type="range" min="0" max="100" value={props.volume} onChange={event => props.onVolumeChange(+event.target.value)} />
    </div>
    <button className="mute" onClick={() => props.onMutedChange(!props.muted)}>{props.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}{t(props.muted ? 'playback.unmute' : 'playback.mute')}</button>
    <div className="audio-source-control">
      <span>{t('playback.audioSource')}</span>
      <div className="audio-source-switch" role="group" aria-label={t('playback.audioSource')}>
        <button className={props.audioSource === 'midi' ? 'selected' : ''} disabled={!props.availableAudioSources.midi} onClick={() => props.onAudioSourceChange('midi')} aria-pressed={props.audioSource === 'midi'}><Music2 size={14} />MIDI</button>
        <button className={props.audioSource === 'instrument' ? 'selected' : ''} disabled={!props.availableAudioSources.instrument} onClick={() => props.onAudioSourceChange('instrument')} aria-pressed={props.audioSource === 'instrument'}><AudioWaveform size={14} />{t('playback.instrumentAudio')}</button>
        <button className={props.audioSource === 'original' ? 'selected' : ''} disabled={!props.availableAudioSources.original} onClick={() => props.onAudioSourceChange('original')} aria-pressed={props.audioSource === 'original'}><Disc3 size={14} />{t('playback.originalAudio')}</button>
      </div>
    </div>
    <div className="instrument-control">
      <label htmlFor="instrument">{t('playback.instrument')}</label>
      <select id="instrument" value={props.instrument} onChange={event => props.onInstrumentChange(event.target.value as Instrument)}>
        <option value="piano" disabled={!props.availableInstruments.piano}>{t('playback.piano')}</option>
        <option value="other" disabled={!props.availableInstruments.other}>{t('playback.other')}</option>
        <option value="vocals" disabled={!props.availableInstruments.vocals}>{t('playback.vocals')}</option>
        <option value="bass" disabled={!props.availableInstruments.bass}>{t('playback.bass')}</option>
        <option value="drums" disabled={!props.availableInstruments.drums}>{t('playback.drums')}</option>
        <option value="guitar" disabled={!props.availableInstruments.guitar}>{t('playback.guitar')}</option>
      </select>
    </div>
    <div className={`rhythm-controls ${beatEnhanceActive ? 'enhanced' : ''}`}>
      <span className="rhythm-controls-label">{t('playback.rhythmControl')}</span>
      <button
        className={`beat-enhance ${beatEnhanceActive ? 'enabled' : ''}`}
        type="button"
        role="switch"
        aria-checked={beatEnhanceActive}
        disabled={!props.beatEnhanceAvailable}
        onClick={() => props.onBeatEnhanceChange(!props.beatEnhanceEnabled)}
      >
        <AudioWaveform size={16} />
        <span><strong>{t('playback.beatEnhance')}</strong><small>{t(props.beatEnhanceAvailable ? 'playback.beatDetected' : 'playback.beatUnavailable')}</small></span>
        <i aria-hidden="true"><b /></i>
      </button>
      <div className="control tempo-control">
        <div><span>{t('playback.tempo')}</span><b>{props.bpm}<small>BPM</small></b></div>
        <input {...rangePointerHandlers} disabled={beatEnhanceActive} type="range" min="30" max="300" step="1" value={props.bpm} onChange={event => changeBpm(+event.target.value)} />
        <div className="step-actions">
          <button onClick={() => changeBpm(props.bpm + 1)} disabled={beatEnhanceActive || props.bpm >= 300} aria-label={t('playback.increaseTempo')}><Plus size={16} />1 BPM</button>
          <button onClick={() => changeBpm(props.bpm - 1)} disabled={beatEnhanceActive || props.bpm <= 30} aria-label={t('playback.decreaseTempo')}><Minus size={16} />1 BPM</button>
        </div>
      </div>
      <div className="control delay-control">
        <div><span>{t('playback.backgroundDelay')}</span><b>{props.gridDelay}<small>MS</small></b></div>
        <input {...rangePointerHandlers} disabled={beatEnhanceActive} type="range" min="0" max={gridDelayMax} step="10" value={props.gridDelay} onChange={event => props.onGridDelayChange(+event.target.value)} />
        <div className="delay-actions step-actions">
          <button onClick={() => props.onGridDelayChange(Math.min(gridDelayMax, props.gridDelay + 10))} disabled={beatEnhanceActive || props.gridDelay >= gridDelayMax} aria-label={t('playback.increaseDelay')}><Plus size={16} />10 MS</button>
          <button onClick={() => props.onGridDelayChange(Math.max(0, props.gridDelay - 10))} disabled={beatEnhanceActive || props.gridDelay <= 0} aria-label={t('playback.decreaseDelay')}><Minus size={16} />10 MS</button>
        </div>
      </div>
    </div>
    <div className="legend"><div><i className="left" />{t('playback.leftHand')}</div><div><i className="right" />{t('playback.rightHand')}</div></div>
  </>;
}
