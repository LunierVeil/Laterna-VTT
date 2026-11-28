import { attackRows, changeHp, damageRoll, skillRows } from './gameplay';
import { AnchoredPopover } from '../../shared/ui/AnchoredPopover';
import { skills } from './skills';
import portrait from '../../shared/assets/sheet-portrait.svg?inline';
import { useState } from 'react';
import { Heart, Dice5, Gauge, ArrowUp, Columns2, Pencil, RotateCcw, WandSparkles, Settings2, ListChecks, ListFilter, Minus, Plus, Pin, Shield, Swords } from 'lucide-react';
import { actionLabels, blankActions, uid, type Actor, type Material, type Role } from '../../entities/model';
import { Biography, Equipment, Spellbook } from './SheetDetails';
import { LevelReview } from './LevelReview';
import { Bestiary } from './Bestiary';
import { NpcBook, npcChapters } from './NpcBook';
import { Button, Empty, Glyph, IconButton } from '../../shared/ui';

export type Roll = (sides: number, mode: 'normal' | 'advantage' | 'disadvantage', secret: boolean, bonus?: number, label?: string, critical?: boolean) => number;
const tabs = ['Главное', 'Инвентарь', 'Заклинания', 'Умения', 'О персонаже'] as const;
type SheetTab = typeof tabs[number];

export function ActorMedal({ actor, size = 23 }: { actor: Actor; size?: number }) {
  return <div className="actor-medal" style={{ color: actor.color }}><Glyph name={actor.symbol} size={size}/></div>;
}

export type CreatureKind = 'npc' | 'monster' | 'companion';
export type CreatureStart = CreatureKind | `${CreatureKind}-srd`;

