import { test } from "node:test";
import assert from "node:assert/strict";
import { SceneSocket } from "../src/shared/api/scene-socket.ts";

test("seq gap requests a new connection and ignores the old socket", () => {
  const original = globalThis.WebSocket;
  const location = Object.getOwnPropertyDescriptor(globalThis, "location");
  const peers: Fake[] = [];
  class Fake {
    static OPEN = 1;
    readyState = 1;
    onmessage: any; onopen: any; onclose: any;
    closed = false;
    constructor(_url: string) { peers.push(this); }
    close() { this.closed = true; }
    send(_msg: string) {}
    receive(msg: object) { this.onmessage({data: JSON.stringify(msg)}); }
  }
  Object.defineProperty(globalThis, "location", {configurable: true, value: {protocol: "http:", host: "localhost"}});
  globalThis.WebSocket = Fake as any;
  const socket = new SceneSocket("scene");
  try {
    const messages: any[] = [];
    socket.on(m => messages.push(m));
    socket.connect();
    peers[0].onopen();
    peers[0].receive({type: "snapshot", seq: 3, scene: {}});
    peers[0].receive({type: "heartbeat"});
    peers[0].receive({type: "event", seq: 5, name: "fog.updated", payload: {}});
    assert.equal(peers[0].closed, true);
    assert.equal(messages.length, 1);
    socket.connect();
    peers[0].receive({type: "snapshot", seq: 1, scene: {}});
    assert.equal(messages.length, 1);
    peers[1].receive({type: "snapshot", seq: 5, scene: {}});
    peers[1].receive({type: "event", seq: 6, name: "fog.updated", payload: {}});
    assert.equal(messages.length, 3);
  } finally {
    socket.close();
    globalThis.WebSocket = original;
    if (location) Object.defineProperty(globalThis, "location", location);
    else delete (globalThis as any).location;
  }
});

function transport(t: any) {
  const old = globalThis.WebSocket, oldLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const peers: Peer[] = [];
  class Peer {
    static OPEN = 1;
    readyState = 1; onmessage: any; onopen: any; onclose: any;
    sent: any[] = []; closed = false;
    url: string;
    constructor(url: string) { this.url=url; peers.push(this); }
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    close() { if(this.closed) return; this.closed=true;this.readyState=3;this.onclose?.(); }
    receive(msg: object) { this.onmessage({data:JSON.stringify(msg)}); }
  }
  Object.defineProperty(globalThis,"location",{configurable:true,value:{protocol:"http:",host:"localhost"}});
  globalThis.WebSocket=Peer as any;
  t.mock.timers.enable({apis:["setTimeout","setInterval","Date"],now:100000});
  const sockets: SceneSocket[]=[];
  t.after(()=>{for(const s of sockets)s.close();globalThis.WebSocket=old;if(oldLocation)Object.defineProperty(globalThis,"location",oldLocation);else delete(globalThis as any).location;});
  return {peers, create:(id="first")=>{const s=new SceneSocket(id);sockets.push(s);s.connect();peers.at(-1)!.onopen();return s;}};
}

test("gap automatically reconnects with fresh snapshot; concurrent old messages cannot overwrite it", t=>{
  const h=transport(t),s=h.create(),messages:any[]=[];s.on(m=>messages.push(m));
  h.peers[0].receive({type:"snapshot",seq:8,scene:{fog:[]}});
  h.peers[0].receive({type:"event",seq:10,name:"fog.updated",payload:{fog:[{x:1}]}});
  assert.equal(h.peers[0].closed,true);
  t.mock.timers.tick(1000);assert.equal(h.peers.length,2);
  h.peers[1].onopen();h.peers[1].receive({type:"snapshot",seq:11,scene:{fog:[{x:2}]}});
  h.peers[0].receive({type:"snapshot",seq:1,scene:{fog:[]}});
  h.peers[1].receive({type:"event",seq:11,name:"noop",payload:{}});
  h.peers[1].receive({type:"event",seq:12,name:"fog.updated",payload:{fog:[]}});
  assert.deepEqual(messages.map(m=>m.seq),[8,11,12]);
  assert.deepEqual(messages[1].scene.fog,[{x:2}]);
});

test("disconnect rolls back unacknowledged movement once and does not replay it after reconnect",t=>{
  const h=transport(t),s=h.create();let applied=0,reverted=0;
  s.send("token.move",{id:"t",x:2,y:3},{apply:()=>applied++,revert:()=>reverted++});
  assert.equal(applied,1);assert.equal(h.peers[0].sent.length,1);
  h.peers[0].close();assert.equal(reverted,1);
  t.mock.timers.tick(1000);h.peers[1].onopen();h.peers[1].receive({type:"snapshot",seq:4,scene:{}});
  assert.equal(reverted,1);assert.deepEqual(h.peers[1].sent,[]);
});

test("scene switch cancels old retry and prevents messages from the old scene",t=>{
  const h=transport(t),first=h.create("old"),old:any[]=[];first.on(m=>old.push(m));
  h.peers[0].close();first.close();const current=h.create("new"),messages:any[]=[];current.on(m=>messages.push(m));
  t.mock.timers.tick(8000);assert.equal(h.peers.length,2);assert.match(h.peers[1].url,/\/new$/);
  h.peers[0].receive({type:"campaign",active_scene_id:"old"});assert.deepEqual(old,[]);
  h.peers[1].receive({type:"snapshot",seq:0,scene:{id:"new",fog:[{x:1}]}});
  assert.equal(messages[0].scene.id,"new");assert.deepEqual(messages[0].scene.fog,[{x:1}]);
});

