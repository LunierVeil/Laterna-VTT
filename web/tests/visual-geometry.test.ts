import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VisualGeometry} from '../src/widgets/scene-canvas/lib/visual-geometry.ts';
const inside=(p:number[],x:number,y:number)=>{let yes=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>y)!==(p[j+1]>y)&&x<(p[j]-p[i])*(y-p[i+1])/(p[j+1]-p[i+1])+p[i])yes=!yes;return yes;};
const wall={x1:50,y1:0,x2:50,y2:100,kind:'wall',blocks_sight:true};
test('visual walls and ordinary door states',()=>{for(const state of ['closed','locked','open']){const p=new VisualGeometry(100,100,[{...wall,kind:'door',door_state:state}]).polygon({x:25,y:50});assert.equal(inside(p,75,50),state==='open');assert.ok(inside(p,30,50));}});
test('bounds, intersections, reverse/duplicate and zero segments',()=>{
 const walls=[wall,{...wall,x1:0,y1:40,x2:100,y2:60},{...wall,x1:10,x2:10,y1:10,y2:10}];
 const a=new VisualGeometry(100,100,walls).polygon({x:25,y:20}),b=new VisualGeometry(100,100,[...walls,...walls].reverse().map(w=>({...w,x1:w.x2,y1:w.y2,x2:w.x1,y2:w.y1}))).polygon({x:25,y:20});
 for(const [x,y] of [[25,25],[75,20],[25,80],[75,80]])assert.equal(inside(a,x,y),inside(b,x,y));assert.ok(a.every(v=>Number.isFinite(v)&&v>=0&&v<=100));assert.ok(!inside(a,75,20));
});
test('on obstacle, unsupported W3, invalid and budget inputs',()=>{
 assert.deepEqual(new VisualGeometry(100,100,[wall]).polygon({x:50,y:50}),[]);
 for(const g of [new VisualGeometry(100,100,[{...wall,kind:'window'}]),new VisualGeometry(NaN,100,[]),new VisualGeometry(100,100,Array(201).fill(wall))])assert.equal(g.valid,false);
});
test('narrow doorway stays open away from approximation edges',()=>{const p=new VisualGeometry(100,100,[{...wall,y2:49},{...wall,y1:51}]).polygon({x:25,y:50});assert.ok(inside(p,75,50));assert.ok(!inside(p,75,60));});
