import { memo, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { numberForPitch } from '../../../entities/music/lib/pitch';
import type { MusicalTimeline } from '../../../entities/music/lib/musicalTimeline';
import type { LabelMode, Note, SongMetadata } from '../../../entities/music/model/types';
import { NumberedChord } from '../../../entities/music/ui/NumberedChord';
import { useI18n } from '../../../shared/i18n';

type QuantizedNotes = Map<number, Note>;
const MEASURES_PER_SYSTEM = 4;
const MIN_BEAT_WIDTH = 72;

function quantizeNotes(notes: Note[], timeline: MusicalTimeline) {
  const melody: QuantizedNotes = new Map();
  notes.forEach(note => {
    const step = Math.max(0, Math.round(timeline.positionAt(note.start) * 4));
    const existing = melody.get(step);
    if (!existing || note.pitch > existing.pitch) melody.set(step, note);
  });
  return melody;
}

function Beat({ beat, notes, keySignature }: { beat: number; notes: QuantizedNotes; keySignature: string }) {
  const slots = Array.from({ length: 4 }, (_, slot) => notes.get(beat * 4 + slot));
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
  getElapsed: () => number;
  keySignature: string;
  labelMode: LabelMode;
  metadata?: SongMetadata | null;
  notes: Note[];
  timeline: MusicalTimeline;
};

export const JianpuView = memo(function JianpuView({ bpm, getElapsed, notes, keySignature, labelMode, metadata, timeline }: JianpuViewProps) {
  const { t } = useI18n();
  const systemRefs = useRef<Array<HTMLElement | null>>([]);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const cursorRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const quantized = useMemo(() => quantizeNotes(notes, timeline), [notes, timeline]);
  const beatsPerMeasure = metadata?.beatsPerMeasure ?? 4;
  const chords = useMemo(() => (metadata?.chords ?? [])
    .map(chord => ({ beat: timeline.positionAt(chord.time), chord: chord.chord }))
    .sort((first, second) => first.beat - second.beat), [metadata?.chords, timeline]);
  const lastBeat = Math.max(0, ...notes.map(note => timeline.positionAt(note.start)), ...chords.map(chord => chord.beat));
  const totalMeasures = Math.max(1, Math.ceil((lastBeat + 2) / beatsPerMeasure));
  const measureChords = useMemo(() => {
    let chordIndex = 0;
    let activeChord = 'N';
    return Array.from({ length: totalMeasures }, (_, measure) => {
      const startBeat = measure * beatsPerMeasure;
      const endBeat = startBeat + beatsPerMeasure;
      const changes: Array<{ beat: number; chord: string }> = [];
      // Consume boundary events before carrying the chord, including clears at the bar line.
      while (chordIndex < chords.length && chords[chordIndex].beat <= startBeat) {
        activeChord = chords[chordIndex++].chord;
      }
      if (activeChord !== 'N') changes.push({ beat: 0, chord: activeChord });
      while (chordIndex < chords.length && chords[chordIndex].beat < endBeat) {
        const change = chords[chordIndex++];
        if (change.chord === activeChord) continue;
        activeChord = change.chord;
        if (activeChord !== 'N') changes.push({ beat: change.beat - startBeat, chord: activeChord });
      }
      const beatChords = new Map<number, string[]>();
      changes.forEach(change => {
        const beat = Math.floor(change.beat);
        const labels = beatChords.get(beat) ?? [];
        if (labels[labels.length - 1] !== change.chord) labels.push(change.chord);
        beatChords.set(beat, labels);
      });
      return Array.from(beatChords, ([beat, labels]) => ({ beat, labels }));
    });
  }, [beatsPerMeasure, chords, totalMeasures]);
  const systems = useMemo(() => Array.from({ length: Math.ceil(totalMeasures / MEASURES_PER_SYSTEM) }, (_, systemIndex) => {
    const firstMeasure = systemIndex * MEASURES_PER_SYSTEM;
    const measures = Array.from({ length: Math.min(MEASURES_PER_SYSTEM, totalMeasures - firstMeasure) }, (_, index) => firstMeasure + index);
    return {
      measures,
      startBeat: firstMeasure * beatsPerMeasure,
      endBeat: (firstMeasure + measures.length) * beatsPerMeasure,
    };
  }), [beatsPerMeasure, totalMeasures]);
  const sheetStyle = {
    '--measures-per-system': MEASURES_PER_SYSTEM,
    '--beats-per-measure': beatsPerMeasure,
    '--measure-min-width': `${beatsPerMeasure * MIN_BEAT_WIDTH + 24}px`,
  } as CSSProperties;

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
      const currentBeat = Math.max(0, timeline.positionAt(getElapsed()));
      const upcomingSystemIndex = systems.findIndex(system => currentBeat < system.endBeat);
      const nextSystemIndex = upcomingSystemIndex < 0 ? systems.length - 1 : upcomingSystemIndex;

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
        // The final system keeps four columns even when it contains fewer measures.
        const systemBeats = MEASURES_PER_SYSTEM * beatsPerMeasure;
        const cursorPosition = Math.max(0, Math.min(system.endBeat - system.startBeat, currentBeat - system.startBeat)) / systemBeats;
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
  }, [beatsPerMeasure, getElapsed, systems, timeline]);

  return <div className="score-stage" data-tempo={bpm}>
    <div className="score-sheet jianpu-sheet" style={sheetStyle}>
      <div className="score-heading">
        <div><span>{t('score.title')}</span><strong>1 = {keySignature.replace(':', ' · ')}</strong></div>
        <div className="score-meta">{metadata?.timeSignature ?? '4/4'} · {t('score.meta')}</div>
      </div>
      {systems.map((system, systemIndex) => {
        return <section
          className="score-system"
          key={system.startBeat}
          data-active-system="false"
          ref={element => { systemRefs.current[systemIndex] = element; }}
        >
          <div className="score-rows" ref={element => { rowRefs.current[systemIndex] = element; }}>
            <div className="score-row">
              {system.measures.map(measure => <div className="score-measure" key={measure}>
                <span className="measure-number">{String(measure + 1).padStart(2, '0')}</span>
                {chords.length > 0 && <div className="score-chords">
                  {measureChords[measure].map((change, index) => <span
                    className="score-chord"
                    key={index}
                    style={{ gridColumn: change.beat + 1, gridRow: 1 }}
                  >{change.labels.map((chord, chordIndex) => <span key={chordIndex}>
                    {chordIndex > 0 && ' · '}
                    {labelMode === 'number' ? <NumberedChord chord={chord} keySignature={keySignature} /> : chord}
                  </span>)}</span>)}
                </div>}
                {Array.from({ length: beatsPerMeasure }, (_, beat) => <Beat key={beat} beat={measure * beatsPerMeasure + beat} notes={quantized} keySignature={keySignature} />)}
              </div>)}
            </div>
            <span className="score-cursor" ref={element => { cursorRefs.current[systemIndex] = element; }} aria-hidden="true" />
          </div>
        </section>;
      })}
    </div>
  </div>;
});
