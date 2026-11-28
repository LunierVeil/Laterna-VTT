import { useState } from 'react';
import type { Actor, SheetSpell } from '../../entities/model';
import { Button, Empty, IconButton } from '../../shared/ui';
import { ArrowDown, ArrowUp, Pin, X } from 'lucide-react';
import type { Roll } from '../../features/roster';
import { attackRows, damageRoll, skillRows, spendSpellSlot } from '../../features/roster/gameplay';

interface Action {
  key: string; name: string; disabled?: boolean; run: () => void;
  damage?: () => void;
}

export interface QuickActionCommands {
  onSave: (actor: Actor) => void;
  onRoll: Roll;
  onNotify: (message: string) => void;
}

export function QuickActions({ actor, onSave, onRoll, onNotify, initialEditing = false }: QuickActionCommands & {
  actor: Actor; initialEditing?: boolean;
}) {
  const [editing, setEditing] = useState(initialEditing);
  const [spellId, setSpellId] = useState('');
  const [slotLevel, setSlotLevel] = useState(1);
  const spell = actor.spells?.find(item => item.id === spellId);
  const checks = skillRows(actor);
  const attacks = attackRows(actor);
  function slotsFor(spell: SheetSpell) {
    return Object.entries(actor.spellSlots ?? {}).filter(([level, slot]) => Number(level) >= spell.level && slot.current > 0);
  }
  const options: Action[] = [
    ...attacks.map(({id,name,damage}) => {
      const parsed = damageRoll(damage);
      return { key:'attack:'+id, name, run:()=>onRoll(20,'normal',false,Number(/[+-]\d+/.exec(name)?.[0] ?? 0),name,true),
        damage:parsed ? ()=>onRoll(parsed.sides,'normal',false,parsed.bonus,'Урон: '+name.split(' · ')[0]) : undefined };
    }),
    ...(actor.spells ?? []).filter(item=>item.equipped && item.level > 0).map(item => ({
      key:'spell:'+item.id, name:'Ячейка · '+item.name, disabled:!slotsFor(item).length,
      run:()=>{setSpellId(item.id);setSlotLevel(Number(slotsFor(item)[0]?.[0] ?? item.level));},
    })),
    ...(actor.spells ?? []).flatMap(item=>{
      if(!item.equipped || item.level!==0) return [];
      const attack=attacks.find(({name})=>name.split(' · ')[0]===item.name);
      return attack?[{key:'spell:'+item.id,name:item.name,run:()=>onRoll(20,'normal',false,Number(/[+-]\d+/.exec(attack.name)?.[0]??0),item.name,true)}]:[];
    }),
    ...checks.map(({name,bonus}) => ({key:'skill:'+name,name,run:()=>onRoll(20,'normal',false,bonus,name)})),
    ...(actor.sheetProfile?.scores ?? []).map((score,index) => {
      const name='Спасбросок · '+['СИЛ','ЛОВ','ТЕЛ','ИНТ','МДР','ХАР'][index];
      const bonus=Math.floor((score-10)/2)+(actor.sheetProfile!.saves.includes(index)?actor.sheetProfile!.proficiency:0);
      return {key:'save:'+index,name,run:()=>onRoll(20,'normal',false,bonus,name)};
    }),
    ...(['bonus','reaction'] as const).flatMap(kind => {
      const field=kind==='bonus'?'bonusUsed':'reactionUsed';
      return actor.actions[kind].split('\n').filter(Boolean).map(name=>({
        key:kind+':'+name,name:`${name} · ${actor[field] ? 0 : 1} / 1`,disabled:Boolean(actor[field]),
        run:()=>onSave({...actor,[field]:true}),
      }));
    }),
    ...(actor.progression?.resources ?? []).map((resource,index)=>({
      key:'class-resource:'+index,name:`${resource.name} · ${resource.current} / ${resource.max}`,disabled:resource.current<=0,
      run:()=>{
        const progression=actor.progression!;
        onSave({...actor,progression:{...progression,resources:progression.resources!.map((item,i)=>
          i===index?{...item,current:item.current-1}:item)}});
      },
    })),
    {key:'resource',name:`Потратить заряд · ${actor.resource}`,disabled:actor.resource<=0,run:()=>onSave({...actor,resource:actor.resource-1})},
  ];
  const pinned=(actor.quickActions ?? []).filter(key=>options.some(option=>option.key===key));
  function move(index: number, delta: number) {
    const next=[...pinned]; [next[index],next[index+delta]]=[next[index+delta],next[index]];
    onSave({...actor,quickActions:next});
  }
  return <section className="card-quick-actions" aria-label="Закреплённые действия">
    <header><strong>Закреплённые</strong>
      <IconButton label="Настроить быстрые действия" aria-pressed={editing} onClick={()=>setEditing(!editing)}><Pin size={16}/></IconButton>
    </header>
    <div className="quick-games">
      {pinned.map((key,index)=>{
        const action=options.find(option=>option.key===key)!;
        return <div key={key} className="quick-action-row"><Button disabled={action.disabled} onClick={action.run}>{action.name}</Button>
          {action.damage && !editing && <Button onClick={action.damage} aria-label={`Бросить урон: ${action.name}`}>Урон</Button>}
          {editing && <>
            <IconButton label="Выше" disabled={!index} onClick={()=>move(index,-1)}><ArrowUp size={15}/></IconButton>
            <IconButton label="Ниже" disabled={index===pinned.length-1} onClick={()=>move(index,1)}><ArrowDown size={15}/></IconButton>
            <IconButton label="Открепить" onClick={()=>onSave({...actor,quickActions:pinned.filter(item=>item!==key)})}><X size={15}/></IconButton>
          </>}
        </div>;
      })}
      {!pinned.length && <Empty>Закрепите действия с помощью значка булавки.</Empty>}
    </div>
    {editing && <select aria-label="Закрепить команду" value="" onChange={event=>{
      if(event.target.value) onSave({...actor,quickActions:[...pinned,event.target.value]});
    }}><option value="">Закрепить команду…</option>{options.filter(item=>!pinned.includes(item.key)).map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select>}
    {spell && <div className="quick-spell" aria-label="Расход ячейки">
      <strong>{spell.name}</strong><small>Демо учитывает расход. Эффект на цель применяется вручную.</small>
      <select aria-label="Круг ячейки" value={slotLevel} onChange={event=>setSlotLevel(Number(event.target.value))}>
        {slotsFor(spell).map(([level,slot])=><option key={level} value={level}>{level} круг · {slot.current}/{slot.max}</option>)}
      </select>
      <Button onClick={()=>setSpellId('')}>Отмена</Button>
      <Button className="primary" onClick={()=>{
        const next=spendSpellSlot(actor, slotLevel);
        if(next){onSave(next);onNotify(`${spell.name} · потрачена ячейка ${slotLevel} круга`);}
        setSpellId('');
      }}>Потратить ячейку</Button>
    </div>}
  </section>;
}
