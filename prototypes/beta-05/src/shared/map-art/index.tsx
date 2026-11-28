import { memo, useId } from 'react';

const noise = (n: number) => {
  const value = Math.sin(n * 78.233 + 12.91) * 43758.5453;
  return value - Math.floor(value);
};
const trees = Array.from({ length: 138 }, (_, i) => ({
  x: Math.round(noise(i * 9) * 1200 - 100),
  y: Math.round(noise(i * 9 + 1) * 840 - 40),
  r: Math.round(noise(i * 9 + 2) * 31 + 12),
  tilt: noise(i * 9 + 3) * 90,
})).filter(({ x, y }) => (x < 297 || x > 777 || y < 150 || y > 687) && !(x > 365 && x < 627 && y > 622));
const pebbles = Array.from({ length: 290 }, (_, i) => ({ x: noise(i * 3) * 1100, y: noise(i * 3 + 1) * 760, r: noise(i * 3 + 2) * 3 + .5 }));
const nave = 'M382 211Q382 169 418 146L480 112 545 146Q581 169 581 211V273H763V485H645V537H572V629H397V537H316V481H248V282H382Z';
const water = 'M0 511Q164 483 255 572T473 710Q666 755 794 602T1100 531V760H0Z';

export const MapArt = memo(function MapArt({ art = 'abbey' }: { art?: 'abbey' | 'crypt' | 'woods' }) {
  const id = useId();
  const url = (name: string) => `url(#${id}-${name})`;
  const crypt = art === 'crypt';
  const woods = art === 'woods';
  return <g aria-hidden>
    <defs>
      <radialGradient id={`${id}-land`}><stop stopColor={crypt ? '#453e4e' : '#4c5243'}/><stop offset=".62" stopColor={crypt ? '#272630' : '#303d34'}/><stop offset="1" stopColor="#121b20"/></radialGradient>
      <radialGradient id={`${id}-tree`} cx=".34" cy=".32"><stop stopColor={crypt ? '#3d3e42' : '#4a5944'}/><stop offset=".53" stopColor={crypt ? '#272934' : '#303e31'}/><stop offset="1" stopColor="#17241f"/></radialGradient>
      <linearGradient id={`${id}-water`} x2=".5" y2="1"><stop stopColor="#34494b"/><stop offset="1" stopColor="#17282f"/></linearGradient>
      <linearGradient id={`${id}-stone`} x2="1" y2="1"><stop stopColor="#7b7764"/><stop offset="1" stopColor="#494d43"/></linearGradient>
      <pattern id={`${id}-flags`} width="64" height="43" patternUnits="userSpaceOnUse">
        <rect width="64" height="43" fill={crypt ? '#474553' : '#55564b'}/>
        <path d="M0 1h64M0 22h64M3 0v22m28-22v22m-14 0v21m35-21v21" fill="none" stroke="#222722" strokeWidth="1.5" opacity=".65"/>
        <path d="M4 4h24v15H4zM33 4h29v15H33zM19 25h30v14H19z" fill="#b3a994" opacity=".07"/>
        <path d="m7 15 5-3 5 2m24 20 4-4 5 2m-6-23 4 1 3 5" stroke="#282b27" opacity=".45" fill="none"/>
      </pattern>
      <pattern id={`${id}-wood`} width="18" height="65" patternUnits="userSpaceOnUse">
        <rect width="18" height="65" fill="#504637"/><path d="M1 0v65M4 10q6 13 0 32M13 3v39M1 42h17" stroke="#2d2923" opacity=".65" fill="none"/>
        <path d="M7 2v29m9 11v20" stroke="#a7875f" opacity=".22"/>
      </pattern>
      <filter id={`${id}-noise`} x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".67" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
      <clipPath id={`${id}-waterclip`}><path d={water}/></clipPath>
    </defs>
    <rect width="1100" height="760" fill={url('land')}/>
    <path d="M100 466Q223 387 319 451T567 522Q768 498 970 322M226 145Q302 237 371 279M784 194Q812 312 999 365M402 654Q471 609 492 550" fill="none" stroke="#868064" strokeWidth="44" opacity=".11"/>
    {pebbles.map(({x,y,r}, i) => <ellipse key={i} cx={x} cy={y} rx={r * 2.2} ry={r} fill={i % 3 ? '#9c9b7e' : '#191e1b'} opacity=".22"/>)}
    <path d={water} fill={url('water')} stroke="#8b9474" strokeWidth="20" strokeOpacity=".16"/>
    <g clipPath={url('waterclip')}>
      {Array.from({ length: 76 }, (_, i) => {
        const x = noise(i * 3 + 2) * 1130 - 15, y = 525 + noise(i * 3 + 1) * 242, w = 6 + noise(i * 3) * 60;
        return <path key={i} d={`M${x} ${y}q${w / 2} -4 ${w} 0`} fill="none" stroke={i % 3 ? '#88a6a0' : '#10232a'} opacity={.12 + (i % 5) * .042}/>;
      })}
    </g>
    {trees.map(({x,y,r,tilt}, i) => <g key={i} transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <ellipse cx="5" cy="7" rx={r * 1.16} ry={r * .94} fill="#101815" opacity=".64"/>
      <path d={`M0 ${-r}Q${r*.8} ${-r*1.05} ${r*.87} ${-r*.4}Q${r*1.26} 0 ${r*.65} ${r*.42}Q${r*.65} ${r*1.03} 0 ${r*.87}Q${-r*.72} ${r*1.1} ${-r*.83} ${r*.46}Q${-r*1.16} 0 ${-r*.68} ${-r*.39}Q${-r*.61} ${-r*.87} 0 ${-r}Z`} fill={url('tree')} stroke="#63775b" strokeOpacity=".13"/>
      <path d={`M0 0 ${-r*.5} ${-r*.2}M0 0 ${r*.28} ${-r*.49}M0 0 ${r*.42} ${r*.3}M0 0 ${-r*.26} ${r*.43}`} stroke="#9caa82" opacity=".13" fill="none"/>
      <circle r={r * .27} cx={-r * .15} cy={-r * .23} fill="#778565" opacity=".12"/>
    </g>)}
    <g transform={woods ? 'translate(0 0)' : 'translate(0 -5)'}>
      <path d="M431 741V615H531V741" fill={url('wood')} stroke="#242622" strokeWidth="8"/>
      {[623, 661, 704, 741].map(y => <g key={y}><path d={`M422 ${y}h119`} stroke="#777057" strokeWidth="5"/><circle cx="425" cy={y} r="5" fill="#393228"/><circle cx="538" cy={y} r="5" fill="#393228"/></g>)}
    </g>
    {!woods && !crypt && <>
      <path d={nave} fill="#141b18" stroke="#131816" strokeWidth="31" transform="translate(9 12)" opacity=".85"/>
      <path d={nave} fill={url('flags')} stroke="#252a26" strokeWidth="17"/>
      <path d={nave} fill="none" stroke={url('stone')} strokeWidth="10"/>
      <path d={nave} fill="none" stroke="#b7b099" strokeWidth="1.4" strokeDasharray="16 3" opacity=".42"/>
      <path d="M393 273v48m0 54v104h-31m-47 0h-63M581 272v43m0 49v113h66m49 0h67M316 537h91m47 0h67m48 0h76M405 629h35m81 0h51" stroke="#272c28" strokeWidth="13" fill="none"/>
      <path d="M393 273v48m0 54v104h-31m-47 0h-63M581 272v43m0 49v113h66m49 0h67M316 537h91m47 0h67m48 0h76M405 629h35m81 0h51" stroke={url('stone')} strokeWidth="7" fill="none"/>
      <path d="M397 327v43m180-47v35m74 119h39M410 537h38m76 0h40m-78 92h31m-75 0h34" stroke="#aa8d5f" strokeWidth="2" opacity=".66" fill="none"/>
      <path d="M413 227v-25q0-32 67-68 68 35 68 68v25Z" fill="#7a7868" stroke="#393b31" strokeWidth="4"/>
      <path d="M418 221h126m-122-7h117m-110-8h103" stroke="#33372f" opacity=".66"/>
      <path d="M448 235h68v225h-68Z" fill={crypt ? '#4d465b' : '#67483c'} stroke="#b99667" strokeWidth="2" opacity=".8"/>
      <path d="M454 243h56v209h-56Z" fill="none" stroke="#c6a370" strokeDasharray="4 5" opacity=".56"/>
      <path d="m482 319 18 26-18 26-18-26Z" fill="none" stroke="#bd946b" opacity=".68"/>
      <rect x="448" y="209" width="66" height="27" rx="3" fill="#a39a7d" stroke="#3a3b31" strokeWidth="4"/>
      <path d="M456 214h50v15h-50Z" fill="#736c57" stroke="#c3ae78"/>
      {[286, 319, 352, 385, 418].map(y => <g key={y}>
        <path d={`M407 ${y}h32m87 0h36`} stroke="#2c2b24" strokeWidth="12"/>
        <path d={`M408 ${y-2}h30m89 0h34`} stroke="#8b7554" strokeWidth="7"/>
        <path d={`M410 ${y-4}h26m93 0h30`} stroke="#b99d6d" strokeOpacity=".48"/>
      </g>)}
      <path d="M256 291h124v179H256zM594 283h161v185H594z" fill={url('wood')} opacity=".79"/>
      {[276, 319, 349].map((x,i) => <g key={x}><rect x={x} y={300+i*42} width="20" height="29" rx="2" fill="#746046" stroke="#352c24" strokeWidth="4"/><path d={`M${x+4} ${310+i*42}h13m-13 7h13`} stroke="#9c805b"/></g>)}
      <g transform="rotate(-10 314 418)">
        <rect x="281" y="399" width="65" height="36" rx="3" fill="#8b7856" stroke="#352b22" strokeWidth="4"/>
        <path d="M283 411h62m-62 12h62" stroke="#514333" opacity=".8"/>
        <rect x="299" y="406" width="17" height="14" rx="1" fill="#b6a583" transform="rotate(12 299 406)"/>
      </g>
      {[307, 355, 403, 444].map((y,i) => <g key={y}><rect x={i % 2 ? 722 : 739} y={y-10} width={i%2 ? 27 : 14} height="23" fill="#715940" stroke="#2c241c" strokeWidth="3"/><path d={`M741 ${y-6}h8m-8 5h8m-8 5h8`} stroke="#af9063" opacity=".66"/></g>)}
      <g transform="rotate(6 676 380)"><rect x="650" y="343" width="56" height="75" rx="4" fill="#3e5350" stroke="#a09464" strokeWidth="2"/><rect x="660" y="354" width="37" height="53" rx="2" fill="#775d41" stroke="#312922" strokeWidth="4"/><path d="M669 365h16v14h-16Zm11 26h10v8h-10Z" fill="#c0ac86" opacity=".85"/></g>
      <path d="M385 606q46-44 98-2t92-1v18H398Z" fill="#3f6365" opacity=".42"/>
      <path d="M334 489q35-12 48 12t48 20M592 514q18-18 38-22" fill="none" stroke="#638884" strokeWidth="10" opacity=".25"/>
    </>}
    {crypt && <>
      <path d="M311 251h137v-65h220v65h115v282H659v75H446v-75H311Z" fill="#171721" stroke="#15171c" strokeWidth="27"/>
      <path d="M311 251h137v-65h220v65h115v282H659v75H446v-75H311Z" fill={url('flags')} stroke="#74707b" strokeWidth="9"/>
      <path d="M325 272h444v243H325ZM465 204h185v53H465ZM467 536h173v52H467Z" fill="none" stroke="#a79883" strokeWidth="1.5" opacity=".4"/>
      <circle cx="556" cy="388" r="93" fill="#403746" stroke="#80747e" strokeWidth="4"/>
      <circle cx="556" cy="388" r="78" fill="none" stroke="#aa997e" strokeDasharray="3 7" opacity=".65"/>
      <path d="m556 320 61 68-61 68-61-68Z" fill="#272532" stroke="#82747d" strokeWidth="2"/>
      <path d="M535 351h42l12 65h-66Z" fill="#73707b" stroke="#2f2c37" strokeWidth="4"/>
      <path d="m556 359 13 28-13 22-13-22Z" fill="none" stroke="#afa395"/>
      {[290, 361, 432].map(y => <g key={y}>
        {[362, 695].map(x => <g key={x}><rect x={x} y={y} width="43" height="56" rx="5" fill="#66626f" stroke="#302f3a" strokeWidth="5"/>
          <path d={`M${x + 8} ${y + 12}h27v33h-27Z`} fill="#85808b" opacity=".45"/>
          <path d={`M${x + 21} ${y + 18}v20m-6 -12h12`} stroke="#a9a098" opacity=".7"/>
        </g>)}
      </g>)}
      <path d="M489 555h132m-132 11h132m-132 11h132M480 222h156" stroke="#252732" strokeWidth="2"/>
      {[464, 642].map(x => <g key={x}>{[283, 488].map(y => <circle key={y} cx={x} cy={y} r="12" fill="#4c4c54" stroke="#a29a91" strokeOpacity=".55" strokeWidth="3"/>)}</g>)}
    </>}
    {woods && <>
      <path d="M436 654Q414 562 471 467T527 235Q516 176 565 101" fill="none" stroke="#6d7057" strokeWidth="48" opacity=".42"/>
      <path d="M440 650Q421 563 475 466T530 237Q519 174 569 106" fill="none" stroke="#9a8c67" strokeWidth="14" strokeOpacity=".25" strokeDasharray="19 12"/>
      <path d="M393 584h137v36H393Z" fill={url('wood')} stroke="#2c2c28" strokeWidth="6"/>
      <path d="M475 510l7 24m-53 24 12 19m57-84-9 19" stroke="#b0a07e" opacity=".64" strokeWidth="4"/>
      <circle cx="579" cy="479" r="27" fill="#453c30" stroke="#a09273" strokeWidth="5" strokeDasharray="6 4"/>
      <path d="m565 485 25-12m-17-9 12 28" stroke="#9d7353" strokeWidth="3"/>
    </>}
    <rect width="1100" height="760" filter={url('noise')} opacity=".17" style={{ mixBlendMode: 'soft-light' }}/>
  </g>;
});

export function MapThumbnail({ art }: { art: 'abbey' | 'crypt' | 'woods' }) {
  return <svg className="map-thumbnail" viewBox={art === 'woods' ? '225 290 600 450' : '170 85 725 550'} preserveAspectRatio="xMidYMid slice" aria-hidden><MapArt art={art}/></svg>;
}
