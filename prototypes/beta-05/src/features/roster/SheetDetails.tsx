import { spendSpellSlot } from './gameplay';
import { actorSpells, availableSpells, srdSpellSource } from './spellCatalog';
import { useState, type ReactNode } from 'react';
import { Backpack, BookText, ContactRound, WandSparkles } from 'lucide-react';
import { uid, type Actor, type Material, type SheetItem, type SheetSpell } from '../../entities/model';
import { Button, Empty } from '../../shared/ui';

export type ChangeActor = (actor: Actor) => void;

function DetailColumns({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return <div className="character-columns sheet-detail-columns">
    <section className="character-block">{list}</section>
    <section className="character-block">{detail}</section>
  </div>;
}

const itemCategories = ['Оружие', 'Доспех', 'Приключения', 'Расходуемое', 'Прочее'];
export function Equipment({ actor, onChange, onAttack, onDamage }: { actor: Actor; onChange: ChangeActor; onAttack: (attack: string) => void; onDamage: (name: string, damage: string) => void }) {
  const items = actor.equipment ?? actor.items.split('\n').map(line => line.trim()).filter(Boolean).map((line, index): SheetItem => {
    const [, name, quantity] = /^(.*?)(?:\s+×\s*(\d+))?$/.exec(line) ?? [];
    const attack = actor.actions.attack.split('\n').find(action => action.split(' · ')[0] === name);
    return { id: `legacy-${index}`, name, quantity: Number(quantity ?? 1), category: attack ? 'Оружие' : 'Прочее',
      equipped: Boolean(attack), description: '', attack, damage: attack ? (/кинжал/i.test(name) ? '1d4' : '1d8') : undefined };
  });
  const [filter, setFilter] = useState('');
  const [selection, setSelection] = useState('');
  const [draft, setDraft] = useState<SheetItem>();
  const [confirm, setConfirm] = useState(false);
  const visible = items.filter(item => !filter || item.category === filter);
  const current = visible.find(item => item.id === selection) ?? visible[0];
  function save(next: SheetItem[]) {
    const linked = new Set(items.flatMap(item => item.attack ? [item.attack] : []));
    const attack = actor.actions.attack.split('\n').filter(line => !linked.has(line)).join('\n');
    onChange({ ...actor, equipment: next, actions: { ...actor.actions, attack }, items: next.map(item => item.name + (item.quantity === 1 ? '' : ` × ${item.quantity}`)).join('\n') });
  }
  function update(item: SheetItem) { save(items.map(existing => existing.id === item.id ? item : existing)); }
  return <DetailColumns list={<>
    <h3><Backpack size={15}/> Снаряжение · {items.length}</h3>
    <select aria-label="Категория снаряжения" value={filter} onChange={event => { setFilter(event.target.value); setConfirm(false); }}>
      <option value="">Все категории</option>{itemCategories.map(name => <option key={name}>{name}</option>)}
    </select>
    <div className="sheet-record-list">{visible.map(item => <Button key={item.id} aria-pressed={item.id === current?.id}
      onClick={() => { setSelection(item.id); setConfirm(false); setDraft(undefined); }}>
      <strong>{item.name}</strong><small>{item.category} · {item.quantity} шт.{item.equipped ? ' · экипировано' : ''}</small>
    </Button>)}</div>
    <Button onClick={() => setDraft({ id: uid(), name: '', quantity: 1, category: 'Прочее', equipped: false, description: '' })}>Добавить предмет</Button>
  </>} detail={<>
    <h3><Backpack size={15}/> Карточка предмета</h3>
    {draft ? <form className="editor" onSubmit={event => {
      event.preventDefault();
      if (!draft.name.trim()) return;
      const next = { ...draft, name: draft.name.trim() };
      save(items.some(item => item.id === next.id) ? items.map(item => item.id === next.id ? next : item) : [...items, next]);
      setSelection(next.id); setFilter(''); setDraft(undefined);
    }}>
      <label>Название предмета<input required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
      <label>Категория<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}>{itemCategories.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Количество<input type="number" min={0} max={999} required value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: Number(event.target.value) })}/></label>
      <label>Свойства и описание<textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label>
      <label>Строка атаки<input value={draft.attack ?? ''} placeholder="Длинный меч · +5 к атаке" onChange={event => setDraft({ ...draft, attack: event.target.value })}/></label>
      <label>Урон<input value={draft.damage ?? ''} placeholder="1d8+3" pattern="1?d(4|6|8|10|12|20)([+-][0-9]+)?"
        onChange={event => setDraft({ ...draft, damage: event.target.value })}/></label>
      <div className="inline-form"><Button onClick={() => setDraft(undefined)}>Отмена</Button><Button className="primary" type="submit">Сохранить предмет</Button></div>
    </form> : current ? <>
      <h4>{current.name}</h4><p className="sheet-subtitle">{current.category}</p>
      {current.attack && <Button onClick={() => onAttack(current.attack ?? '')}>Атака · {current.attack}</Button>}
      {current.damage && <Button onClick={() => onDamage(current.name, current.damage ?? '')}>Урон · {current.damage}</Button>}
      {current.description && <p className="sheet-note">{current.description}</p>}
      <div className="inline-form">
        <Button aria-label="Уменьшить количество" disabled={!current.quantity} onClick={() => update({ ...current, quantity: current.quantity - 1 })}>−</Button>
        <output aria-label="Количество предмета">{current.quantity}</output>
        <Button aria-label="Увеличить количество" disabled={current.quantity >= 999} onClick={() => update({ ...current, quantity: current.quantity + 1 })}>+</Button>
        <Button disabled={!current.quantity && !current.equipped} onClick={() => update({ ...current, equipped: !current.equipped })}>{current.equipped ? 'Снять' : 'Экипировать'}</Button>
        {current.category === 'Расходуемое' && <Button disabled={!current.quantity} onClick={() => update({ ...current, quantity: current.quantity - 1 })}>Использовать</Button>}
      </div>
      <div className="inline-form"><Button onClick={() => { setConfirm(false); setDraft(current); }}>Редактировать предмет</Button>
        <Button className="danger-text" onClick={() => setConfirm(true)}>Удалить предмет</Button></div>
      {confirm && <div className="confirm"><strong>Удалить «{current.name}»?</strong>
        <Button onClick={() => setConfirm(false)}>Отмена</Button><Button className="danger" onClick={() => {
          save(items.filter(item => item.id !== current.id)); setConfirm(false);
        }}>Удалить</Button></div>}
    </> : <Empty>Выберите предмет или добавьте новый.</Empty>}
  </>}/>;
}

