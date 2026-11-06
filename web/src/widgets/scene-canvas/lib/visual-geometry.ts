/** Visual approximation ONLY: never a permission/media predicate. */
export type Point={x:number;y:number};
export type Segment={x1:number;y1:number;x2:number;y2:number;kind?:string;door_state?:string;blocks_sight?:boolean};
export const VISUAL_EPSILON_PX=1e-4,MAX_VISUAL_WALLS=200,MAX_VISUAL_EVENTS=4096;
const cross=(ax:number,ay:number,bx:number,by:number)=>ax*by-ay*bx;
const finite=(...xs:number[])=>xs.every(Number.isFinite);
const distance=(p:Point,s:Segment)=>{const dx=s.x2-s.x1,dy=s.y2-s.y1,t=Math.max(0,Math.min(1,((p.x-s.x1)*dx+(p.y-s.y1)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-s.x1-t*dx,p.y-s.y1-t*dy);};
export class VisualGeometry{
 readonly segments:Segment[]=[];readonly events:Point[]=[];readonly valid:boolean;
 readonly width:number;readonly height:number;
 constructor(width:number,height:number,walls:readonly Segment[]){
  this.width=width;this.height=height;
  this.valid=finite(width,height)&&width>0&&height>0&&walls.length<=MAX_VISUAL_WALLS;if(!this.valid)return;
  for(const w of walls){
   if(!finite(w.x1,w.y1,w.x2,w.y2)||!['wall','door'].includes(w.kind??'wall')){this.valid=false;return;}
   if(w.kind==='door'&&!['open','closed','locked'].includes(w.door_state??'')){this.valid=false;return;}
   if(w.x1===w.x2&&w.y1===w.y2)continue;
   if(w.kind==='door'?w.door_state==='open':w.blocks_sight===false)continue;
   this.segments.push(w);
  }
  this.segments.push({x1:0,y1:0,x2:width,y2:0},{x1:width,y1:0,x2:width,y2:height},{x1:width,y1:height,x2:0,y2:height},{x1:0,y1:height,x2:0,y2:0});
  for(const s of this.segments)this.events.push({x:s.x1,y:s.y1},{x:s.x2,y:s.y2});
  // Crossing walls create angular events; collinear endpoints already exist.
  for(let i=0;i<this.segments.length;i++)for(let j=0;j<i;j++){
   const a=this.segments[i],b=this.segments[j],ax=a.x2-a.x1,ay=a.y2-a.y1,bx=b.x2-b.x1,by=b.y2-b.y1,d=cross(ax,ay,bx,by);if(d===0)continue;
   const t=cross(b.x1-a.x1,b.y1-a.y1,bx,by)/d,u=cross(b.x1-a.x1,b.y1-a.y1,ax,ay)/d;
   if(t>=0&&t<=1&&u>=0&&u<=1)this.events.push({x:a.x1+t*ax,y:a.y1+t*ay});
   if(this.events.length>MAX_VISUAL_EVENTS){this.valid=false;return;}
  }
 }
 polygon(o:Point):number[]{
  if(!this.valid||!finite(o.x,o.y)||o.x<0||o.y<0||o.x>this.width||o.y>this.height)return [];
  if(this.segments.slice(0,-4).some(s=>distance(o,s)<=VISUAL_EPSILON_PX))return [];
  const rays:number[]=[],p:number[]=[];
  for(const e of this.events){const dx=e.x-o.x,dy=e.y-o.y,r=Math.hypot(dx,dy);if(!r)continue;const a=Math.atan2(dy,dx),delta=Math.atan2(VISUAL_EPSILON_PX,r);rays.push(a-delta,a,a+delta);}
  rays.sort((a,b)=>a-b);
  for(const angle of rays){const dx=Math.cos(angle),dy=Math.sin(angle);let nearest=Infinity;
   for(const s of this.segments){const sx=s.x2-s.x1,sy=s.y2-s.y1,d=cross(dx,dy,sx,sy);if(d===0)continue;const qx=s.x1-o.x,qy=s.y1-o.y,t=cross(qx,qy,sx,sy)/d,u=cross(qx,qy,dx,dy)/d;if(t>=0&&u>=0&&u<=1)nearest=Math.min(nearest,t);}
   if(!Number.isFinite(nearest))return [];
   p.push(Math.max(0,Math.min(this.width,o.x+nearest*dx)),Math.max(0,Math.min(this.height,o.y+nearest*dy)));
  }return p;
 }
}
