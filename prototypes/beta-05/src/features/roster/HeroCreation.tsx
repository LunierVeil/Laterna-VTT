import { useState } from 'react';
import { ArrowLeft, Check, Pencil, Upload } from 'lucide-react';
import { blankActions, uid, type Actor } from '../../entities/model';
import { Button, IconButton } from '../../shared/ui';
import { skills as standardSkills } from './skills';
import { importLss } from './importCharacter';

const classes = ['Варвар', 'Бард', 'Воин', 'Волшебник', 'Друид', 'Жрец', 'Колдун', 'Монах', 'Паладин', 'Плут', 'Следопыт', 'Чародей'];

const steps = ['Имя и портрет', 'Раса', 'Класс', 'Предыстория', 'Мировоззрение', 'Характеристики', 'Навыки',
  'Владения', 'Умения', 'Заклинания', 'Стартовое снаряжение', 'Итоговый лист'];
const lineList = (value: string) => [...new Set(value.split('\n').map(line => line.trim()).filter(Boolean))];
const abilityNames = ['Сила', 'Ловкость', 'Телосложение', 'Интеллект', 'Мудрость', 'Харизма'];

export function HeroCreation({ onSave }: { onSave: (actor: Actor) => void }) {
  const [source, setSource] = useState<'manual' | 'json'>();
  const [layout, setLayout] = useState<'full' | 'compact' | 'classic'>('full');
  const [name, setName] = useState('');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [scores, setScores] = useState([10, 10, 10, 10, 10, 10]);
  const [portrait, setPortrait] = useState('');
  const className = answers[2]?.trim() ?? '';
  const update = (value: string) => setAnswers(current => ({ ...current, [step]: value }));
  const choices = step === 1 ? ['Человек', 'Эльф', 'Дварф', 'Полурослик', 'Полуэльф']
    : step === 2 ? classes : step === 3 ? ['Послушник', 'Солдат', 'Благородный', 'Отшельник']
    : step === 4 ? ['Законопослушный добрый', 'Нейтральный добрый', 'Хаотичный добрый',
      'Законопослушный нейтральный', 'Нейтральный', 'Хаотичный нейтральный',
      'Законопослушный злой', 'Нейтральный злой', 'Хаотичный злой'] : [];
  function saveHero(empty: boolean) {
    const value = (key: number) => empty ? '' : answers[key]?.trim() ?? '';
    const skills = lineList(value(6));
    onSave({
      id: uid(), kind: 'hero', name: name.trim() || 'Новый герой', title: value(1),
      hp: 10, maxHp: 10, ac: 10, init: 0, color: '#86b8ad', symbol: 'user', resource: 0, sheetLayout: layout,
      actions: { ...blankActions, spells: value(9) }, items: value(10), notes: '',
      characterIdentity: empty ? undefined : { portrait: portrait || undefined, background: value(3), alignment: value(4), proficiencies: value(7) },
      progression: { className: empty ? '' : className, level: 1, features: lineList(value(8)) },
      sheetProfile: { scores: empty ? [10, 10, 10, 10, 10, 10] : scores, speed: 30, proficiency: 2, saves: [], skills },
      skillOverrides: Object.fromEntries(skills.filter(skill => !standardSkills.some(([name]) => name === skill)).map(skill => [skill, { ability: 0, training: 1 }])),
    });
  }
  const [imported, setImported] = useState<Actor>();
  const [error, setError] = useState('');
  return <form className="editor hero-creation" onSubmit={event => {
    event.preventDefault();
    if (source === 'json' && imported) onSave({ ...imported, sheetLayout: layout });
    if (source === 'manual') {
      if (step === steps.length - 1) saveHero(false);
      else setStep(step + 1);
    }
  }}>
    <div className="form-grid" aria-label="Способ создания">
      <Button aria-pressed={source === 'manual'} onClick={() => setSource('manual')}><Pencil size={16}/>Создать героя</Button>
      <Button aria-pressed={source === 'json'} onClick={() => setSource('json')}><Upload size={16}/>Импортировать JSON</Button>
    </div>
    {source && <label>Раскладка листа<select value={layout} onChange={event => setLayout(event.target.value === 'classic' ? 'classic' : event.target.value === 'compact' ? 'compact' : 'full')}>
      <option value="full">Полная</option><option value="compact">Компактная</option><option value="classic">Classic 2014</option>
    </select></label>}
    {source === 'manual' && <section className="character-block">
      <p className="sheet-subtitle" aria-live="polite">Шаг {step + 1} из {steps.length} · {steps[step]}</p>
      <progress className="wizard-progress" max={steps.length} value={step + 1} aria-label="Прогресс создания"/>
      <nav className="segmented wizard-sections" aria-label="Разделы создания">
        {([[0,5,'Главное'], [6,8,'Навыки и умения'], [9,9,'Заклинания'], [10,10,'Снаряжение'], [11,11,'Итог']] as const)
          .map(([first,last,label]) => <Button key={first} aria-pressed={step >= first && step <= last} onClick={() => setStep(first)}>{label}</Button>)}
      </nav>
      {step <= 2 && <div className="wizard-rules"><strong>D&D 5e 2014</strong><small>Ручной ввод и Homebrew доступны на каждом этапе.</small></div>}
      <label>Этап помощника<select value={step} onChange={event => setStep(Number(event.target.value))}>
        {steps.map((label, index) => <option key={label} value={index}>{index + 1} / {steps.length} · {label}</option>)}
      </select></label>
      {step === 0 && <>
        <label>Имя героя<input maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label>
        <label>Портрет<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
          const file = event.target.files?.[0];
          if (!file || file.size > 2_000_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;
          const reader = new FileReader();
          reader.onload = () => setPortrait(String(reader.result));
          reader.readAsDataURL(file);
        }}/></label>
        {portrait && <img className="wizard-portrait" src={portrait} alt="Портрет героя"/>}
      </>}
      {choices.length > 0 && <label>{steps[step]}<input value={answers[step] ?? ''} onChange={event => update(event.target.value)} list="wizard-options"/>
        <datalist id="wizard-options">{choices.map(choice => <option key={choice} value={choice}/>)}</datalist>
      </label>}
      {step === 5 && <div className="form-grid">{abilityNames.map((ability, index) =>
        <label key={ability}>{ability}<input type="number" value={scores[index]} onChange={event =>
          setScores(scores.map((score, i) => i === index ? Math.trunc(Number(event.target.value)) : score))}/></label>)}</div>}
      {step >= 6 && step <= 10 && <label>{steps[step]}<textarea rows={4} value={answers[step] ?? ''}
        placeholder="По одной записи на строку" onChange={event => update(event.target.value)}/></label>}
      {step === 11 && <><h3>{name.trim() || 'Новый герой'}</h3>
        <p>{[answers[1], className, answers[3], answers[4]].filter(Boolean).join(' · ')}</p>
        <p>{abilityNames.map((ability, index) => `${ability} ${scores[index]}`).join(' · ')}</p>
      </>}
      <div className="inline-form">
        <IconButton label="Предыдущий этап" disabled={!step} onClick={() => setStep(step - 1)}><ArrowLeft size={18}/></IconButton>
        {step < 11 && <Button onClick={() => setStep(step + 1)}>Пропустить этап</Button>}
        <IconButton label={step === 11 ? 'Создать и открыть лист' : 'Далее'} type="submit" className="primary"><Check size={18}/></IconButton>
      </div>
      <Button onClick={() => saveHero(true)}>Создать пустой лист</Button>
    </section>}
    {source === 'json' && <>
      <label>Файл Long Story Short (JSON)<input type="file" accept=".json,application/json" onChange={async event => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = '';
        setImported(undefined);
        setError('');
        if (!file) return;
        try {
          if (file.size > 10_000_000) throw new Error('Размер JSON превышает 10 МБ.');
          setImported(importLss(await file.text()));
        } catch (error) {
          setError(error instanceof SyntaxError ? 'Не удалось прочитать JSON.' : error instanceof Error ? error.message : 'Ошибка импорта.');
        }
      }}/></label>
      {error && <p role="alert">{error}</p>}
      {imported && <p><strong>{imported.name}</strong> · {imported.progression?.className} · {imported.hp}/{imported.maxHp} HP</p>}
    </>}
    {source === 'json' && <Button type="submit" className="primary" disabled={!imported}>
      Импортировать и открыть лист
    </Button>}
  </form>;
}
