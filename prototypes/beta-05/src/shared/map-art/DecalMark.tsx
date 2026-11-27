import type { DecalPattern } from '../../entities/model';

export const decalNames: Record<DecalPattern['kind'], string> = {
  tracks: 'Следы', stones: 'Каменная россыпь', cracks: 'Трещины', leaves: 'Листва', embers: 'Угли',
};

export function DecalMark({ pattern }: { pattern: DecalPattern }) {
  let seed = pattern.variant + 1;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return <g transform={`rotate(${pattern.rotation}) scale(${pattern.size / 80})`}>
    {Array.from({ length: pattern.kind === 'tracks' ? 8 : 16 }, (_, i) => {
      const x = (next() - .5) * 64, y = (next() - .5) * 56, size = 1 + next() * 5;
      switch (pattern.kind) {
        case 'tracks': return <ellipse key={i} cx={i * 9 - 32} cy={(i % 2 ? 7 : -7) + y / 6} rx="4" ry="2.6" fill="#ac8c67"/>;
        case 'stones': return <polygon key={i} points={`${x-size},${y} ${x},${y-size} ${x+size},${y-1} ${x+size/2},${y+size}`} fill="#9f9a86"/>;
        case 'cracks': return <path key={i} d={`M${x},${y}l${size*2},${size} -${size},${size*2} ${size},${size}`} stroke="#a39988" fill="none"/>;
        case 'leaves': return <ellipse key={i} cx={x} cy={y} rx={size} ry={size / 3} transform={`rotate(${x * 8},${x},${y})`} fill={i % 2 ? '#aa843e' : '#899559'}/>;
        case 'embers': return <circle key={i} cx={x} cy={y} r={size / 2} fill={i % 2 ? '#dd8445' : '#9e4d33'}/>;
      }
    })}
  </g>;
}
