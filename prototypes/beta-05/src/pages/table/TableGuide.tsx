import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../shared/ui';
import { X } from 'lucide-react';
import type { Role } from '../../entities/model';

const introduction = [
  {title:'Осмотр стола', description:'Откройте список клавиш через /. Инструменты карты находятся слева.', target:'tools'},
  {title:'Первое действие', description:'Откройте «Действия» над картой и попробуйте атаку или закрепление.', target:'actions'},
];
const practice = {
  gm: [
    {title:'Ширма мастера', description:'Откройте ширму. Перетащите её за верхнюю полосу и измените размер за край.', target:'screen'},
    {title:'Подготовка сцены', description:'Откройте редактор карты. В ассетах выберите декаль, измените размер и разместите её.', target:'edit'},
  ],
  player: [
    {title:'Свой лист', description:'Откройте «Мой лист». Сравните боевые показатели и вкладку заклинаний.', target:'sheet'},
    {title:'Бросок', description:'Откройте «Кубики» или бросьте из листа. Итог появится над столом.', target:'dice'},
  ],
};

export function TableGuide({ role, onClose, onHighlight }: { role:Role; onClose:()=>void; onHighlight:(target?:string)=>void }) {
  const [extended, setExtended] = useState(false);
  const [step,setStep] = useState(0);
  const steps = extended ? [...introduction, ...practice[role]] : introduction;
  const current = steps[step];
  useEffect(() => {
    onHighlight(current.target);
    return () => onHighlight(undefined);
  }, [current.target, onHighlight]);
  const next = () => step === steps.length-1 ? onClose() : setStep(step+1);
  return <aside className="table-guide glass" aria-label="Гид по столу" onKeyDown={event=>{
    if (event.key==='Escape') {event.stopPropagation();onClose();}
  }}>
    <header><strong>Гид по столу</strong><IconButton label="Закрыть гид" onClick={onClose}><X size={17}/></IconButton></header>
    <div className="segmented" aria-label="Маршрут гида">
      <Button aria-pressed={!extended} onClick={()=>{setExtended(false);setStep(0);}}>Знакомство</Button>
      <Button aria-pressed={extended} onClick={()=>{setExtended(true);setStep(0);}}>Практика {role === 'gm' ? 'мастера' : 'игрока'}</Button>
    </div>
    <div aria-live="polite"><small>Шаг {step+1} / {steps.length}</small><h3>{current.title}</h3><p>{current.description}</p></div>
    <div className="inline-form"><Button disabled={!step} onClick={()=>setStep(step-1)}>Назад</Button>
      {step < steps.length-1 && <Button onClick={next}>Пропустить шаг</Button>}
      <Button className="primary" onClick={next}>{step===steps.length-1?'Завершить':'Далее'}</Button></div>
  </aside>;
}
