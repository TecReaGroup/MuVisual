import { Minus, Pause, Play, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { KEY_SIGNATURE_OPTIONS } from '../../../entities/music/lib/pitch';
import type { LabelMode } from '../../../entities/music/model/types';
import { formatTime } from '../../../shared/lib/formatTime';

type PlaybackControlsProps = {
  bpm: number;
  duration: number;
  elapsed: number;
  gridDelay: number;
  keySignature: string;
  labelMode: LabelMode;
  muted: boolean;
  noteCount: number;
  playing: boolean;
  volume: number;
  onBpmChange: (bpm: number) => void;
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
  const changeBpm = (nextBpm: number) => props.onBpmChange(Math.max(30, Math.min(300, nextBpm)));

  return <>
    <div className="controls-header"><div className="eyebrow">PLAYBACK CONTROL</div></div>
    <div className="progress-control">
      <input type="range" min="0" max={props.duration} step="0.01" value={Math.min(props.elapsed, props.duration)} onChange={event => props.onSeek(+event.target.value)} aria-label="Playback progress" />
      <div><span>{formatTime(props.elapsed)}</span><span>{formatTime(props.duration)}</span></div>
    </div>
    <div className="transport">
      <button className="primary" onClick={props.onToggle} aria-label={props.playing ? 'Pause' : 'Play'}>{props.playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}</button>
      <button onClick={props.onReset} aria-label="Reset"><RotateCcw size={18} /></button>
      <div className="transport-copy"><strong>{props.playing ? 'Playing' : 'Ready to play'}</strong><span>{props.bpm} BPM · {props.noteCount} notes</span></div>
    </div>
    <div className="key-control">
      <label htmlFor="key-signature">KEY SIGNATURE</label>
      <select id="key-signature" value={props.keySignature} onChange={event => props.onKeySignatureChange(event.target.value)}>
        {KEY_SIGNATURE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
    <div className="label-control">
      <span>NOTE LABELS</span>
      <div className="label-switch" role="group" aria-label="Piano roll note label format">
        <button className={props.labelMode === 'name' ? 'selected' : ''} onClick={() => props.onLabelModeChange('name')} aria-pressed={props.labelMode === 'name'}>C D E</button>
        <button className={props.labelMode === 'number' ? 'selected' : ''} onClick={() => props.onLabelModeChange('number')} aria-pressed={props.labelMode === 'number'}>1 2 3</button>
      </div>
    </div>
    <div className="control tempo-control">
      <div><span>TEMPO</span><b>{props.bpm}<small>BPM</small></b></div>
      <input type="range" min="30" max="300" step="1" value={props.bpm} onChange={event => changeBpm(+event.target.value)} />
      <div className="step-actions">
        <button onClick={() => changeBpm(props.bpm + 1)} disabled={props.bpm >= 300} aria-label="Increase tempo by 1 BPM"><Plus size={16} />1 BPM</button>
        <button onClick={() => changeBpm(props.bpm - 1)} disabled={props.bpm <= 30} aria-label="Decrease tempo by 1 BPM"><Minus size={16} />1 BPM</button>
      </div>
    </div>
    <div className="control delay-control">
      <div><span>BACKGROUND DELAY</span><b>{props.gridDelay}<small>MS</small></b></div>
      <input type="range" min="0" max="2000" step="10" value={props.gridDelay} onChange={event => props.onGridDelayChange(+event.target.value)} />
      <div className="delay-actions step-actions">
        <button onClick={() => props.onGridDelayChange(Math.min(2000, props.gridDelay + 10))} disabled={props.gridDelay >= 2000} aria-label="Increase background delay by 10 milliseconds"><Plus size={16} />10 MS</button>
        <button onClick={() => props.onGridDelayChange(Math.max(0, props.gridDelay - 10))} disabled={props.gridDelay <= 0} aria-label="Decrease background delay by 10 milliseconds"><Minus size={16} />10 MS</button>
      </div>
    </div>
    <div className="control">
      <div><span>MASTER VOLUME</span><b>{props.muted ? 0 : props.volume}<small>%</small></b></div>
      <input type="range" min="0" max="100" value={props.volume} onChange={event => props.onVolumeChange(+event.target.value)} />
    </div>
    <button className="mute" onClick={() => props.onMutedChange(!props.muted)}>{props.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}{props.muted ? 'UNMUTE AUDIO' : 'MUTE AUDIO'}</button>
    <div className="legend"><div><i className="left" />LEFT HAND</div><div><i className="right" />RIGHT HAND</div></div>
  </>;
}
