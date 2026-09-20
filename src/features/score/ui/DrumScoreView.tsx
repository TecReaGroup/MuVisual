import { memo, useEffect, useMemo, useRef } from 'react';
import { Articulation, Barline, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveNote, Voice } from 'vexflow';
import type { Note, SongMetadata } from '../../../entities/music/model/types';
import type { MusicalTimeline } from '../../../entities/music/lib/musicalTimeline';
import { useI18n } from '../../../shared/i18n';
import { createDrumScore } from '../model/drumScore';

type Props = { notes: Note[]; bpm: number; timeline: MusicalTimeline; getElapsed: () => number; metadata?: SongMetadata | null };

// A quarter-note beat retains its original 128-unit width. Finer rhythms
// subdivide that space instead of increasing the width of the score.
const DRUM_QUARTER_WIDTH = 128;
const DRUM_GUTTER = 88;

export const DrumScoreView = memo(function DrumScoreView({ notes, bpm, timeline, getElapsed, metadata }: Props) {
  const { language } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const rows = useRef<Array<{ row: HTMLDivElement; cursor: HTMLSpanElement }>>([]);
  const score = useMemo(() => createDrumScore(notes, timeline, metadata), [notes, timeline, metadata]);
  const layout = useMemo(() => {
    const stepWidth = DRUM_QUARTER_WIDTH / 8;
    const measureWidth = score.measureSteps * stepWidth;
    return { stepWidth, measureWidth, width: DRUM_GUTTER + measureWidth * 2 + 16 };
  }, [score.measureSteps]);
  useEffect(() => {
    const container = host.current!;
    container.replaceChildren();
    if (!notes.length) return;
    const { stepWidth, measureWidth, width } = layout;
    const gutter = DRUM_GUTTER;
    rows.current = [];
    const pending: Array<() => void> = [];
    for (let firstMeasure = 0; firstMeasure < score.measures.length; firstMeasure += 2) {
      const row = document.createElement('div');
      row.className = 'drum-system';
      row.style.aspectRatio = `${width} / 210`;
      const engraving = document.createElement('div');
      row.append(engraving);
      const cursor = document.createElement('span');
      cursor.className = 'drum-cursor';
      cursor.setAttribute('aria-hidden', 'true');
      row.append(cursor);
      container.append(row);
      rows.current.push({ row, cursor });
      pending.push(() => {
      const renderer = new Renderer(engraving, Renderer.Backends.SVG);
      renderer.resize(width, 210);
      engraving.querySelector('svg')!.setAttribute('viewBox', `0 0 ${width} 210`);
      const context = renderer.getContext();
      context.setFillStyle('#171a20').setStrokeStyle('#171a20');
      for (let measure = firstMeasure; measure < Math.min(firstMeasure + 2, score.measures.length); measure++) {
      const parts = score.measures[measure];
      const voices = parts.map((cells, voiceIndex) => {
        const engraved = cells.map(cell => {
          const dotted = cell.length === 3 || cell.length === 6 || cell.length === 12;
          const duration = cell.length >= 8 ? '4' : cell.length >= 4 ? '8' : cell.length >= 2 ? '16' : '32';
          const note = new StaveNote({ keys: cell.hits.length ? [...new Set(cell.hits.map(hit => hit.key))] : [voiceIndex ? 'd/4' : 'g/5'],
            duration: duration + (dotted ? 'd' : '') + (cell.hits.length ? '' : 'r'), stem_direction: voiceIndex ? -1 : 1,
            glyph_font_scale: 32, stroke_px: 2 });
          if (dotted) {
            Dot.buildAndAttach([note], { all: true });
            note.getModifiers().forEach(modifier => {
              if (modifier instanceof Dot) modifier.setWidth(4);
            });
          }
          if (cell.hits.some(hit => hit.open)) note.addModifier(new Articulation('ah').setPosition(3), 0);
          return note;
        });
        const beams = Beam.generateBeams(engraved, { groups: [new Fraction(score.groupSteps, 32)], stem_direction: voiceIndex ? -1 : 1 });
        beams.forEach(beam => {
          beam.render_options.beam_width = 3;
          beam.render_options.partial_beam_length = 6;
          if (!beam.getNotes().some(note => note.getDuration() === '32')) return;
          // Keep the primary beam across the beat, subdividing dense groups at
          // actual eighth boundaries, including groups starting after a rest.
          beam.breakSecondaryAt(beam.getNotes().flatMap((note, index) => {
            const cell = cells[engraved.indexOf(note as StaveNote)];
            return (cell.step + cell.length) % 4 === 0 ? [index] : [];
          }));
        });
        return { engraved, beams, voice: new Voice({ num_beats: score.numerator, beat_value: score.denominator }).addTickables(engraved) };
      });
      const formatter = new Formatter().joinVoices(voices.map(part => part.voice));
        const left = gutter + (measure - firstMeasure) * measureWidth;
        // Put barlines halfway between grid slots, leaving the downbeat clear.
        const staveLeft = measure === firstMeasure ? 8 : left - stepWidth / 2;
        const staveRight = left + measureWidth - stepWidth / 2;
        const stave = new Stave(staveLeft, 45, staveRight - staveLeft);
        if (measure !== firstMeasure) stave.setBegBarType(Barline.type.NONE);
        if (measure === firstMeasure) stave.addClef('percussion');
        if (measure === 0) stave.addTimeSignature(`${score.numerator}/${score.denominator}`);
        stave.setNoteStartX(left);
        stave.setContext(context).draw();
        context.setFont('sans-serif', 11).fillText(String(measure + 1).padStart(2, '0'), left + 4, 24);
        // formatToStave only derives a width; it does not attach the stave.
        // Absolute note coordinates must include the stave offset before placement.
        voices.forEach(part => part.voice.setStave(stave).preFormat());
        formatter.formatToStave(voices.map(part => part.voice), stave);
        // Keep VexFlow's vertical collision handling, but place shared tick
        // contexts on a uniform time axis before beams are post-formatted.
        const placed = new Set<object>();
        voices.forEach((part, voiceIndex) => part.engraved.forEach((note, cellIndex) => {
          const tick = note.getTickContext();
          if (placed.has(tick)) return;
          placed.add(tick);
          const target = left + parts[voiceIndex][cellIndex].step * stepWidth;
          tick.setX(tick.getX() + target - note.getAbsoluteX() - note.getGlyphWidth() / 2);
        }));
        voices.forEach(part => {
          part.beams.forEach(beam => { beam.postFormatted = false; beam.postFormat(); });
          part.voice.draw(context);
          part.beams.forEach(beam => beam.setContext(context).draw());
        });
      }
      });
    }
    let renderFrame = 0;
    const renderNextRow = () => {
      pending.shift()?.();
      if (pending.length) renderFrame = requestAnimationFrame(renderNextRow);
    };
    renderFrame = requestAnimationFrame(renderNextRow);
    return () => { cancelAnimationFrame(renderFrame); rows.current = []; container.replaceChildren(); };
  }, [score, layout, notes.length]);

  useEffect(() => {
    const { width, stepWidth } = layout;
    let scale = (host.current?.clientWidth ?? width) / width;
    let lastX = Number.NaN;
    const observer = new ResizeObserver(() => {
      scale = (rows.current[0]?.row.clientWidth ?? width) / width;
      lastX = Number.NaN;
    });
    if (host.current) observer.observe(host.current);
    let frame = 0;
    let activeRow: HTMLElement | undefined;
    const drawCursor = () => {
      const step = Math.max(0, timeline.positionAt(getElapsed()) * score.stepsPerPulse);
      const rowIndex = Math.min(rows.current.length - 1, Math.floor(step / (score.measureSteps * 2)));
      const current = rows.current[rowIndex];
      if (current) {
        if (activeRow !== current.row) {
          activeRow?.removeAttribute('data-active');
          activeRow = current.row;
          activeRow.setAttribute('data-active', 'true');
          activeRow.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
          lastX = Number.NaN;
        }
        const rowSteps = Math.min(2, score.measures.length - rowIndex * 2) * score.measureSteps;
        const x = (DRUM_GUTTER + Math.min(rowSteps, step - rowIndex * score.measureSteps * 2) * stepWidth) * scale;
        if (x !== lastX) {
          current.cursor.style.transform = `translate3d(${x}px, 0, 0)`;
          lastX = x;
        }
      }
      frame = requestAnimationFrame(drawCursor);
    };
    drawCursor();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); activeRow?.removeAttribute('data-active'); };
  }, [score, layout, timeline, getElapsed]);
  const zh = language === 'zh';
  return <div className="score-stage"><div className="score-sheet drum-sheet">
    <div className="score-heading"><div><span>{zh ? 'MIDI 五线谱鼓谱' : 'MIDI DRUM NOTATION'}</span><strong>{zh ? '架子鼓' : 'Drum kit'}</strong></div><div className="score-meta">{score.numerator}/{score.denominator} · {bpm} BPM</div></div>
    {!notes.length && <p className="drum-legend">{zh ? '当前鼓轨没有 MIDI 音符。' : 'No MIDI notes in this drum track.'}</p>}
    <div ref={host} />
  </div></div>;
});
