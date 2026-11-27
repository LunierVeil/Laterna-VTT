import type { DecalPattern } from '../../entities/model';

export const decalNames: Record<DecalPattern['kind'], string> = {
  blood:'Кровь', mud:'Грязь', tracks:'Следы', stones:'Каменная россыпь', cracks:'Трещины',
};

function random(seed: number) {
  let state=(seed+1)>>>0;
  return (min=0,max=1)=>{
    state^=state<<13;state^=state>>>17;state^=state<<5;
    return min+(max-min)*(state>>>0)/4294967296;
  };
}
function contour(x:number,y:number,stretch:number,radii:number[]) {
  const points=radii.map((r,i)=>{
    const angle=i*Math.PI*2/radii.length;
    return [x+Math.cos(angle)*r*stretch,y+Math.sin(angle)*r];
  });
  const midpoint=(a:number[],b:number[])=>[(a[0]+b[0])/2,(a[1]+b[1])/2].join(' ');
  return 'M'+midpoint(points.at(-1)!,points[0])+points.map((point,i)=>
    'Q'+point.join(' ')+' '+midpoint(point,points[(i+1)%points.length])).join(' ')+'Z';
}

export function DecalMark({pattern}:{pattern:DecalPattern}) {
  const rnd=random(pattern.variant * 11939 + 34817);
  const color = pattern.kind==='blood' ? ['#4d1e1e','#702329','#a34639'] : ['#493627','#654e36','#967b52'];
  const blob=(x:number,y:number,r:number,stretch:number)=>contour(x,y,stretch,
    Array.from({length:14},(_,i)=>r*(1+.20*Math.sin(i*1.9)+rnd(-.28,.29))));
  return <g transform={`rotate(${pattern.rotation}) scale(${pattern.size/80})`}>
    {(pattern.kind==='blood'||pattern.kind==='mud') && <>
      {Array.from({length:5},(_,i)=>{
        const x=rnd(-22,22),y=rnd(-15,15),r=rnd(6,13),stretch=rnd(.85,1.7);
        return <g key={i}>
          <path d={blob(x,y,r+3,stretch)} fill={color[0]} opacity=".18"/>
          <path d={blob(x,y,r,stretch)} fill={color[i%2]} opacity={rnd(.55,.86)}/>
          <path d={blob(x-1,y-2,r*.68,stretch)} fill={color[1]} opacity=".40"/>
        </g>;
      })}
      {Array.from({length:pattern.kind==='blood'?24:64},(_,i)=>{
        const x=rnd(-42,42),y=rnd(-28,28),r=pattern.kind==='blood'?rnd(.35,2.55):rnd(.24,.88);
        return <path key={i} d={blob(x,y,r,rnd(.8,1.8))} fill={color[i%3]} opacity={rnd(.16,.67)}/>;
      })}
    </>}
    {pattern.kind==='tracks' && Array.from({length:7},(_,i)=>{
      const x=-34+i*11+rnd(-1,1), y=(i%2?6:-6)+rnd(-2,2)+Math.sin(i*.58)*6;
      const angle=79+(i%2?-8:8)+rnd(-12,12);
      return <g key={i} opacity={rnd(.35,.78)} transform={`translate(${x} ${y}) rotate(${angle}) scale(${rnd(.84,1.10)})`} fill="#6c513a">
        <path d="M-3.4 1.1Q-5.5-2.3-4.2-6.8Q-3.1-10.1.5-10.4Q4.5-10 4.7-6.8Q4.6-3.5 2.2.4L1.6 2.6-2.2 2.6Z"/>
        <path d="M-2.4 4L1.7 3.9Q3.1 7 1.4 8.8Q-.1 9.8-2.4 8.8Q-3.5 7.3-2.4 4Z"/>
        <path d="M-3-7L3-6M-3.5-5L3-4M-2.7-2.5L2.1-1.4M-2 5.7L1.1 5.5" stroke="#b19a76" opacity=".45" strokeWidth=".8"/>
      </g>;
    })}
    {pattern.kind==='stones' && Array.from({length:17},(_,i)=>{
      const radius=rnd(4,36),a=rnd(0,6.28);
      const x=Math.cos(a)*radius,y=Math.sin(a)*radius*.67,r=rnd(1.6,8.5)*(1-radius/65);
      const p=[[-1,.1],[-.58,-.74],[.24,-.91],[.9,-.12],[.66,.72],[-.46,.82]]
        .map(([px,py])=>[x+px*r*rnd(.83,1.24),y+py*r*rnd(.83,1.24)]);
      const edge=p.map(point=>point.join(',')).join(' ');
      return <g key={i}><polygon points={edge} transform="translate(1.4 1.8)" fill="#211b18" opacity=".59"/>
        <polygon points={edge} fill={i%2?'#7a786b':'#958b77'}/>
        <polygon points={[...p.slice(0,3),[x+r*.1,y+r*.14]].map(point=>point.join(',')).join(' ')} fill="#b5ae94" opacity=".67"/>
        <polygon points={[p[3],p[4],p[5],[x+r*.1,y+r*.14]].map(point=>point.join(',')).join(' ')} fill="#454139" opacity=".66"/></g>;
    })}
    {pattern.kind==='cracks' && Array.from({length:5},(_,arm)=>{
      const angle=arm*1.21+rnd(-.20,.20);
      let x=rnd(-3,3),y=rnd(-3,3);
      const points=Array.from({length:6},(_,i)=>{
        const a=angle+rnd(-.53,.53), len=rnd(4,7.8);
        const from=[x,y];x+=Math.cos(a)*len;y+=Math.sin(a)*len*.76;
        return {path:`M${from.join(' ')} L${x} ${y}`,branch:i===1||i===3?
          `M${x} ${y} l${Math.cos(a+.8)*len} ${Math.sin(a+.8)*len} ${Math.cos(a+.45)*4} ${Math.sin(a+.45)*4}`:null};
      });
      return <g key={arm} fill="none" strokeLinecap="round">{points.map(({path,branch},i)=><g key={i}>
        <path d={path} transform="translate(.6 .75)" stroke="#b0a38d" strokeWidth={2-i*.21} opacity=".52"/>
        <path d={path} stroke="#302922" strokeWidth={1.7-i*.24}/>
        {branch && <path d={branch} stroke="#40382e" strokeWidth={.85-i*.08}/>}
      </g>)}</g>;
    })}
  </g>;
}
