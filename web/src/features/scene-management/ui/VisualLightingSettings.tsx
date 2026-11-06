import {useEffect,useRef,useState} from 'react';
import type {Scene,VisualLighting} from '../../../shared/api/protocol';
import type {SceneSocket} from '../../../shared/api/scene-socket';
import {uiActions} from '../../../state/public';

/** Explicit public, temporary GM settings. No token mapping or persisted drafts. */
export function VisualLightingSettings({socket,sceneId}:{socket:SceneSocket;sceneId:string}){
 const [supported,setSupported]=useState(false),[ambient,setAmbient]=useState<'none'|'full'>('full');
 const [sources,setSources]=useState<VisualLighting['sources']>([]),[enabled,setEnabled]=useState(false);
 const dirty=useRef(false);
 useEffect(()=>{
  dirty.current=false;setSupported(false);setEnabled(false);setSources([]);
  const apply=(scene:Scene)=>{
   if(scene.id!==sceneId)return;
   setSupported(scene.visuals!==undefined);setEnabled(Boolean(scene.visuals?.settings));
   if(!dirty.current){setAmbient(scene.visuals?.settings?.ambient??'full');setSources(scene.visuals?.settings?.sources??[]);}
  };
  const controller=new AbortController();
  void fetch(`/api/scenes/${sceneId}`,{credentials:'include',signal:controller.signal}).then(async r=>{if(!r.ok)return;const scene=await r.json();if(!controller.signal.aborted)apply(scene);}).catch(()=>{});
  const off=socket.on(m=>{if(m.type==='snapshot')apply(m.scene);});
  return()=>{controller.abort();off();};
 },[socket,sceneId]);
 if(!supported)return null;
 const submit=()=>{
  if(sources.some(s=>![s.x,s.y,s.radius].every(Number.isFinite)||s.radius<=0))return uiActions.flashError('Укажи конечные координаты и радиус больше нуля');
  dirty.current=false;socket.send('scene.visuals',{settings:{ambient,sources}});
 };
 return <details><summary>Свет и обзор (экспериментально)</summary>
  <p className="muted side-note">Публичные временные источники. Не сохраняются после перезапуска. {enabled?'Включено.':'Выключено.'}</p>
  <label>Окружающий свет<select aria-label="Окружающий свет" value={ambient} onChange={e=>{dirty.current=true;setAmbient(e.target.value as 'none'|'full');}}><option value="full">Полный</option><option value="none">Нет</option></select></label>
  {sources.map((s,index)=><fieldset key={index}><legend>Источник {index+1}</legend>
   {(['x','y','radius'] as const).map(key=><label key={key}>{key==='radius'?'Радиус, px':key.toUpperCase()}<input aria-label={`Источник ${index+1}: ${key}`} type="number" value={s[key]} onChange={e=>{dirty.current=true;setSources(rows=>rows.map((r,i)=>i===index?{...r,[key]:Number(e.target.value)}:r));}} /></label>)}
   <button type="button" className="tool" onClick={()=>{dirty.current=true;setSources(rows=>rows.filter((_,i)=>i!==index));}}>Убрать источник {index+1}</button>
  </fieldset>)}
  <button type="button" className="tool" disabled={sources.length>=15} onClick={()=>{dirty.current=true;setSources(rows=>[...rows,{x:100,y:100,radius:300}]);}}>Добавить источник</button>
  <button type="button" className="tool" onClick={submit}>Применить свет и обзор</button>
  <button type="button" className="tool" disabled={!enabled} onClick={()=>{dirty.current=false;socket.send('scene.visuals',{settings:null});}}>Выключить свет и обзор</button>
 </details>;
}