export function Spellbook({ actor, onChange, initialSpellId }: { actor: Actor; onChange: ChangeActor; initialSpellId?: string }) {
  const spells = actorSpells(actor);
  const [source, setSource] = useState<'choose' | 'srd'>();
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const catalog = availableSpells(actor);
  const className = actor.progression?.className.toLowerCase() ?? '';
  const magicalClass = /волшебник|чародей|бард|жрец|друид|колдун|паладин|следопыт|изобретател|wizard|sorcerer|bard|cleric|druid|warlock|paladin|ranger|artificer/.test(className);
  const canEquip = magicalClass || spells.length > 0;
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(initialSpellId ?? '');
  const [draft, setDraft] = useState<SheetSpell>();
  const [slotLevel, setSlotLevel] = useState(1);
  const visible = spells.filter(spell => filter === 'all' || (filter === 'prepared' ? spell.prepared : filter === 'equipped' ? spell.equipped : spell.level === Number(filter)));
  const current = visible.find(spell => spell.id === selected) ?? visible[0];
  const slots = actor.spellSlots?.[slotLevel] ?? { current: 0, max: 0 };
  function updateSlots(next: typeof slots) { onChange({ ...actor, spellSlots: { ...actor.spellSlots, [slotLevel]: next } }); }
  function save(next: SheetSpell[]) { onChange({ ...actor, spells: next, actions: { ...actor.actions, spells: next.map(spell => spell.name).join('\n') } }); }
  return <DetailColumns list={<>
    <h3><BookText size={15}/> Заклинания персонажа</h3>
    <select aria-label="Фильтр заклинаний" value={filter} onChange={event => { setFilter(event.target.value); setDraft(undefined); }}>
      <option value="all">Все изученные</option><option value="prepared">Подготовленные</option><option value="0">Заговоры</option>{canEquip && <option value="equipped">Экипированные</option>}
      {Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 1}>{i + 1} круг</option>)}
    </select>
    {!visible.length && <Empty>{spells.length ? 'В этой группе нет заклинаний.' : 'Изученные заклинания пока не добавлены.'}</Empty>}
    <div className="sheet-record-list">{visible.map(spell => <Button key={spell.id} aria-pressed={spell.id === current?.id}
      onClick={() => { setSelected(spell.id); setDraft(undefined); setSource(undefined); }}><strong>{spell.name}</strong>
      <small>{spell.level ? `${spell.level} круг` : 'Заговор'} · {spell.prepared ? 'Подготовлено' : 'Изучено'}{spell.equipped && ' · Экипировано'}</small></Button>)}</div>
    <Button onClick={() => { setSource('choose'); setDraft(undefined); }}>Добавить заклинание</Button>
    <h3>Ячейки заклинаний</h3>
    <div className="inline-form">
      <select aria-label="Круг ячеек" value={slotLevel} onChange={event => setSlotLevel(Number(event.target.value))}>
        {Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 1}>{i + 1} круг</option>)}
      </select>
      <Button aria-label="Потратить ячейку" disabled={!slots.current} onClick={() => { const next = spendSpellSlot(actor, slotLevel); if (next) onChange(next); }}>−</Button>
      <output aria-label="Ячейки">{slots.current} / {slots.max}</output>
      <Button aria-label="Восстановить ячейку" disabled={slots.current >= slots.max} onClick={() => updateSlots({ ...slots, current: slots.current + 1 })}>+</Button>
    </div>
    <label>Максимум ячеек<input type="number" min={0} max={20} value={slots.max} onChange={event => {
      const max = Math.max(0, Math.min(20, Number(event.target.value)));
      updateSlots({ max, current: Math.min(max, slots.current) });
    }}/></label>
  </>} detail={<>
    <h3><WandSparkles size={15}/> Карточка заклинания</h3>
    {source === 'choose' ? <div className="inline-form">
      <Button onClick={() => setSource('srd')}>Из SRD 5.1</Button>
      <Button onClick={() => { setSource(undefined); setDraft({ id: uid(), name: '', level: 0, prepared: false, description: '' }); }}>Homebrew</Button>
    </div> : source === 'srd' ? <div className="editor">
      <Button onClick={() => setSource('choose')}>Назад к выбору источника</Button>
      <input type="search" aria-label="Поиск заклинаний SRD" value={query} onChange={event => setQuery(event.target.value)}/>
      <div className="form-grid">
        <select aria-label="Тип магии" value={kind} onChange={event => setKind(event.target.value)}>
          <option value="">Вся магия</option><option value="cantrip">Заговоры</option><option value="spell">Заклинания</option>
        </select>
        <select aria-label="Назначение магии" value={category} onChange={event => setCategory(event.target.value)}>
          <option value="">Все назначения</option>{[...new Set(catalog.map(item => item.category))].map(value => <option key={value}>{value}</option>)}
        </select>
      </div>
      {!catalog.length && <Empty>Для этого класса, архетипа и уровня в демобиблиотеке нет доступной магии.</Empty>}
      {catalog.filter(spell => (!category || spell.category === category) && (!kind || (spell.level ? 'spell' : 'cantrip') === kind)
        && spell.name.toLowerCase().includes(query.trim().toLowerCase())).map(spell =>
        <div className="sheet-note" key={spell.id}><strong>{spell.name}</strong>
          <small>{spell.level ? `${spell.level} круг` : 'Заговор'} · {spell.category}</small><p>{spell.description}</p>
          <Button disabled={spells.some(item => item.name === spell.name)} onClick={() => {
            save([...spells, spell]); setSelected(spell.id); setFilter('all'); setSource(undefined);
          }}>Добавить в лист</Button>
        </div>)}
      <small>Выборка SRD 5.1 · Wizards of the Coast LLC · CC BY 4.0 · <a href={srdSpellSource} target="_blank" rel="noreferrer">Источник</a></small>
    </div> : draft ? <form className="editor" onSubmit={event => {
      event.preventDefault();
      if (!draft.name.trim()) return;
      const next = { ...draft, name: draft.name.trim() };
      save(spells.some(spell => spell.id === next.id) ? spells.map(spell => spell.id === next.id ? next : spell) : [...spells, next]);
      setFilter('all'); setSelected(next.id); setDraft(undefined);
    }}>
      <label>Название заклинания<input required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
      <label>Круг<input type="number" min={0} max={9} value={draft.level} onChange={event => setDraft({ ...draft, level: Number(event.target.value) })}/></label>
      <div className="form-grid">{spellFields.map(([key, label]) => <label key={key}>{label}<input value={draft[key] ?? ''} onChange={event => setDraft({ ...draft, [key]: event.target.value })}/></label>)}</div>
      <label>Описание<textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label>
      <div className="inline-form"><Button onClick={() => setDraft(undefined)}>Отмена</Button><Button className="primary" type="submit">Сохранить заклинание</Button></div>
    </form> : current ? <>
      <h4>{current.name}</h4>
      <dl className="sheet-record-fields">{spellFields.filter(([key]) => current[key]).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{current[key]}</dd></div>)}</dl>
      {current.description && <p className="sheet-note">{current.description}</p>}
      <div className="inline-form">
        {canEquip && <Button aria-pressed={Boolean(current.equipped)}
          onClick={() => save(spells.map(spell => spell.id === current.id ? { ...spell, equipped: !spell.equipped } : spell))}>
          <WandSparkles size={15}/>{current.equipped ? 'Снять из экипировки' : current.level ? 'Экипировать заклинание' : 'Экипировать заговор'}
        </Button>}
        {current.level > 0 && <Button aria-pressed={current.prepared} onClick={() => save(spells.map(spell => spell.id === current.id ? { ...spell, prepared: !spell.prepared } : spell))}>{current.prepared ? 'Снять подготовку' : 'Подготовить'}</Button>}
        <Button onClick={() => setDraft(current)}>Редактировать заклинание</Button>
        <Button className="danger-text" onClick={() => save(spells.filter(spell => spell.id !== current.id))}>Удалить заклинание</Button>
      </div>
    </> : <Empty>Выберите заклинание из списка.</Empty>}
  </>}/>;
}

