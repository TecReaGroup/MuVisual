import { memo, useEffect, useMemo, useRef } from 'react';
import { numberForPitch } from '../../../entities/music/lib/pitch';
import type { Note } from '../../../entities/music/model/types';

type Voice = 'high' | 'low';
type QuantizedNotes = Map<string, Note>;

function beatForSettings(time: number, bpm: number, gridDelay: number) {
  return (time - gridDelay / 1000) * bpm / 60;
}

function quantizeNotes(notes: Note[], bpm: number, gridDelay: number) {
  const result: QuantizedNotes = new Map();
  notes.forEach(note => {
    const voice: Voice = note.pitch >= 60 ? 'high' : 'low';
    const step = Math.max(0, Math.round(beatForSettings(note.start, bpm, gridDelay) * 4));
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
  const isEAndRhythm = rhythm === 'sixteenth' && onsets.length === 2 && onsets[0] === 1 && onsets[1] === 2;
  const secondary = [false, false, false, false];

  if (isEAndRhythm) {
    secondary.fill(true);
  } else {
    onsets.forEach(slot => {
      if (slot % 2 === 1) { secondary[slot - 1] = true; secondary[slot] = true; }
    });
    for (let index = 1; index < onsets.length; index += 1) {
      if (onsets[index] - onsets[index - 1] === 1) {
        secondary[onsets[index - 1]] = true;
        secondary[onsets[index]] = true;
      }
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

type JianpuViewProps = {
  bpm: number;
  gridDelay: number;
  getElapsed: () => number;
  keySignature: string;
  notes: Note[];
};

export const JianpuView = memo(function JianpuView({ bpm, gridDelay, getElapsed, notes, keySignature }: JianpuViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const systemRefs = useRef<Array<HTMLElement | null>>([]);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const cursorRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const quantized = useMemo(() => quantizeNotes(notes, bpm, gridDelay), [bpm, gridDelay, notes]);
  const lastBeat = Math.max(0, ...notes.map(note => beatForSettings(note.start, bpm, gridDelay)));
  const totalMeasures = Math.max(1, Math.ceil((lastBeat + 2) / 4));
  const systems = useMemo(() => Array.from({ length: Math.ceil(totalMeasures / 2) }, (_, system) =>
    [system * 2, system * 2 + 1].filter(measure => measure < totalMeasures)), [totalMeasures]);

  useEffect(() => {
    let animationFrame = 0;
    let activeSystemIndex = -1;
    let lastCursorX = Number.NaN;
    const systemWidths = new Array(systems.length).fill(0);
    const measureSystems = () => {
      rowRefs.current.forEach((row, index) => { systemWidths[index] = row?.clientWidth ?? 0; });
      lastCursorX = Number.NaN;
    };
    const resizeObserver = new ResizeObserver(measureSystems);
    rowRefs.current.forEach(row => { if (row) resizeObserver.observe(row); });
    measureSystems();

    const drawCursor = () => {
      const currentBeat = Math.max(0, beatForSettings(getElapsed(), bpm, gridDelay));
      const nextSystemIndex = Math.max(0, Math.min(systems.length - 1, Math.floor(currentBeat / 8)));

      if (nextSystemIndex !== activeSystemIndex) {
        if (activeSystemIndex >= 0) {
          systemRefs.current[activeSystemIndex]?.setAttribute('data-active-system', 'false');
        }
        activeSystemIndex = nextSystemIndex;
        lastCursorX = Number.NaN;
        const activeSystem = systemRefs.current[activeSystemIndex];
        activeSystem?.setAttribute('data-active-system', 'true');
        activeSystem?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
      }

      const system = systems[activeSystemIndex];
      const cursor = cursorRefs.current[activeSystemIndex];
      if (system && cursor) {
        const systemStartBeat = system[0] * 4;
        const systemBeats = system.length * 4;
        const cursorPosition = Math.max(0, Math.min(1, (currentBeat - systemStartBeat) / systemBeats));
        const cursorX = cursorPosition * systemWidths[activeSystemIndex] - 1;
        if (cursorX !== lastCursorX) {
          cursor.style.transform = `translate3d(${cursorX}px, 0, 0)`;
          lastCursorX = cursorX;
        }
      }
      animationFrame = requestAnimationFrame(drawCursor);
    };

    drawCursor();
    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [bpm, getElapsed, gridDelay, systems]);

  return <div className="score-stage" ref={scrollRef} data-tempo={bpm} data-background-delay={gridDelay}>
    <div className="score-sheet">
      <div className="score-heading">
        <div><span>MIDI NUMBERED SCORE</span><strong>1 = {keySignature.replace(':', ' · ')}</strong></div>
        <div className="score-meta">16TH QUANTIZE · C4 VOICE SPLIT</div>
      </div>
      {systems.map((system, systemIndex) => {
        return <section
          className="score-system"
          key={system[0]}
          data-active-system="false"
          ref={element => { systemRefs.current[systemIndex] = element; }}
        >
          <div className="staff-labels"><span>HIGH</span><span>LOW</span></div>
          <div className="score-rows" ref={element => { rowRefs.current[systemIndex] = element; }}>
            {(['high', 'low'] as const).map(voice => <div className="score-row" key={voice}>
              {system.map(measure => <div className="score-measure" key={measure}>
                <span className="measure-number">{String(measure + 1).padStart(2, '0')}</span>
                {Array.from({ length: 4 }, (_, beat) => <Beat key={beat} beat={measure * 4 + beat} voice={voice} notes={quantized} keySignature={keySignature} />)}
              </div>)}
            </div>)}
            <span className="score-cursor" ref={element => { cursorRefs.current[systemIndex] = element; }} aria-hidden="true" />
          </div>
        </section>;
      })}
    </div>
  </div>;
});
