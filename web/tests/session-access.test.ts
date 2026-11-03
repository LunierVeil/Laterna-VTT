import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Match Vite's extensionless TS imports without replacing the store or access code.
registerHooks({resolve(specifier,context,next){
  try{return next(specifier,context);}catch(error){
    if(specifier.startsWith(".")&&!/\.[a-z]+$/i.test(specifier))return next(specifier+".ts",context);
    throw error;
  }
}});

const originalLocation=Object.getOwnPropertyDescriptor(globalThis,"location");
const originalHistory=Object.getOwnPropertyDescriptor(globalThis,"history");
const location={href:"https://table.example/?gm=bootstrap-key&invite=invite-token&keep=1#table"};
const replaced:string[]=[];
Object.defineProperty(globalThis,"location",{configurable:true,value:location});
Object.defineProperty(globalThis,"history",{configurable:true,value:{replaceState(_state:unknown,_title:string,url:URL){location.href=String(url);replaced.push(location.href);}}});
const originalStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>null}});
const access=await import("../src/app/session/access.ts");
if(originalLocation)Object.defineProperty(globalThis,"location",originalLocation);else delete(globalThis as any).location;
if(originalHistory)Object.defineProperty(globalThis,"history",originalHistory);else delete(globalThis as any).history;
const {useUi}=await import("../src/state/store.ts");
if(originalStorage)Object.defineProperty(globalThis,"localStorage",originalStorage);else delete(globalThis as any).localStorage;

test("access consumes gm then invite once at module load and preserves unrelated URL state",async()=>{
  assert.equal(access.GM_KEY_FROM_URL,"bootstrap-key");assert.equal(access.INVITE_FROM_URL,"invite-token");
  assert.equal(replaced.length,2);
  assert.equal(new URL(replaced[0]).searchParams.has("gm"),false);
  assert.equal(new URL(replaced[0]).searchParams.has("invite"),true);
  assert.equal(location.href,"https://table.example/?keep=1#table");
  // A second consumer (or StrictMode rerender) sees the same cached module without browser globals.
  const again=await import("../src/app/session/access.ts");assert.equal(again,access);assert.equal(replaced.length,2);
});

test("gmKeyLogin preserves setup, session, error and request contracts",async t=>{
  const user={id:"gm",name:"GM",is_gm:true},previous=useUi.getState().me;
  t.after(()=>useUi.getState().setMe(previous));
  const replies=[Response.json({needs_setup:true}),Response.json(user),Response.json({detail:"ключ отклонён"},{status:403}),new Response("invalid",{status:403})];
  const fetch=t.mock.method(globalThis,"fetch",async()=>replies.shift()!);
  const setup:string[]=[];
  assert.equal(await access.gmKeyLogin("setup-key",key=>setup.push(key)),null);
  assert.deepEqual(setup,["setup-key"]);assert.equal(useUi.getState().me,previous);
  assert.equal(await access.gmKeyLogin("valid-key",key=>setup.push(key)),null);assert.deepEqual(useUi.getState().me,user);
  assert.equal(await access.gmKeyLogin("invalid-key",key=>setup.push(key)),"ключ отклонён");
  assert.equal(await access.gmKeyLogin("invalid-key",key=>setup.push(key)),"ключ ГМ не подошёл");
  assert.deepEqual(setup,["setup-key"]);
  assert.deepEqual(fetch.mock.calls[0].arguments,["/api/gm/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"setup-key"})}]);
});
