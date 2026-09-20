import { numberForChord } from '../lib/chordNotation';

export function NumberedChord({ chord, keySignature }: { chord: string; keySignature: string }) {
  const notation = numberForChord(chord, keySignature);
  if (!notation) return <>{chord}</>;
  return <span className="numbered-chord">
    {notation.root}{notation.quality}{notation.extension && <sup>{notation.extension}</sup>}{notation.bass && <>/{notation.bass}</>}
  </span>;
}
