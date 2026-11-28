import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, IconButton } from '../../shared/ui';
import { X } from 'lucide-react';
import type { Role } from '../../entities/model';

type Step = [target: string, title: string, body: string];
type Route = 'intro' | 'scene' | 'session' | 'player' | 'update';
const routes: Record<Route, Step[]> = {
  intro: [
    ['actions','Игровые команды','Откройте действия в карточке своего героя или вкладку «Партия» у мастера.'],
    ['dice','Кубики','Откройте меню, чтобы выбрать гранность, количество и режим. Итог появится над столом.'],
  ],
  scene: [
    ['scenes','Подготовить сцену','Откройте сцены. Здесь можно выбрать карту, импортировать UVTT и показать подготовленную сцену игрокам.'],
    ['edit','Редактор карты','Включите редактор. Карта останется доступной для размещения объектов.'],
    ['geometry','Стены и двери','Откройте геометрию. Два клика на карте задают отрезок стены или двери.'],
    ['wall-map','Пробная стена','Поставьте две точки на карте. Стена сохранится в этой демонстрационной вкладке.'],
    ['light','Свет','Выберите свет. Радиус, цвет и мерцание доступны в свойствах источника.'],
  ],
  session: [
    ['actors','Герои и существа','Откройте список. Здесь создаются карточки и размещаются токены для текущей сцены.'],
    ['connection','Приглашение','Откройте подключение. В прототипе здесь показан сценарий приглашения.'],
    ['combat','Провести бой','Откройте бой. Настройте инициативу и передавайте ход из очереди.'],
    ['journal','Материалы','Откройте журнал. Здесь ведут записи и готовят раздатки.'],
  ],
  player: [
    ['player-token','Свой токен','Выберите токен. Перетащите его в демонстрационной сцене.'],
    ['sheet','Свой лист','Откройте лист. Вкладки хранят инвентарь, заклинания и способности.'],
    ['actions','Действие без листа','Откройте закреплённые атаки, проверки, ячейки и ресурсы.'],
    ['dice','Бросок','Откройте кубики. Выберите гранность или соберите смешанный набор.'],
    ['chat','Чат','Перейдите в чат, чтобы увидеть сообщения и броски.'],
    ['handouts','Раздатки','Откройте раздатки, доступные вашему персонажу.'],
  ],
  update: [
    ['actions','Новые игровые команды','Откройте быстрые действия. В настройке можно закрепить навыки и спасброски.'],
    ['dice','Новое меню бросков','Откройте кубики. Количество доступно прямо рядом с модификатором.'],
  ],
};
const names: Record<Route,string> = {intro:'Знакомство',scene:'Подготовка сцены',session:'Проведение игры',player:'Практика игрока',update:'Что нового'};