export function Roster({ actors, srd, onSheet, onSave, onPlace, quickCreate, controller, onClose }: {
  quickCreate?: CreatureStart; controller?: string; onClose: () => void; actors: Actor[]; srd: Actor[]; onSheet: (id: string) => void;
  onSave: (actor: Actor) => void; onPlace: (actor: Actor) => void;
}) {
  const sourceKind = quickCreate?.endsWith('-srd') ? quickCreate.slice(0, -4) as CreatureKind : undefined;
  const [tab, setTab] = useState<'srd' | 'npc'>(quickCreate === 'monster' || sourceKind ? 'srd' : 'npc');
  const [draft, setDraft] = useState<Actor | undefined>(() => quickCreate && !sourceKind ? newCreature(quickCreate as CreatureKind) : undefined);
  const [editorTab, setEditorTab] = useState('Основное');

  function newCreature(start: 'npc' | 'monster' | 'companion'): Actor {
    const kind = start === 'monster' ? 'monster' : 'npc';
    return { companion: start === 'companion' ? { controllerId: controller } : undefined, id: uid(), kind, name: '', title: '', hp: 12, maxHp: 12, ac: 12, init: 0, symbol: kind === 'npc' ? 'user' : 'skull', color: kind === 'npc' ? '#c8b68d' : '#dd897f', actions: { ...blankActions }, items: '', notes: '', resource: 0 };
  }

  function create(kind: 'npc' | 'monster') {
    setEditorTab('Основное');
    setDraft(newCreature(kind));
  }

  const profile = draft?.npcProfile ?? { chapter: 'Нейтральные', appearance: '', personality: '', biography: '' } as const;
  const creature = draft?.creatureProfile ?? {
    type: draft?.srdProfile?.category ?? '', size: draft?.srdProfile?.size ?? 'Средний',
    challenge: draft?.srdProfile?.challenge ?? '', speed: draft?.srdProfile ? `${draft.srdProfile.speed} фт.` : '30 фт.',
    scores: [10, 10, 10, 10, 10, 10], defenses: '', senses: '', languages: '', saves: '',
  };
  if (draft) return <form className="editor creature-editor" onSubmit={e => {
    e.preventDefault();
    if (!draft.name.trim()) { setEditorTab('Основное'); return; }
    onSave({ ...draft, creatureProfile: creature, name: draft.name.trim(), hp: Math.min(draft.hp, draft.maxHp) });
    setDraft(undefined);
  }}>
    <div className="segmented npc-tabs">
      <Button onClick={() => controller && !sourceKind ? onClose() : setDraft(undefined)}>К книге</Button>
      {['Основное', 'Действия', 'Магия', 'Снаряжение'].map(name => <Button key={name} aria-pressed={editorTab === name} onClick={() => setEditorTab(name)}>{name}</Button>)}
    </div>
    <section className="editor-section" hidden={editorTab !== 'Основное'}>
    <h3>{draft.companion ? 'Питомец или фамильяр' : 'Основное и характеристики'}</h3>
    {draft.companion && <label>Управляющий персонаж<select disabled={Boolean(controller)} value={draft.companion.controllerId ?? ''} onChange={event =>
      setDraft({ ...draft, companion: { controllerId: event.target.value || undefined } })}>
      <option value="">Мастер</option>
      {actors.filter(actor => actor.kind === 'hero').map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
    </select></label>}
    <div className="form-grid">
      <label>Имя существа<input required maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
      <label>Описание<input maxLength={100} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Вид, роль или происхождение"/></label>
    </div>
    {draft.companion && <label>Изображение питомца<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
      const file = event.target.files?.[0];
      if (!file || file.size > 2_000_000 || !['image/png','image/jpeg','image/webp'].includes(file.type)) return;
      const reader = new FileReader();
      reader.onload = () => setDraft(value => value?.id === draft.id
        ? { ...value, characterIdentity: { ...value.characterIdentity, portrait: String(reader.result) } } : value);
      reader.readAsDataURL(file);
    }}/>{draft.characterIdentity?.portrait && <img className="wizard-portrait" src={draft.characterIdentity.portrait} alt="Портрет питомца"/>}</label>}
    <div className="creature-stat-fields">
      {([['type', 'Тип'], ['size', 'Размер'], ['challenge', 'Опасность (CR)']] as const).map(([key, label]) =>
        <label key={key}>{label}<input value={creature[key]} maxLength={60}
          onChange={event => setDraft({ ...draft, creatureProfile: { ...creature, [key]: event.target.value } })}/></label>)}
      <label>Максимум HP<input required type="number" min={1} max={999} value={draft.maxHp} onChange={e => { const maxHp = Number(e.target.value); setDraft({ ...draft, maxHp, hp: Math.min(draft.hp, maxHp) }); }}/></label>
      <label>Текущие HP<input required type="number" min={0} max={draft.maxHp} value={draft.hp} onChange={e => setDraft({ ...draft, hp: Number(e.target.value) })}/></label>
      <label>Класс доспеха<input required type="number" min={0} max={40} value={draft.ac} onChange={e => setDraft({ ...draft, ac: Number(e.target.value) })}/></label>
      <label>Скорость<input value={creature.speed} maxLength={70}
        onChange={event => setDraft({ ...draft, creatureProfile: { ...creature, speed: event.target.value } })}/></label>
      <label>Модификатор инициативы<input required type="number" min={-10} max={50} value={draft.init} onChange={e => setDraft({ ...draft, init: Number(e.target.value) })}/></label>
    </div>
    <div className="creature-stat-fields">{abilityNames.map((name, index) => <label key={name}>{name}
      <input type="number" min={1} max={30} value={creature.scores[index]}
        onChange={event => setDraft({ ...draft, creatureProfile: { ...creature, scores: creature.scores.map((score, i) =>
          i === index ? Math.trunc(Number(event.target.value)) : score) } })}/></label>)}</div>
    </section>
    <section className="editor-section" hidden={editorTab !== 'Основное'}>
      <h3>Защита, чувства и навыки</h3>
      <div className="form-grid">{([['defenses', 'Сопротивления и иммунитеты'], ['senses', 'Чувства'], ['languages', 'Языки'], ['saves', 'Спасброски и навыки']] as const).map(([key, label]) =>
        <label key={key}>{label}<input maxLength={180} value={creature[key]} onChange={event =>
          setDraft({ ...draft, creatureProfile: { ...creature, [key]: event.target.value } })}/></label>)}</div>
      <details className="creature-dossier"><summary>Досье и заметки</summary>
      {draft.kind === 'npc' && <div className="form-grid">
        <label>Отношение<select value={profile.chapter} onChange={event => setDraft({ ...draft, npcProfile: {
          ...profile, chapter: event.target.value as typeof profile.chapter,
        } })}>{npcChapters.slice(1).map(name => <option key={name}>{name}</option>)}</select></label>
        {([['appearance', 'Внешность'], ['personality', 'Характер'], ['biography', 'Биография']] as const).map(([key, label]) =>
          <label key={key}>{label}<textarea rows={2} value={profile[key]}
            onChange={event => setDraft({ ...draft, npcProfile: { ...profile, [key]: event.target.value } })}/></label>)}
      </div>}
      <label>Заметки мастера<textarea rows={2} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label>
      </details>
    </section>
    {editorTab === 'Снаряжение' && <section className="editor-section">
      <label>Снаряжение<textarea rows={3} value={draft.items} onChange={event => setDraft({ ...draft, items: event.target.value })}/></label>
      <label>Доступные заряды<input type="number" min={0} value={draft.resource} onChange={event =>
        setDraft({ ...draft, resource: Math.max(0, Math.trunc(Number(event.target.value))) })}/></label>
    </section>}
    {(editorTab === 'Действия' || editorTab === 'Магия') && <section className="editor-section form-grid">{Object.entries(actionLabels)
      .filter(([key]) => editorTab === 'Магия' ? key === 'spells' : key !== 'spells')
      .map(([key, label]) => <label key={key}>{label}<textarea rows={2} value={draft.actions[key as keyof Actor['actions']]} onChange={e => setDraft({ ...draft, actions: { ...draft.actions, [key]: e.target.value } })}/></label>)}
    </section>}
    <footer className="creature-editor-footer"><Button onClick={() => controller ? onClose() : setDraft(undefined)}>Отмена</Button><button type="submit" className="button primary npc-save"
      disabled={!draft.name.trim() || draft.maxHp < 1 || draft.maxHp > 999 || draft.hp < 0 || draft.hp > draft.maxHp || draft.ac < 0 || draft.ac > 40 || draft.init < -10 || draft.init > 50}>{draft.kind === 'monster' ? 'Сохранить монстра' : 'Сохранить NPC'}</button></footer>
  </form>;

  const tools = <div className="dialog-tools material-tools">
      <div className="segmented" aria-label="Книги существ">
        <Button aria-pressed={tab === 'npc'} onClick={() => setTab('npc')}>Книга NPC</Button>
        <Button aria-pressed={tab === 'srd'} onClick={() => setTab('srd')}>Книга чудовищ</Button>
      </div>
      <IconButton label={tab === 'npc' ? 'Создать NPC' : 'Создать монстра'} onClick={() => create(tab === 'npc' ? 'npc' : 'monster')}><Plus size={16}/></IconButton>
    </div>;
  return <>
    {tab === 'npc' ? <NpcBook tools={tools} onClose={onClose} actors={actors} onCreate={() => create('npc')}
      onEdit={actor => { setEditorTab('Основное'); setDraft(actor); }}
      onSheet={actor => onSheet(actor.id)} onPlace={onPlace}/>
    : <Bestiary picking={Boolean(sourceKind)} tools={sourceKind ? undefined : tools} onClose={onClose} creatures={srd}
      onCopy={actor => onSave({ ...actor, id: uid() })}
      onCustom={actor => { setEditorTab('Основное'); setDraft({ ...actor, id: uid(), kind: sourceKind && sourceKind !== 'monster' ? 'npc' : actor.kind,
        companion: sourceKind === 'companion' ? { controllerId: controller } : undefined }); }}
      onPlace={actor => { const copy = { ...actor, id: uid() }; onSave(copy); onPlace(copy); }}/>}
  </>;
}