test("heartbeat renews watchdog; silent transport closes and reconnects",t=>{
  const h=transport(t),s=h.create(),messages:any[]=[];s.on(m=>messages.push(m));
  t.mock.timers.tick(40000);h.peers[0].receive({type:"heartbeat"});
  t.mock.timers.tick(40000);assert.equal(h.peers[0].closed,false);assert.deepEqual(messages,[]);
  t.mock.timers.tick(10000);assert.equal(h.peers[0].closed,true);
  t.mock.timers.tick(1000);assert.equal(h.peers.length,2);
});

test("character deletion refresh requests reconnect and then accepts detached tokens",t=>{
  const h=transport(t),s=h.create(),messages:any[]=[];s.on(m=>messages.push(m));
  h.peers[0].receive({type:"snapshot",seq:2,scene:{tokens:[{id:"t",character_id:"mob",hp:7}]}});
  h.peers[0].receive({type:"tokens_refresh"});assert.equal(h.peers[0].closed,true);
  t.mock.timers.tick(1000);h.peers[1].onopen();
  h.peers[1].receive({type:"snapshot",seq:2,scene:{tokens:[{id:"t",character_id:null,hp:null}]}});
  assert.deepEqual(messages.at(-1).scene.tokens,[{id:"t",character_id:null,hp:null}]);
});

test("drag preview is outside seq, rejects stale/future samples, and disconnect notifies imperative renderer",t=>{
 const h=transport(t),s=h.create(),messages:any[]=[];let disconnected=0;s.on(m=>messages.push(m));s.onDisconnect(()=>disconnected++);
 h.peers[0].receive({type:'snapshot',seq:5,scene:{}});
 const preview={type:'token_preview',end:false,id:'token',drag_id:'drag',step:1,base_seq:5,x:20,y:30};
 h.peers[0].receive(preview);assert.equal(s.sequence,5);assert.equal(messages.at(-1).type,'token_preview');
 h.peers[0].receive({type:'event',seq:6,name:'token.moved',payload:{id:'token',x:20,y:30}});const n=messages.length;
 h.peers[0].receive({...preview,step:2});h.peers[0].receive({...preview,step:3,base_seq:7});assert.equal(messages.length,n);assert.equal(s.sequence,6);
 h.peers[0].receive({...preview,end:true,final:true});assert.equal(messages.at(-1).end,true);
 h.peers[0].close();assert.equal(disconnected,1);t.mock.timers.tick(1000);h.peers[1].receive({type:'snapshot',seq:6,scene:{messages:[]}});assert.equal(s.sequence,6);assert.equal(messages.at(-1).type,'snapshot');
});

test("send preserves command envelope and acknowledged optimistic changes survive disconnect", t=>{
  const h=transport(t),s=h.create();let applied=0,reverted=0;
  h.peers[0].receive({type:"snapshot",seq:3,scene:{}});
  const payload={id:"token",x:42,y:17};
  const id=s.send("token.move",payload,{apply:()=>applied++,revert:()=>reverted++});
  assert.match(id,/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
  assert.deepEqual(h.peers[0].sent,[{type:"cmd",id,name:"token.move",payload}]);
  assert.equal(applied,1);
  h.peers[0].receive({type:"event",seq:4,cmd_id:id,name:"token.moved",payload});
  h.peers[0].close();assert.equal(reverted,0);
  t.mock.timers.tick(1000);h.peers[1].receive({type:"snapshot",seq:4,scene:{}});
  assert.equal(reverted,0);assert.deepEqual(h.peers[1].sent,[]);
});

test("only the matching error rolls back an optimistic command and does so once",t=>{
  const h=transport(t),s=h.create();let reverted=0;
  const id=s.send("token.move",{id:"t"},{apply:()=>{},revert:()=>reverted++});
  h.peers[0].receive({type:"error",cmd_id:"unrelated",message:"rejected"});assert.equal(reverted,0);
  h.peers[0].receive({type:"error",cmd_id:id,message:"rejected"});assert.equal(reverted,1);
  h.peers[0].receive({type:"error",cmd_id:id,message:"duplicate"});assert.equal(reverted,1);
  h.peers[0].close();assert.equal(reverted,1);
});

test("send on connecting or closed transport returns an id without optimistic apply",t=>{
  const h=transport(t),s=h.create();let applied=0,reverted=0;
  const ids=[];
  for(const state of [0,3]){
    h.peers[0].readyState=state;
    ids.push(s.send("token.move",{id:"t"},{apply:()=>applied++,revert:()=>reverted++}));
  }
  assert.equal(new Set(ids).size,2);for(const id of ids)assert.equal(typeof id,"string");
  assert.deepEqual(h.peers[0].sent,[]);assert.equal(applied,0);
  h.peers[0].close();assert.equal(reverted,0);
});

test("explicit close of an open connection never reconnects or delivers late messages",t=>{
  const h=transport(t),s=h.create(),messages:any[]=[];s.on(m=>messages.push(m));
  s.close();assert.equal(h.peers[0].closed,true);
  h.peers[0].receive({type:"snapshot",seq:99,scene:{}});
  t.mock.timers.tick(60000);
  assert.equal(h.peers.length,1);assert.deepEqual(messages,[]);
});

test("auth_required is delivered and prevents retry after the server closes",t=>{
  const h=transport(t),s=h.create(),messages:any[]=[];s.on(m=>messages.push(m));
  h.peers[0].receive({type:"auth_required"});h.peers[0].close();
  t.mock.timers.tick(60000);
  assert.deepEqual(messages,[{type:"auth_required"}]);assert.equal(h.peers.length,1);
});
