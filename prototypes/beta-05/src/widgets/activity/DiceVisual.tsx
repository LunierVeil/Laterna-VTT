export function DiceVisual({ value, sides = 6, animate = true }: { value: number; sides?: number; animate?: boolean }) {
  if (sides !== 6) return <span className="dice-visual" aria-hidden="true">
    <span className={`dice-poly dice-poly-${sides} ${animate ? 'dice-turn' : ''}`}><b>{value}</b></span>
  </span>;
  const back = 7 - value;
  const side = [1, 2, 3, 4, 5, 6].find(face => face !== value && face !== back)!;
  const top = [1, 2, 3, 4, 5, 6].find(face => ![value, back, side, 7 - side].includes(face))!;
  return <span className="dice-visual" aria-hidden="true"><span className={animate ? 'dice-cube dice-turn' : 'dice-cube'}>
    {[value, side, back, 7 - side, top, 7 - top].map((face,index)=><b key={index}>{face}</b>)}
  </span></span>;
}
