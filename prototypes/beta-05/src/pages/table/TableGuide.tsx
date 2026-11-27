import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../shared/ui';
import { X } from 'lucide-react';
import type { Role } from '../../entities/model';

type Step = [target: string, title: string, body: string];
type Route = 'intro' | 'scene' | 'session' | 'player' | 'update';
const routes: Record<Route, Step[]> = {
  intro: [
    ['actions','Игровые команды','Откройте панель действий. Из неё можно атаковать, менять HP и расходовать ресурсы.'],
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
  const [rect,setRect]=useState<DOMRect>();
  const [wallStart,setWallStart]=useState(wallCount);
  const steps=routes[route].filter(([target])=>sandbox || target!=='wall-map');
  const [target,title,body]=steps[step];
  const guideTarget = target==='wall-map' ? '.board-svg' : `[data-guide="${target}"]`;
  const next=()=>step===steps.length-1?onClose():setStep(step+1);
  useEffect(()=>{
    onHighlight(target);
    const locate=()=>{
      const element=document.querySelector(guideTarget);
      const box=element?.getBoundingClientRect();
      setRect(box && box.width && box.height ? box : undefined);
    };
    locate();
    const observer=new ResizeObserver(locate);
    const element=document.querySelector(guideTarget);
    if (element) observer.observe(element);
    window.addEventListener('resize',locate);
    window.addEventListener('scroll',locate,true);
    return ()=>{
      observer.disconnect();window.removeEventListener('resize',locate);window.removeEventListener('scroll',locate,true);
      onHighlight(undefined);
    };
  },[target,guideTarget,onHighlight]);
  useEffect(()=>{
    if(target==='wall-map' && wallCount>wallStart) {setWallStart(wallCount);next();}
  });
  useEffect(()=>{
    const advance=(event:MouseEvent)=>{
      if(target==='wall-map'||!(event.target instanceof Element)||!event.target.closest(guideTarget)) return;
      next();
    };
    document.addEventListener('click',advance);
    return ()=>document.removeEventListener('click',advance);
  });
  const cardWidth=Math.min(320,window.innerWidth-24);
  const left=rect?Math.max(12,Math.min(window.innerWidth-cardWidth-12,rect.left)):84;
  const top=rect?(rect.bottom+225<window.innerHeight?rect.bottom+10:Math.max(12,rect.top-205)):82;
  const outline=target!=='wall-map' && rect;
  return <>
    {outline && <div aria-hidden="true" className="guide-lens" style={{left:rect.left-3,top:rect.top-3,width:rect.width+6,height:rect.height+6}}/>}
    <aside className="table-guide guide-card glass" style={{left,top,width:cardWidth}} aria-label="Гид по столу" onKeyDown={event=>{
      if(event.key==='Escape'){event.stopPropagation();onClose();}
    }}>
      <header><select aria-label="Маршрут гида" value={route} onChange={event=>{setRoute(event.target.value as Route);setStep(0);setWallStart(wallCount);}}>
        {(['intro',...(role==='gm'?['scene','session']:['player']),'update'] as Route[]).map(id=><option value={id} key={id}>{names[id]}</option>)}
      </select><IconButton label="Закрыть гид" onClick={onClose}><X size={17}/></IconButton></header>
      <div aria-live="polite"><strong>{title}</strong><p>{body}</p></div>
      {!sandbox && route==='scene' && <a href="?review=guide-gm" target="_blank" rel="noopener">Практика на демонстрационной сцене</a>}
      <div className="inline-form"><Button disabled={!step} onClick={()=>setStep(step-1)}>Назад</Button>
        <Button onClick={next}>{step===steps.length-1?'Завершить':'Пропустить шаг'}</Button></div>
    </aside>
  </>;
}
