import { useEffect, useMemo, useRef } from 'react';
import { numberForPitch } from '../../../entities/music/lib/pitch';
import type { Note, TempoPoint } from '../../../entities/music/model/types';

type Voice = 'high' | 'low';
type QuantizedNotes = Map<string, Note>;

function quantizeNotes(notes: Note[]) {
  const result: QuantizedNotes = new Map();
  notes.forEach(note => {
    const voice: Voice = note.pitch >= 60 ? 'high' : 'low';
    const step = Math.max(0, Math.round(note.beat * 4));
    const key = `${voice}:${step}`;
    const existing = result.get(key);
    if (!existing || note.pitch < existing.pitch) result.set(key, note);
  });
  return result;
}

function Beat({ beat, voice, notes, keySignature }: { beat: number; voice: Voice; notes: QuantizedNotes; keySignature: string }) {
  const slots = Array.from({ length: 4 }, (_, slot) => notes.get(`${voice}:${beat * 4 + slot}`));
  const onsets = slots.flatMap((note, slot) => note ? [slot] : []);
  const rhythm = !onsets.length ? 'empty' : onsets.some(slot => slot % 2 === 1) ? 'sixteenth' : onsets.includes(2) ? 'eighth' : 'quarter';
  const cellStarts = rhythm === 'quarter' ? [0] : rhythm === 'eighth' ? [0, 2] : [0, 1, 2, 3];
  const secondary = [false, false, false, false];

  onsets.forEach(slot => {
    if (slot % 2 === 1) { secondary[slot - 1] = true; secondary[slot] = true; }
  });
  for (let index = 1; index < onsets.length; index += 1) {
    if (onsets[index] - onsets[index - 1] === 1) {
      secondary[onsets[index - 1]] = true;
      secondary[onsets[index]] = true;
    }
  }

  return <div className={`score-beat rhythm-${rhythm}`}>
    <div className="score-slots">
      {cellStarts.map(slot => {
        const note = slots[slot];
        const value = note ? numberForPitch(note.pitch, keySignature) : null;
        return <div className="score-slot" key={slot}>
          {value && <>
            {value.octave > 0 && <span className="octave-dots high">{Array.from({ length: value.octave }, (_, index) => <i key={index} />)}</span>}
            <span className="score-number">{value.text}</span>
            {value.octave < 0 && <span className="octave-dots low">{Array.from({ length: -value.octave }, (_, index) => <i key={index} />)}</span>}
          </>}
        </div>;
      })}
    </div>
    {!onsets.length && <span className="quarter-line" />}
    {(rhythm === 'eighth' || rhythm === 'sixteenth') && <span className="primary-beam" />}
    {rhythm === 'sixteenth' && <div className="secondary-beams">{secondary.map((visible, slot) => <i className={visible ? 'visible' : ''} key={slot} />)}</div>}
  </div>;
}

function beatAtTime(time: number, tempoMap: TempoPoint[]) {
  let point = tempoMap[0] ?? { beat: 0, time: 0, bpm: 120 };
  for (const tempo of tempoMap) {
    if (tempo.time > time) break;
    point = tempo;
  }
  return point.beat + (time - point.time) * point.bpm / 60;
}

export function JianpuView({ notes, elapsed, tempoMap, keySignature }: { notes: Note[]; elapsed: number; tempoMap: TempoPoint[]; keySignature: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const quantized = useMemo(() => quantizeNotes(notes), [notes]);
  const lastBeat = Math.max(0, ...notes.map(note => note.beat));
  const totalMeasures = Math.max(1, Math.ceil((lastBeat + 2) / 4));
  const currentBeat = Math.max(0, beatAtTime(elapsed, tempoMap));
  const activeStep = Math.floor(currentBeat * 4);
  const systems = useMemo(() => Array.from({ length: Math.ceil(totalMeasures / 2) }, (_, system) =>
    [system * 2, system * 2 + 1].filter(measure => measure < totalMeasures)), [totalMeasures]);

  useEffect(() => {
    const active = scrollRef.current?.querySelector<HTMLElement>('[data-active-system="true"]');
    active?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
  }, [Math.floor(activeStep / 32)]);

  return <div className="score-stage" ref={scrollRef}>
    <div className="score-sheet">
      <div className="score-heading">
        <div><span>MIDI NUMBERED SCORE</span><strong>1 = {keySignature.replace(':', ' · ')}</strong></div>
        <div className="score-meta">16TH QUANTIZE · C4 VOICE SPLIT</div>
      </div>
      {systems.map(system => {
        const activeSystem = activeStep >= system[0] * 16 && activeStep < (system[system.length - 1] + 1) * 16;
        const systemStartBeat = system[0] * 4;
        const systemBeats = system.length * 4;
        const cursorPosition = Math.max(0, Math.min(1, (currentBeat - systemStartBeat) / systemBeats));
        return <section className="score-system" key={system[0]} data-active-system={activeSystem ? 'true' : 'false'}>
          <div className="staff-labels"><span>HIGH</span><span>LOW</span></div>
          <div className="score-rows">
            {(['high', 'low'] as const).map(voice => <div className="score-row" key={voice}>
              {system.map(measure => <div className="score-measure" key={measure}>
                <span className="measure-number">{String(measure + 1).padStart(2, '0')}</span>
                {Array.from({ length: 4 }, (_, beat) => <Beat key={beat} beat={measure * 4 + beat} voice={voice} notes={quantized} keySignature={keySignature} />)}
              </div>)}
            </div>)}
            {activeSystem && <span className="score-cursor" style={{ left: `${cursorPosition * 100}%` }} aria-hidden="true" />}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
