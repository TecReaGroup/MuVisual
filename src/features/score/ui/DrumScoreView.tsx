import { memo, useEffect, useMemo, useRef } from 'react';
import { Articulation, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveNote, Voice } from 'vexflow';
import type { Note, SongMetadata } from '../../../entities/music/model/types';
import type { MusicalTimeline } from '../../../entities/music/lib/musicalTimeline';
import { useI18n } from '../../../shared/i18n';
import { createDrumScore } from '../model/drumScore';

type Props = { notes: Note[]; bpm: number; timeline: MusicalTimeline; getElapsed: () => number; metadata?: SongMetadata | null };

export const DrumScoreView = memo(function DrumScoreView({ notes, bpm, timeline, getElapsed, metadata }: Props) {
  const { language } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const score = useMemo(() => createDrumScore(notes, timeline, metadata), [notes, timeline, metadata]);
  useEffect(() => {
    const container = host.current!;
    container.replaceChildren();
    if (!notes.length) return;
    const positions: Array<{ step: number; x: number; row: HTMLElement; cursor: SVGLineElement }> = [];
    const measures = score.measures.map(parts => {
      const voices = parts.map((cells, voiceIndex) => {
        const engraved = cells.map(cell => {
          const dotted = cell.length === 3 || cell.length === 6;
          const duration = cell.length === 6 || cell.length === 4 ? '4' : cell.length >= 2 ? '8' : '16';
          const note = new StaveNote({ keys: cell.hits.length ? [...new Set(cell.hits.map(hit => hit.key))] : [voiceIndex ? 'd/4' : 'g/5'],
            duration: duration + (dotted ? 'd' : '') + (cell.hits.length ? '' : 'r'), stem_direction: voiceIndex ? -1 : 1 });
          if (dotted) Dot.buildAndAttach([note], { all: true });
          if (cell.hits.some(hit => hit.open)) note.addModifier(new Articulation('ah').setPosition(3), 0);
          return note;
        });
        const beams = Beam.generateBeams(engraved, { groups: [new Fraction(score.groupSteps, 16)], stem_direction: voiceIndex ? -1 : 1 });
        return { engraved, beams, voice: new Voice({ num_beats: score.numerator, beat_value: score.denominator }).addTickables(engraved) };
      });
      const formatter = new Formatter().joinVoices(voices.map(part => part.voice));
      const minimumWidth = formatter.preCalculateMinTotalWidth(voices.map(part => part.voice)) + 110;
      return { parts, voices, formatter, minimumWidth };
    });
    // A shared measure width keeps barlines aligned between systems. SVG owns
    // both notation and cursor coordinates, including when the sheet is scaled.
    const measureWidth = Math.max(440, ...measures.map(measure => measure.minimumWidth));
    const width = measureWidth * 2 + 16;
    container.style.minWidth = `${width}px`;
    for (let firstMeasure = 0; firstMeasure < measures.length; firstMeasure += 2) {
      const row = document.createElement('div');
      row.className = 'drum-system';
      container.append(row);
      const renderer = new Renderer(row, Renderer.Backends.SVG);
      renderer.resize(width, 210);
      const svg = row.querySelector('svg')!;
      svg.setAttribute('viewBox', `0 0 ${width} 210`);
      const context = renderer.getContext();
      context.setFillStyle('#171a20').setStrokeStyle('#171a20');
      const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      cursor.setAttribute('class', 'drum-cursor');
      cursor.setAttribute('y1', '38');
      cursor.setAttribute('y2', '158');
      cursor.setAttribute('aria-hidden', 'true');
      for (let measure = firstMeasure; measure < Math.min(firstMeasure + 2, measures.length); measure++) {
        const { parts, voices, formatter } = measures[measure];
        const left = 8 + (measure - firstMeasure) * measureWidth;
        const stave = new Stave(left, 45, measureWidth);
        if (measure === firstMeasure) stave.addClef('percussion');
        if (measure === 0) stave.addTimeSignature(`${score.numerator}/${score.denominator}`);
        stave.setNoteStartX(left + 80);
        stave.setContext(context).draw();
        context.setFont('sans-serif', 11).fillText(String(measure + 1).padStart(2, '0'), left + 4, 24);
        formatter.formatToStave(voices.map(part => part.voice), stave);
        voices.forEach(part => { part.voice.draw(context, stave); part.beams.forEach(beam => beam.setContext(context).draw()); });
        const anchors = new Map<number, number>();
        voices.forEach((part, index) => part.engraved.forEach((note, cell) => {
          // Tick positions align voices; the glyph centre locates the playback line.
          const step = parts[index][cell].step;
          if (!anchors.has(step)) anchors.set(step, note.getAbsoluteX() + note.getGlyphWidth() / 2);
        }));
        [...anchors].sort((a, b) => a[0] - b[0]).forEach(([step, x]) => positions.push({ step: measure * score.measureSteps + step, x, row, cursor }));
        positions.push({ step: (measure + 1) * score.measureSteps, x: left + measureWidth, row, cursor });
      }
      svg.append(cursor);
    }
    let frame = 0;
    let activeRow: HTMLElement | undefined;
    const drawCursor = () => {
      const step = Math.max(0, timeline.positionAt(getElapsed()) * score.stepsPerPulse);
      let low = 0, high = positions.length;
      while (low < high) { const mid = (low + high) >>> 1; if (positions[mid].step <= step) low = mid + 1; else high = mid; }
      const current = positions[Math.max(0, low - 1)];
      const next = positions[low];
      if (current) {
        if (activeRow !== current.row) {
          activeRow?.removeAttribute('data-active');
          activeRow = current.row;
          activeRow.setAttribute('data-active', 'true');
          activeRow.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        const x = next && next.row === current.row ? current.x + (next.x - current.x) * (step - current.step) / (next.step - current.step) : current.x;
        current.cursor.setAttribute('x1', String(x));
        current.cursor.setAttribute('x2', String(x));
      }
      frame = requestAnimationFrame(drawCursor);
    };
    drawCursor();
    return () => { cancelAnimationFrame(frame); container.replaceChildren(); };
  }, [score, timeline, getElapsed, notes.length]);
  const zh = language === 'zh';
  return <div className="score-stage"><div className="score-sheet drum-sheet">
    <div className="score-heading"><div><span>{zh ? 'MIDI 五线谱鼓谱' : 'MIDI DRUM NOTATION'}</span><strong>{zh ? '架子鼓' : 'Drum kit'}</strong></div><div className="score-meta">{score.numerator}/{score.denominator} · {bpm} BPM</div></div>
    {!notes.length && <p className="drum-legend">{zh ? '当前鼓轨没有 MIDI 音符。' : 'No MIDI notes in this drum track.'}</p>}
    <div ref={host} />
  </div></div>;
});
