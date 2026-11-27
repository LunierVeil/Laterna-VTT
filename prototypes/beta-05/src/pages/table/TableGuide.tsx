import { useState } from 'react';
import { Button, Dialog } from '../../shared/ui';
import { DiceVisual } from '../../widgets/activity/DiceVisual';

const steps = [
  { title:'Осмотр стола', description:'Откройте список клавиш через /. Камера и инструменты находятся слева.' },
  { title:'Первое действие', description:'Закройте гид и нажмите «Действия». Выберите персонажа, выполните атаку или закрепите команду.' },
  { title:'Проверка роли', description:'Переключитесь в Player View, откройте свой лист и вернитесь к карте. Доступ к чужим листам ограничен.' },
  { title:'Подготовка сцены', description:'В GM View перейдите в редактор. Откройте Ассеты → Декали, сделайте предпросмотр, разместите декаль и отмените постановку.' },
];

export function TableGuide({ onClose, lowOpacity, onOpacity, dock, onDock }: {
  onClose: () => void; lowOpacity:boolean; onOpacity:(value:boolean)=>void; dock:boolean; onDock:(value:boolean)=>void;
}) {
  const [mode,setMode] = useState<'quick'|'extended'>('quick');
  const [step,setStep] = useState(0);
  const [dice,setDice] = useState<'volume'|'static'>('volume');
  const [roll,setRoll] = useState(0);
  const last = mode === 'quick' ? 1 : steps.length - 1;
  return <Dialog title="Гид по столу · PROPOSED" onClose={onClose}>
    <div className="segmented"><Button aria-pressed={mode==='quick'} onClick={()=>{setMode('quick');setStep(0);}}>Быстрое знакомство</Button>
      <Button aria-pressed={mode==='extended'} onClick={()=>{setMode('extended');setStep(0);}}>Практический сценарий</Button></div>
    <section className="character-block"><small>Шаг {step+1} / {last+1}</small><h3>{steps[step].title}</h3><p>{steps[step].description}</p>
      <div className="inline-form"><Button disabled={!step} onClick={()=>setStep(step-1)}>Назад</Button>
        <Button onClick={step===last?onClose:()=>setStep(step+1)}>{step===last?'К столу':'Далее'}</Button></div>
    </section>
    <section className="character-block"><h3>Варианты отображения · PROPOSED</h3>
      <label className="checkline"><input type="checkbox" checked={lowOpacity} onChange={e=>onOpacity(e.target.checked)}/>Полупрозрачная ширма вне фокуса</label>
      <label className="checkline"><input type="checkbox" checked={dock} onChange={e=>onDock(e.target.checked)}/>Быстрые действия у нижней панели</label>
      <div className="segmented"><Button aria-pressed={dice==='volume'} onClick={()=>setDice('volume')}>Объёмный d6</Button>
        <Button aria-pressed={dice==='static'} onClick={()=>setDice('static')}>Статичный результат</Button></div>
      <div className="inline-form"><Button onClick={()=>setRoll(roll+1)}>Повторить пример</Button>
        {dice==='volume'?<DiceVisual value={4} key={roll}/>:<output>4</output>}</div>
    </section>
  </Dialog>;
}
