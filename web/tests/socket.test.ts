import { test } from "node:test";
import assert from "node:assert/strict";
import { SceneSocket } from "../src/net/socket.ts";

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
