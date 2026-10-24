// Giant SWITCH wordmark with a one-time typewriter reveal (S → W → I → T → C → H) and a blinking cursor.
// No layout shift: all six letters are laid out from the first frame; untyped letters are only visually hidden.
// Accessible: the heading exposes the full word "SWITCH"; the animated letters are aria-hidden.
// Runs once per page load (module flag), so unrelated re-renders or remounts never restart it.
import React, { useEffect, useState } from 'react';

const WORD = 'SWITCH';
const RHYTHM = [380, 150, 125, 170, 115, 160];   // natural, slightly irregular key timing (ms)
let typedOnce = false;

export default function TypewriterWordmark({ reducedMotion = false, onDone }) {
  const [n, setN] = useState(() => (typedOnce || reducedMotion ? WORD.length : 0));
  useEffect(() => {
    if (n >= WORD.length) { typedOnce = true; onDone?.(); return undefined; }
    const h = setTimeout(() => setN((x) => x + 1), RHYTHM[n] ?? 140);
    return () => clearTimeout(h);
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reducedMotion) setN(WORD.length); }, [reducedMotion]);
  const done = n >= WORD.length;
  return <h1 className={`wordmark ${done ? 'is-done' : 'is-typing'}`} aria-label="SWITCH" data-testid="wordmark" data-typed={n}>
    <span className="wordmark-inner" aria-hidden="true">
      {WORD.split('').map((ch, i) => <span key={i} className={`wm-l ${i < n ? 'on' : ''} ${ch === 'I' ? 'wm-i' : ''}`}>{ch}{i === n - 1 && <span className="wm-cursor" />}</span>)}
      {n === 0 && <span className="wm-cursor wm-cursor-start" />}
    </span>
  </h1>;
}
