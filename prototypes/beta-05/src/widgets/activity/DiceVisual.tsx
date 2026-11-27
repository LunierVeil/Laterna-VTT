export function DiceVisual({ value, animate = true }: { value: number; animate?: boolean }) {
  const back = 7 - value;
  const side = [1, 2, 3, 4, 5, 6].find(face => face !== value && face !== back)!;
  const top = [1, 2, 3, 4, 5, 6].find(face => ![value, back, side, 7 - side].includes(face))!;
  return <span className="dice-visual" aria-hidden="true"><span className={animate ? 'dice-cube dice-turn' : 'dice-cube'}>
    {[value, side, back, 7 - side, top, 7 - top].map((face,index)=><b key={index}>{face}</b>)}
  </span></span>;
}
