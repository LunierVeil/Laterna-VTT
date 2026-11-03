import { test } from "node:test";
import assert from "node:assert/strict";
import { safeUpload, uploadImage } from "../src/shared/api/upload.ts";

const limits={maxBytes:4,maxSide:100,what:"картинка"};
const file=()=>new File(["data"],"image.png",{type:"image/png"});
function bitmap(t:any,impl:(file:File)=>Promise<unknown>){
  const previous=Object.getOwnPropertyDescriptor(globalThis,"createImageBitmap");
  const mock=t.mock.fn(impl);
  Object.defineProperty(globalThis,"createImageBitmap",{configurable:true,value:mock});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,"createImageBitmap",previous);else delete(globalThis as any).createImageBitmap;});
  return mock;
}

test("safeUpload accepts only canonical local image paths",()=>{
  const stem="/uploads/"+"a".repeat(32);
  for(const ext of ["png","jpg","webp"])assert.equal(safeUpload(`${stem}.${ext}`),`${stem}.${ext}`);
  for(const value of [null,undefined,42,{},"",`https://example.com${stem}.png`,`//example.com${stem}.png`,`${stem}.svg`,`${stem}.jpeg`,`${stem}.PNG`,`${stem}.png?x=1`,`${stem}.png#x`,`${stem}/../image.png`,`${stem.slice(0,-1)}.png`,`${stem.toUpperCase()}.png`,` ${stem}.png`])assert.equal(safeUpload(value),null,String(value));
});

test("uploadImage rejects excess bytes before decoding or fetching",async t=>{
  const decode=bitmap(t,async()=>{throw Error("must not decode");});
  const fetch=t.mock.method(globalThis,"fetch",async()=>{throw Error("must not fetch");});
  await assert.rejects(uploadImage(file(),{...limits,maxBytes:3}),{message:`файл больше ${3/1024/1024} МБ`});
  assert.equal(decode.mock.callCount(),0);assert.equal(fetch.mock.callCount(),0);
});

test("uploadImage reports unsupported image decoding without an HTTP request",async t=>{
  bitmap(t,async()=>{throw Error("decoder failure");});
  const fetch=t.mock.method(globalThis,"fetch",async()=>{throw Error("must not fetch");});
  await assert.rejects(uploadImage(file(),limits),{message:"это не картинка или формат не поддерживается"});
  assert.equal(fetch.mock.callCount(),0);
});

test("uploadImage checks both image sides and closes each rejected bitmap",async t=>{
  let width=101,height=100,closed=0;
  bitmap(t,async()=>({width,height,close:()=>closed++}));
  const fetch=t.mock.method(globalThis,"fetch",async()=>{throw Error("must not fetch");});
  for(const dimensions of [[101,100],[100,101]]){
    [width,height]=dimensions;
    await assert.rejects(uploadImage(file(),limits),{message:`картинка ${width}×${height}, максимум 100 по стороне - уменьши`});
  }
  assert.equal(closed,2);assert.equal(fetch.mock.callCount(),0);
});

test("uploadImage accepts exact limits, closes bitmap and posts the original File with default session behavior",async t=>{
  let closed=0;const image=file(),url="/uploads/"+"b".repeat(32)+".png";
  const decode=bitmap(t,async()=>({width:100,height:99,close:()=>closed++}));
  const fetch=t.mock.method(globalThis,"fetch",async()=>{assert.equal(closed,1);return Response.json({url});});
  assert.deepEqual(await uploadImage(image,limits),{url,width:100,height:99});
  assert.deepEqual(decode.mock.calls[0].arguments,[image]);assert.equal(fetch.mock.callCount(),1);
  assert.deepEqual(fetch.mock.calls[0].arguments,["/api/uploads",{method:"POST",body:image}]);
});

test("uploadImage preserves server detail and fallback errors for non-JSON responses",async t=>{
  let closed=0;bitmap(t,async()=>({width:10,height:10,close:()=>closed++}));
  const responses=[Response.json({detail:"нет доступа"},{status:403}),new Response("invalid",{status:502})];
  const fetch=t.mock.method(globalThis,"fetch",async()=>responses.shift()!);
  await assert.rejects(uploadImage(file(),limits),{message:"нет доступа"});
  await assert.rejects(uploadImage(file(),limits),{message:"загрузка не удалась (502)"});
  assert.equal(fetch.mock.callCount(),2);assert.equal(closed,2);
});

test("uploadImage propagates network errors after releasing the bitmap",async t=>{
  let closed=0;const error=new TypeError("network failure");
  bitmap(t,async()=>({width:10,height:10,close:()=>closed++}));
  t.mock.method(globalThis,"fetch",async()=>{throw error;});
  await assert.rejects(uploadImage(file(),limits),e=>e===error);assert.equal(closed,1);
});
