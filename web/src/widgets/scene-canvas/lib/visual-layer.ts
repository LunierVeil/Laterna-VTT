import {Sprite,Texture} from 'pixi.js';
import type {VisualRequest,VisualResult} from './visual-worker';
/** Own canvas texture/worker; no renderer creation or per-frame geometry. */
export class VisualLayer{
 readonly sprite=new Sprite();
 private canvas=document.createElement('canvas');private lights=document.createElement('canvas');
 private texture:Texture;private worker:Worker;private generation=0;private busy=false;
 private pending:VisualRequest|null=null;private latest:VisualRequest|null=null;private destroyed=false;
 readonly timings:{cpu:number;paint:number}[]=[];updates=0;
 constructor(){
  this.texture=Texture.from(this.canvas);this.sprite.texture=this.texture;this.sprite.visible=false;this.sprite.eventMode='none';
  this.worker=new Worker(new URL('./visual-worker.ts',import.meta.url),{type:'module'});
  this.worker.onmessage=({data}:MessageEvent<VisualResult>)=>{this.busy=false;if(!this.destroyed&&data.generation===this.generation&&this.latest)this.paint(this.latest,data);this.flush();};
  this.worker.onerror=()=>{this.busy=false;this.pending=null;if(!this.destroyed&&this.latest)this.cover(this.latest);};
 }
 update(request:Omit<VisualRequest,'generation'>|null){
  if(this.destroyed)return;this.generation++;
  if(!request){this.pending=this.latest=null;this.sprite.visible=false;return;}
  const next={...request,generation:this.generation};
  if(!this.latest||next.width!==this.latest.width||next.height!==this.latest.height)this.cover(next);
  this.latest=next;this.pending=next;this.flush();
 }
 private flush(){if(this.destroyed||this.busy||!this.pending)return;const next=this.pending;this.pending=null;this.busy=true;this.worker.postMessage(next);}
 private size(r:VisualRequest){
  const scale=Math.min(1,1024/Math.max(r.width,r.height)),w=Math.max(1,Math.ceil(r.width*scale)),h=Math.max(1,Math.ceil(r.height*scale));
  if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=this.lights.width=w;this.canvas.height=this.lights.height=h;this.texture.source.resize(w,h);}
  this.sprite.width=r.width;this.sprite.height=r.height;this.sprite.alpha=r.gm?.35:1;this.sprite.visible=true;return {x:w/r.width,y:h/r.height};
 }
 private cover(r:VisualRequest){this.size(r);const c=this.canvas.getContext('2d')!;c.resetTransform();c.globalCompositeOperation='source-over';c.fillStyle='#000';c.fillRect(0,0,this.canvas.width,this.canvas.height);this.texture.source.update();}
 private path(c:CanvasRenderingContext2D,p:number[]){c.beginPath();for(let i=0;i<p.length;i+=2)i?c.lineTo(p[i],p[i+1]):c.moveTo(p[i],p[i+1]);c.closePath();}
 private paint(r:VisualRequest,result:VisualResult){
  const start=performance.now(),scale=this.size(r),c=this.canvas.getContext('2d')!,l=this.lights.getContext('2d')!;
  c.resetTransform();c.globalCompositeOperation='source-over';c.fillStyle='#000';c.fillRect(0,0,this.canvas.width,this.canvas.height);
  if(result.available){
   l.resetTransform();l.clearRect(0,0,this.lights.width,this.lights.height);l.save();l.scale(scale.x,scale.y);l.fillStyle='#fff';
   if(r.settings.ambient==='full')l.fillRect(0,0,r.width,r.height);
   else for(const light of result.lights){l.save();this.path(l,light.polygon);l.clip();l.beginPath();l.arc(light.x,light.y,light.radius,0,Math.PI*2);l.fill();l.restore();}
   l.restore();c.save();c.scale(scale.x,scale.y);if(result.observer!==null){this.path(c,result.observer);c.clip();}
   c.globalCompositeOperation='destination-out';c.drawImage(this.lights,0,0,r.width,r.height);c.restore();
  }
  this.texture.source.update();this.updates++;this.timings.push({cpu:result.milliseconds,paint:performance.now()-start});if(this.timings.length>64)this.timings.shift();
 }
 destroy(){if(this.destroyed)return;this.destroyed=true;this.generation++;this.worker.terminate();this.pending=this.latest=null;this.sprite.texture=Texture.EMPTY;this.texture.destroy(true);this.canvas.width=this.canvas.height=this.lights.width=this.lights.height=0;}
}