export function TableGuide({ role, initial, sandbox, wallCount, onClose, onHighlight }: {
  role:Role; initial?: Route; sandbox:boolean; wallCount:number; onClose:()=>void; onHighlight:(target?:string)=>void;
}) {
  const [route,setRoute]=useState<Route>(initial ?? 'intro');
  const [step,setStep]=useState(0);
  const [modal,setModal]=useState<HTMLDialogElement>();
  const card=useRef<HTMLElement>(null);
  const lens=useRef<HTMLDivElement>(null);
  const [wallStart,setWallStart]=useState(wallCount);
  const steps=routes[route].filter(([target])=>sandbox || target!=='wall-map');
  const [target,title,body]=steps[step];
  const guideTarget = target==='wall-map' ? '.board-svg' : `[data-guide="${target}"]`;
  const next=()=>step===steps.length-1?onClose():setStep(step+1);
  useLayoutEffect(()=>{
    function findModal() {
      setModal(Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1));
    }
    const observer=new MutationObserver(findModal);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
    findModal();
    return ()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{
    onHighlight(modal ? undefined : target);
    if (modal) return;
    const area=(a: DOMRect,b: DOMRect)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)) *
      Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    const obstacles='.table-header,.activity,.board-footer,.board-controls,.player-party,.inspector,.floating-window,.docked-workbench,.gm-screen,.review-bar,dialog[open]';
    let frame=0;
    function locate(){
      const node=card.current, outline=lens.current;
      if(!node || !outline) return;
      const found=document.querySelector(guideTarget)?.getBoundingClientRect();
      const board=document.querySelector('.board')?.getBoundingClientRect();
      const {width,height}=node.getBoundingClientRect();
      const fallback=new DOMRect((board?.left??70)+12,(board?.top??55)+12,0,0);
      const anchor=target!=='wall-map' && found?.width && found.height?found:fallback;
      const blocks=Array.from(document.querySelectorAll(obstacles),n=>n.getBoundingClientRect());
      const anchors=[
        [anchor.left,anchor.bottom+12],[anchor.left,anchor.top-height-12],
        [anchor.right+12,anchor.top],[anchor.left-width-12,anchor.top],
        [fallback.x,fallback.y],[(board?.right??window.innerWidth)-width-12,fallback.y],
        [fallback.x,(board?.bottom??window.innerHeight)-height-92],
      ];
      const candidates=anchors.map(([x,y])=>new DOMRect(
        Math.max(12,Math.min(x,window.innerWidth-width-12)),
        Math.max(12,Math.min(y,window.innerHeight-height-12)),width,height));
      const score=(r: DOMRect)=>area(r,anchor)*100+blocks.reduce((n,b)=>n+area(r,b),0);
      const pos=candidates.reduce((best,r)=>score(r)<score(best)?r:best);
      node.style.left=pos.x+'px';node.style.top=pos.y+'px';
      outline.hidden=anchor===fallback;
      if(!outline.hidden) Object.assign(outline.style,{left:anchor.left-3+'px',top:anchor.top-3+'px',width:anchor.width+6+'px',height:anchor.height+6+'px'});
    }
    function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(locate);}
    const observer=new ResizeObserver(schedule);
    const mutation=new MutationObserver(schedule);
    for(const element of document.querySelectorAll(obstacles+','+guideTarget)) observer.observe(element);
    if(card.current) observer.observe(card.current);
    const app=document.querySelector('#root');
    if(app) mutation.observe(app,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','transform','open']});
    window.addEventListener('resize',schedule);
    window.addEventListener('scroll',schedule,true);
    locate();
    return ()=>{
      cancelAnimationFrame(frame);observer.disconnect();mutation.disconnect();
      window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);
      onHighlight(undefined);
    };
  },[target,guideTarget,onHighlight,modal]);
  useEffect(()=>{
    if(target==='wall-map' && wallCount>wallStart) {setWallStart(wallCount);next();}
  });
  useEffect(()=>{
    let frame=0;
    const advance=(event:Event)=>{
      if(target==='wall-map'||!(event.target instanceof Element)) return;
      const anchor=event.target.closest(guideTarget);
      if(!anchor) return;
      frame=requestAnimationFrame(()=>{
        if(anchor.getAttribute('aria-pressed')==='true' || anchor.getAttribute('aria-expanded')==='true' ||
          anchor.getAttribute('data-selected')==='true' ||
          target==='sheet' && document.querySelector('.docked-sheet') ||
          (target==='journal'||target==='handouts') && document.querySelector('.docked-journal') ||
          target==='connection' && document.querySelector('dialog[open]') ||
          target==='combat' && document.querySelector('.combat-panel')) next();
      });
    };
    const keyboard=(event:KeyboardEvent)=>{
      if(target==='player-token' && [' ','Enter'].includes(event.key)) advance(event);
    };
    document.addEventListener('click',advance);
    document.addEventListener('keydown',keyboard);
    return ()=>{
      cancelAnimationFrame(frame);
      document.removeEventListener('click',advance);
      document.removeEventListener('keydown',keyboard);
    };
  },[target,step,guideTarget,onClose]);
  return createPortal(<>
    <div ref={lens} aria-hidden="true" className="guide-lens" hidden/>
    <aside ref={card} className={`table-guide guide-card glass ${modal ? 'guide-in-dialog' : ''}`} aria-label="Гид по столу" onKeyDown={event=>{
      if(event.key==='Escape'){event.stopPropagation();onClose();}
    }}>
      <header><select aria-label="Маршрут гида" value={route} onChange={event=>{setRoute(event.target.value as Route);setStep(0);setWallStart(wallCount);}}>
        {(['intro',...(role==='gm'?['scene','session']:['player']),'update'] as Route[]).map(id=><option value={id} key={id}>{names[id]}</option>)}
      </select><IconButton label="Закрыть гид" onClick={onClose}><X size={17}/></IconButton></header>
      {modal && <small>Закройте текущее окно, чтобы продолжить на столе.</small>}
      <div aria-live="polite"><strong>{title}</strong><p>{body}</p></div>
      {!sandbox && route==='scene' && <a href="?review=guide-gm" target="_blank" rel="noopener">Практика на демонстрационной сцене</a>}
      <div className="inline-form"><Button disabled={!step} onClick={()=>setStep(step-1)}>Назад</Button>
        <Button onClick={next}>{step===steps.length-1?'Завершить':'Пропустить шаг'}</Button></div>
    </aside>
  </>,modal ?? document.body);
}
