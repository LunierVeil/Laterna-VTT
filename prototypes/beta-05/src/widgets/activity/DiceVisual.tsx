import type { CSSProperties } from 'react';
const forms: Record<number, [string, string, string]> = {
  4:['30,4 59,52 4,54','30,4 30,35 4,54','30,35 59,52 4,54'],
  6:['8,15 32,5 55,18 55,45 31,57 8,44','8,15 32,5 55,18 31,28','31,28 55,18 55,45 31,57'],
  8:['32,3 58,29 32,59 6,29','32,3 36,31 6,29','6,29 36,31 32,59'],
  10:['31,3 55,22 57,41 31,58 6,41 7,22','31,3 44,32 7,22','7,22 44,32 31,58 6,41'],
  12:['17,6 44,6 58,25 52,47 31,59 8,47 4,25','17,6 44,6 48,24 26,36 10,22','26,36 48,24 52,47 31,59 8,47'],
  20:['31,3 56,17 58,42 31,59 7,44 5,18','31,3 56,17 43,39 18,39 5,18','18,39 43,39 58,42 31,59 7,44'],
};
export type DiceStyle = 'lantern' | 'facet' | 'readout';
export function DiceGlyph({sides, value}: {sides:number; value?: number}) {
  const [outline, light, shade]=forms[sides] ?? forms[10];
  return <svg className={`die-glyph die-${sides}`} viewBox="0 0 64 64" aria-hidden="true">
    <polygon className="die-base" points={outline}/>
    <polygon className="die-light" points={light}/>
    <polygon className="die-shade" points={shade}/>
    <polygon className="die-edge" points={outline}/>
    {value!==undefined && <text x="31" y={sides===4?44:37} textAnchor="middle">{value}</text>}
  </svg>;
}
export function DiceVisual({ value, sides = 6, animate = true, legacy = false, index = 0 }: {value:number; sides?:number; animate?:boolean; legacy?:boolean; index?:number}) {
  return <span className={`die-visual ${animate?'dice-turn':''} ${legacy?'dice-legacy':''}`} style={{'--die-delay': `${index * 42}ms`, '--die-direction': index % 2 ? -1 : 1} as CSSProperties} aria-hidden="true"><DiceGlyph sides={sides} value={value}/></span>;
}