const abilityNames = ['СИЛ', 'ЛОВ', 'ТЕЛ', 'ИНТ', 'МДР', 'ХАР'];
const signed = (value: number) => value < 0 ? `−${Math.abs(value)}` : `+${value}`;

export function Sheet({ actor, role, onChange, onRoll, onCompact, onClassic, compact, materials, onMaterial, classicVariant = 'a' }: {
  classicVariant?: 'a' | 'b'; actor?: Actor; role: Role; onChange: (actor: Actor) => void; onRoll: Roll;
  materials: Material[]; onMaterial: (id: string) => void;
  onClassic: () => void; onCompact: (compact: boolean) => void; compact: boolean;
}) {
  const [tab, setTab] = useState<SheetTab>('Главное');
  const [advancing, setAdvancing] = useState(false);
  const [feature, setFeature] = useState('');
  const [newSkill, setNewSkill] = useState('');
  const [skillSort, setSkillSort] = useState<'alphabetical' | 'ability'>('alphabetical');
  const [checks, setChecks] = useState<'abilities' | 'skills'>(compact ? 'skills' : 'abilities');
  const [amount, setAmount] = useState('1');
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Parameters<Roll>[1]>('normal');
  const [last, setLast] = useState<number>();
  const [spellId, setSpellId] = useState<string>();
  if (!actor) return <Empty>В этой кампании пока нет доступного персонажа.</Empty>;

  const death = actor.deathSaves ?? { successes: 0, failures: 0 };
  const deathRoll = death.roll;
  const equippedSpells = actor.spells?.filter(spell => spell.equipped) ?? [];
  const profile = actor.sheetProfile;
  const customSkills = Object.keys(actor.skillOverrides ?? {}).filter(name => !skills.some(([standard]) => name === standard));
  const allSkills: [string, number][] = [...skills.map(([name, index]): [string, number] => [name, index]),
    ...customSkills.map((name): [string, number] => [name, actor.skillOverrides![name].ability])];
  function updateSkill(name: string, fields: NonNullable<Actor['skillOverrides']>[string]) {
    if (actor) onChange({ ...actor, skillOverrides: { ...actor.skillOverrides, [name]: fields } });
  }
  function rollDeathSave() {
    if (!actor) return;
    const roll = onRoll(20, 'normal', false, 0, 'Спасбросок от смерти');
    const successes = roll === 20 ? 0 : Math.min(3, death.successes + Number(roll >= 10));
    const failures = roll === 20 ? 0 : Math.min(3, death.failures + (roll === 1 ? 2 : Number(roll < 10)));
    onChange({ ...actor, hp: roll === 20 ? 1 : actor.hp, deathSaves: { successes, failures, roll } });
  }
  const progression = actor.progression;
  const title = [actor.title, progression && `${progression.className} ${progression.level}`, progression?.subclass].filter(Boolean).join(' · ');
  const modifiers = profile?.scores.map(score => Math.floor((score - 10) / 2));
  const hpAmount = Math.max(1, Math.min(actor.maxHp, Number(amount) || 1));
  const updateHp = (sign: number) => onChange(changeHp(actor, sign * hpAmount));
  const rollCheck = (label: string, bonus: number, attack = false) => setLast(onRoll(20, mode, false, bonus, label, attack));
  const availableAttacks = attackRows(actor);
  function attackPin(actor: Actor, name: string) {
    const attack = availableAttacks.find(item => item.name === name);
    if (!attack) return null;
    const key = 'attack:' + attack.id;
    const pins = actor.quickActions ?? [];
    const pinned = pins.includes(key);
    return <IconButton label={pinned ? `Открепить: ${name}` : `Закрепить: ${name}`} aria-pressed={pinned}
      onClick={() => onChange({ ...actor, quickActions: pinned ? pins.filter(item => item !== key) : [...pins, key] })}><Pin size={14}/></IconButton>;
  }
  const attacks = availableAttacks.map(attack => attack.name).join('\n');
  const rollDamage = (name: string, formula: string) => {
    const damage = damageRoll(formula);
    if (damage) setLast(onRoll(damage.sides, 'normal', false, damage.bonus, `Урон: ${name}`));
  };
  const actionRows = Object.entries({ ...actor.actions, attack: attacks }).filter(([key, value]) => key !== 'spells' && value.trim());
  const rest = (long: boolean) => {
    onChange({ ...actor, reactionUsed: false, bonusUsed: false, hp: long && actor.hp > 0 ? actor.maxHp : actor.hp,
      spellSlots: long && actor.spellSlots ? Object.fromEntries(Object.entries(actor.spellSlots).map(([level, slot]) => [level, { ...slot, current: slot.max }])) : actor.spellSlots,
      progression: progression && { ...progression, resources: progression.resources?.map(item =>
        long || item.rest !== 'long' ? { ...item, current: item.max } : item) },
    });
  };
  const charges = <div className="attack-row"><strong>Доступные заряды</strong>
    <IconButton label="Потратить заряд" disabled={!actor.resource} onClick={() => onChange({ ...actor, resource: actor.resource - 1 })}><Minus size={15}/></IconButton>
    <output className="mono">{actor.resource}</output>
    <IconButton label="Восстановить заряд" disabled={actor.resource >= 99} onClick={() => onChange({ ...actor, resource: actor.resource + 1 })}><Plus size={15}/></IconButton>
  </div>;

  const classic = actor.sheetLayout === 'classic';
  return <div className={`sheet ${classic ? `sheet-classic classic-${classicVariant}` : ''}`}>
    <header className="character-heading">
      <div className="character-portrait">{actor.characterIdentity?.portrait || actor.id === 'elara' ? <img src={actor.characterIdentity?.portrait ?? portrait} alt=""/> : <ActorMedal actor={actor} size={35}/>}</div>
      <div><h2 title={actor.name}>{actor.name}</h2><p className="sheet-subtitle">{title || 'Персонаж кампании'} · D&D 5e {actor.importedEdition ?? '2014'}</p></div>
      <div className="character-actions"><AnchoredPopover className="" label="Действия листа" trigger={<><Settings2 size={16}/>Лист</>}>{close => <>
        <Button onClick={() => { close(); onCompact(!compact); setTab('Главное'); setChecks(compact ? 'abilities' : 'skills'); }}><Columns2 size={16}/>{compact ? 'Полный лист' : 'Компактный лист'}</Button>
        <Button aria-pressed={classic} onClick={() => { close(); onClassic(); setTab('Главное'); }}>Classic 2014</Button>
        <Button aria-pressed={!classic && !compact} onClick={() => { close(); onCompact(false); setTab('Главное'); }}>Laterna · Map-safe</Button>
        {progression && !actor.importedEdition && progression.level < 20 && <Button aria-pressed={advancing} onClick={() => { close(); setAdvancing(value => !value); }}><ArrowUp size={16}/>Повысить уровень</Button>}
        <Button aria-pressed={editing} onClick={() => { close(); setEditing(value => !value); }}><Pencil size={16}/>{editing ? 'Готово' : 'Редактировать'}</Button>
      </>}</AnchoredPopover>
      </div>
    </header>
    {advancing && progression ? <LevelReview key={progression.level} onRoll={() => onRoll(20, 'normal', false, 0, 'Прибавка HP')} actor={actor} progression={progression}
      onCancel={() => setAdvancing(false)} onSave={updated => { onChange(updated); setAdvancing(false); setTab('Умения'); }}/>
    : <>
    <div className={classic ? 'classic-hud' : undefined}>
    <div className="stats sheet-stats">
      <div><small><Heart size={12}/> Хиты</small><strong>{actor.hp} / {actor.maxHp}</strong><progress max={actor.maxHp} value={actor.hp} aria-label="Здоровье"/></div>
      <div><small><Shield size={12}/> КД</small><strong>{actor.ac}</strong></div>
      <div><small><Swords size={12}/> Мод. инициативы</small><strong>{signed(actor.init)}</strong></div>
      <div><small>Скорость</small><strong>{profile ? `${profile.speed} фт` : '—'}</strong></div>
      <div><small>Мастерство</small><strong>{profile ? signed(profile.proficiency) : '—'}</strong></div>
    </div>
    <div className="sheet-health">
      <span>HP</span>
      <Button aria-label="Уменьшить HP" onClick={() => updateHp(-1)} disabled={actor.hp === 0 && !actor.tempHp}>Урон −</Button>
      <input type="number" aria-label="Величина изменения HP" min={1} max={actor.maxHp} value={amount} onChange={e => setAmount(e.target.value)}/>
      <Button className="selected" aria-label="Увеличить HP" onClick={() => updateHp(1)} disabled={actor.hp === actor.maxHp}>Лечение +</Button>
      {editing ? <label className="inline-form">Временные HP<input type="number" min={0} max={999} value={actor.tempHp ?? 0}
        onChange={event => onChange({ ...actor, tempHp: Math.max(0, Math.min(999, Number(event.target.value))) })}/></label>
        : <small>Временные HP: {actor.tempHp ?? 0}</small>}
    </div>
    {classic && Boolean(actor.conditions?.length) && <small>{actor.conditions?.join(' · ')}</small>}
    </div>
    {editing && <section className="character-block"><h3>Редактирование листа</h3><div className="creature-stat-fields">
      <label>Имя персонажа<input value={actor.name} onChange={e => onChange({ ...actor, name: e.target.value })}/></label>
      <label>Максимум HP<input type="number" min={1} max={999} value={actor.maxHp} onChange={e => {
        const maxHp = Math.max(1, Math.min(999, Number(e.target.value)));
        onChange({ ...actor, maxHp, hp: Math.min(actor.hp, maxHp) });
      }}/></label>
      <label>КД<input type="number" min={0} max={40} value={actor.ac} onChange={e => onChange({ ...actor, ac: Math.max(0, Math.min(40, Number(e.target.value))) })}/></label>
      {profile && <label>Скорость<input type="number" min={0} max={250} value={profile.speed} onChange={e =>
        onChange({ ...actor, sheetProfile: { ...profile, speed: Math.max(0, Math.min(250, Number(e.target.value))) } })}/></label>}
    </div></section>}
    <nav className="character-tabs" aria-label="Разделы листа">{tabs.map(name => <Button aria-pressed={tab === name} key={name} onClick={() => setTab(name)}>{name}</Button>)}</nav>
    {classic && <details className="character-block classic-fallback"><summary>Где находится элемент?</summary>
      <div className="inline-form">
        <Button onClick={() => setTab('Инвентарь')}>Предметы и экипировка</Button>
        <Button onClick={() => setTab('Заклинания')}>Магия</Button>
        <Button onClick={() => setTab('Умения')}>Особенности и ресурсы</Button>
        <Button onClick={() => { onCompact(false); setEditing(true); }}>Открыть универсальный редактор</Button>
      </div>
    </details>}
    {tab === 'Главное' && <>
      <div className="character-columns">
        <div>
          {classic && !editing && profile && <section className="classic-checks" aria-label="Характеристики и проверки Classic">
            <div className="classic-abilities">
              {abilityNames.map((name,index)=>{
                const bonus=modifiers?.[index] ?? 0;
                const save=bonus+(profile.saves.includes(index)?profile.proficiency:0);
                return <article key={name}><strong>{name}<small>{profile.scores[index]}</small></strong>
                  <Button onClick={()=>rollCheck(name,bonus)}>{signed(bonus)}</Button>
                  <Button onClick={()=>rollCheck('Спасбросок: '+name,save)}>Спас {signed(save)}</Button></article>;
              })}
            </div>
            <details className="classic-skills" open={classicVariant === 'a' || undefined}>
              <summary>Навыки</summary>
              <div className="classic-skill-scroll" tabIndex={0} aria-label="Список навыков">
                {skillRows(actor).map(({name,bonus})=><Button key={name} onClick={()=>rollCheck(name,bonus)}>
                  <span>{name}</span><strong>{signed(bonus)}</strong></Button>)}
              </div>
            </details>
          </section>}
          {(!classic || editing || !profile) && <section className="character-block">
            <header><h3>{checks === 'skills' ? 'Навыки и проверки' : 'Характеристики и спасброски'}</h3>
              <div className="segmented">
                <Button aria-pressed={checks === 'abilities'} onClick={() => setChecks('abilities')}>Характеристики</Button>
                <Button aria-pressed={checks === 'skills'} onClick={() => setChecks('skills')}>Навыки</Button>
              </div>
            </header>
            {profile && modifiers ? (checks === 'abilities' ? <div className="character-abilities">{abilityNames.map((name, index) => {
              const bonus = modifiers[index];
              const save = bonus + (profile.saves.includes(index) ? profile.proficiency : 0);
              return <div className="ability-card" key={name}><div><span>{name}</span>{editing ? <input aria-label={`Характеристика ${name}`} type="number" value={profile.scores[index]}
                onChange={event => onChange({ ...actor, sheetProfile: { ...profile, scores: profile.scores.map((score, i) =>
                  i === index ? Math.trunc(Number(event.target.value)) : score) } })}/> : <span>{profile.scores[index]}</span>}</div>
                <Button className="selected" onClick={() => rollCheck(name, bonus)}>{signed(bonus)}</Button>
                <Button onClick={() => rollCheck(`Спасбросок: ${name}`, save)}>Спасбросок {signed(save)}</Button>
              </div>;
            })}</div> : <><div className="inline-form" aria-label="Сортировка навыков">
              <IconButton label="По алфавиту" aria-pressed={skillSort === 'alphabetical'} onClick={() => setSkillSort('alphabetical')}><ListChecks size={16}/></IconButton>
              <IconButton label="По характеристике" aria-pressed={skillSort === 'ability'} onClick={() => setSkillSort('ability')}><ListFilter size={16}/></IconButton>
            </div>
            {editing && <form className="inline-form" onSubmit={event => {
              event.preventDefault();
              const name = newSkill.trim();
              if (name && !allSkills.some(([existing]) => existing.toLocaleLowerCase() === name.toLocaleLowerCase())) {
                updateSkill(name, { ability: 0, training: 0 });
                setNewSkill('');
              }
            }}><input aria-label="Пользовательский навык" value={newSkill} onChange={event => setNewSkill(event.target.value)}/>
              <Button type="submit">Добавить навык</Button></form>}
            <div className={editing ? 'skill-edit-list' : 'character-skills'}>{allSkills.sort(([left, a], [right, b]) =>
              (skillSort === 'ability' ? a - b : 0) || left.localeCompare(right, 'ru')).map(([name, index]) => {
              const setting = actor.skillOverrides?.[name] ?? { ability: index, training: profile.skills.includes(name) ? 1 : 0 };
              const bonus = setting.modifier ?? (modifiers[setting.ability] + setting.training * profile.proficiency);
              if (editing) return <section className="sheet-note skill-edit-row" key={name}>
                <header><strong>{name}</strong><select aria-label={`Характеристика навыка: ${name}`} value={setting.ability} onChange={event =>
                  updateSkill(name, { ...setting, ability: Number(event.target.value) })}>
                  {abilityNames.map((ability, i) => <option key={ability} value={i}>{ability}</option>)}
                </select></header>
                <div className="skill-edit-controls"><div className="segmented" role="group" aria-label={`Владение: ${name}`}>
                  {(['Нет', 'Владение', 'Компетентность'] as const).map((label, tier) =>
                    <Button key={label} aria-pressed={setting.training === tier} onClick={() => updateSkill(name, { ...setting, training: tier as 0 | 1 | 2 })}>{label}</Button>)}
                </div>
                <label>Ручной итог<input aria-label={`Модификатор: ${name}`} type="number" placeholder={signed(bonus)} value={setting.modifier ?? ''}
                  onChange={event => updateSkill(name, { ...setting, modifier: event.target.value ? Number(event.target.value) : undefined })}/></label>
                {customSkills.includes(name) && <Button onClick={() => {
                  const next = { ...actor.skillOverrides }; delete next[name]; onChange({ ...actor, skillOverrides: next });
                }}>Удалить навык</Button>}
              </div></section>;
              return <Button key={name} onClick={() => rollCheck(name, bonus)}><span>{name}</span><small>{abilityNames[setting.ability]}</small><strong>{signed(bonus)}</strong></Button>;
            })}</div></>) : <Empty>Для этой карточки проверки не заданы.</Empty>}
          </section>}
          <section className="character-block death-save-block" data-outcome={deathRoll === undefined ? undefined : deathRoll >= 10 ? 'success' : 'failure'}>
            <header><h3>Спасброски от смерти</h3>
              <Button disabled={actor.hp > 0 || death.successes >= 3 || death.failures >= 3} onClick={rollDeathSave}><Dice5 size={16}/>Бросить d20</Button>
            </header>
            {deathRoll !== undefined && <output className="mono" aria-label="Результат спасброска от смерти">d20: {deathRoll} · {deathRoll >= 10 ? 'Успех' : 'Провал'}</output>}
            <div className="death-saves">{(['successes', 'failures'] as const).map(kind => <div key={kind}>
              <span>{kind === 'successes' ? 'Успехи' : 'Провалы'}</span>
              {[1, 2, 3].map(count => <Button key={count} aria-label={`${kind === 'successes' ? 'Успехи' : 'Провалы'}: ${count}`} disabled={actor.hp > 0}
                aria-pressed={death[kind] >= count} onClick={() => onChange({ ...actor, deathSaves: { ...death, [kind]: death[kind] === count ? count - 1 : count } })}/>)}
            </div>)}</div>
            <p className="sheet-subtitle" aria-live="polite">{death.failures >= 3 ? 'Три провала' : death.successes >= 3 ? 'Стабилизирован' : actor.hp > 0 && deathRoll !== 20 ? 'Доступны при 0 HP' : deathRoll === 20 ? 'Восстановлен 1 HP' : null}</p>
          </section>
        </div>
        <div>
          <section className="character-block">
            <header><h3>Оружие и атаки</h3><div className="dialog-tools sheet-roll">
            <select aria-label="Режим атаки" value={mode} onChange={e => setMode(e.target.value as Parameters<Roll>[1])}><option value="normal">Обычный бросок</option><option value="advantage">Преимущество</option><option value="disadvantage">Помеха</option></select>
            {last !== undefined && <output className="badge live">Результат: {last}</output>}
          </div></header>
            {actionRows.length ? <div className="actor-actions">{actionRows.map(([key, value]) => <div key={key}>
              {key !== 'attack' && <h4>{actionLabels[key as keyof Actor['actions']]}</h4>}
              {value.split('\n').filter(Boolean).map((action, index) => <div className="attack-row" key={index}><span>{action}</span>{(key === 'bonus' || key === 'reaction') && (() => {
                const field = key === 'bonus' ? 'bonusUsed' : 'reactionUsed';
                return <>
                  <small title="Общий лимит для действий этого типа. Восстанавливается в начале хода.">{actor[field] ? 0 : 1} / 1 за ход</small>
                  {actor[field] ? <span className="badge">Израсходовано</span> : <Button onClick={() => onChange({ ...actor, [field]: true })}>Потратить</Button>}
                </>;
              })()}{key === 'attack' && <>
                <Button onClick={() => rollCheck(action, Number(/[+-]\d+/.exec(action)?.[0] ?? 0), true)}><Dice5 size={15}/>Атака</Button>
                <Button onClick={() => rollDamage(action.split(' · ')[0], availableAttacks.find(item => item.name === action)?.damage ?? '')}>Урон</Button>
                {attackPin(actor, action)}
              </>}</div>)}
              {(key === 'bonus' || key === 'reaction') && actor[key === 'bonus' ? 'bonusUsed' : 'reactionUsed'] &&
                <Button className="ghost" onClick={() => onChange({ ...actor, [key === 'bonus' ? 'bonusUsed' : 'reactionUsed']: false })}><RotateCcw size={14}/>Восстановить</Button>}
            </div>)}</div> : <Empty>Действия пока не добавлены.</Empty>}
          </section>
          {equippedSpells.length > 0 && <section className="character-block">
            <h3><WandSparkles size={15}/> Экипированные заклинания и заговоры</h3>
            {equippedSpells.map(spell => <Button key={spell.id} className="equipped-spell" onClick={() => {
              setSpellId(spell.id);
              setTab('Заклинания');
            }}>
              <span>{spell.name}</span><small>{spell.level ? `${spell.level} круг` : 'Заговор'}</small>
            </Button>)}
          </section>}
          <section className="character-block"><h3>Ресурсы и отдых</h3>{charges}</section>

        </div>
      </div>
    </>}
    {tab === 'Инвентарь' && <Equipment actor={actor} onChange={onChange} onAttack={attack => rollCheck(attack, Number(/[+-]\d+/.exec(attack)?.[0] ?? 0), true)} onDamage={rollDamage}/>}
    {tab === 'Заклинания' && <Spellbook initialSpellId={spellId} actor={actor} onChange={onChange}/>}
    {tab === 'Умения' && <div className="character-columns sheet-detail-columns">
      <section className="character-block"><h3><ListChecks size={15}/> Классовые умения и особенности</h3>
      {progression?.features.map(name => <div className="sheet-note" key={name}><strong>{name}</strong>
        {editing ? <label>Описание умения<textarea value={actor.featureNotes?.[name] ?? ''} onChange={event =>
          onChange({ ...actor, featureNotes: { ...actor.featureNotes, [name]: event.target.value } })}/></label>
          : actor.featureNotes?.[name] && <p>{actor.featureNotes[name]}</p>}</div>)}
      {!progression?.features.length && <Empty>Классовые умения пока не добавлены.</Empty>}
      {editing && progression && <form className="inline-form" onSubmit={event => {
        event.preventDefault();
        if (feature.trim() && !progression.features.includes(feature.trim())) {
          onChange({ ...actor, progression: { ...progression, features: [...progression.features, feature.trim()] } });
          setFeature('');
        }
      }}><input aria-label="Новое умение" value={feature} maxLength={80} onChange={event => setFeature(event.target.value)}/>
        <Button type="submit" disabled={!feature.trim()}>Добавить умение</Button>
      </form>}
      </section><section className="character-block"><h3><Gauge size={15}/> Ресурсы, реакции и отдых</h3>
      {progression?.resources?.map((item, index) => <div className="attack-row" key={item.name}>
        <strong>{item.name}</strong>
        {item.rest && <span className="resource-recovery" title={item.rest === 'short' ? 'Восстанавливается после короткого или длинного отдыха' : 'Восстанавливается после длинного отдыха'}><RotateCcw size={14}/>{item.rest === 'short' ? 'Короткий отдых' : 'Длинный отдых'}</span>}
        <output>{item.current} / {item.max}</output>
        {[-1, 1].map(delta => <IconButton key={delta} label={`${delta < 0 ? 'Потратить' : 'Восстановить'}: ${item.name}`}
          disabled={delta < 0 ? item.current === 0 : item.current === item.max}
          onClick={() => onChange({ ...actor, progression: { ...progression, resources: progression.resources?.map((resource, i) =>
            i === index ? { ...resource, current: resource.current + delta } : resource) } })}>{delta < 0 ? <Minus size={15}/> : <Plus size={15}/>}</IconButton>)}
      </div>)}
      {charges}
      <Button aria-pressed={Boolean(actor.reactionUsed)} onClick={() => onChange({ ...actor, reactionUsed: !actor.reactionUsed })}>
        Реакция · {actor.reactionUsed ? 'потрачена' : 'доступна'}
      </Button>
      <div className="inline-form"><Button onClick={() => rest(false)}>Короткий отдых</Button><Button onClick={() => rest(true)}>Длинный отдых</Button></div>
    </section></div>}
    {tab === 'О персонаже' && actor.characterIdentity && <section className="character-block">
      <div className="form-grid">{([['background', 'Предыстория'], ['alignment', 'Мировоззрение'], ['proficiencies', 'Владения']] as const)
        .map(([key, label]) => editing ? <label key={key}>{label}<input value={actor.characterIdentity?.[key] ?? ''}
          onChange={event => onChange({ ...actor, characterIdentity: { ...actor.characterIdentity, [key]: event.target.value } })}/></label>
          : actor.characterIdentity?.[key] && <p key={key}>{label} · {actor.characterIdentity[key]}</p>)}</div>
    </section>}
    {tab === 'О персонаже' && (role === 'gm' || actor.kind === 'hero') && <Biography actor={actor} editing={editing} onChange={onChange} materials={materials} onMaterial={onMaterial}/>}
    </>}
  </div>;
}