const spellFields = [['school', 'Школа'], ['casting', 'Время накладывания'], ['range', 'Дальность'], ['components', 'Компоненты'], ['duration', 'Длительность']] as const;

export function Biography({ actor, editing, onChange, materials, onMaterial }: { actor: Actor; editing: boolean; onChange: ChangeActor; materials: Material[]; onMaterial: (id: string) => void }) {
  const bio = actor.biography ?? { goals: '', languages: '', publicNotes: '', personalNotes: '' };
  function field(label: string, value: string, save: (text: string) => void) {
    return editing ? <label key={label}>{label}<textarea rows={3} value={value} onChange={event => save(event.target.value)}/></label>
      : <div key={label} className="sheet-note"><strong>{label}</strong><p>{value || 'Не заполнено'}</p></div>;
  }
  return <DetailColumns list={<><h3><ContactRound size={15}/> О персонаже</h3>
    {field('Предыстория', actor.notes, notes => onChange({ ...actor, notes }))}
    {field('Цели и связи', bio.goals, goals => onChange({ ...actor, biography: { ...bio, goals } }))}
    {field('Языки и особенности', bio.languages, languages => onChange({ ...actor, biography: { ...bio, languages } }))}
  </>} detail={<><h3><ContactRound size={15}/> Заметки кампании</h3>
    {field('Общее описание', bio.publicNotes, publicNotes => onChange({ ...actor, biography: { ...bio, publicNotes } }))}
    {field('Личные заметки', bio.personalNotes, personalNotes => onChange({ ...actor, biography: { ...bio, personalNotes } }))}
    <h4>Прикреплённые материалы</h4>
    {editing ? materials.map(material => <label className="checkline" key={material.id}>
      <input type="checkbox" checked={actor.materialIds?.includes(material.id) ?? false} onChange={event => onChange({ ...actor,
        materialIds: event.target.checked ? [...(actor.materialIds ?? []), material.id] : actor.materialIds?.filter(id => id !== material.id),
      })}/>{material.name}
    </label>) : materials.filter(material => actor.materialIds?.includes(material.id)).map(material =>
      <Button key={material.id} onClick={() => onMaterial(material.id)}>{material.name}</Button>)}
    {!editing && !materials.some(material => actor.materialIds?.includes(material.id)) && <p className="sheet-subtitle">Нет прикреплённых материалов.</p>}
  </>}/>;
}
