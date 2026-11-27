import { actorSpells, availableSpells } from './spellCatalog';
import { useState } from 'react';
import type { Actor } from '../../entities/model';
import { Button } from '../../shared/ui';

type Progression = NonNullable<Actor['progression']>;
const extraAttack = { name: 'Дополнительная атака', description: 'Позволяет атаковать дважды за одно действие «Атака» в свой ход.' };
const spellcasting = { name: 'Использование заклинаний', description: 'Открывает заклинания следопыта и ячейки первого круга.' };
const classReference: Record<string, {
  slug: string;
  levels: Record<number, { name: string; description: string }[]>;
  subclassLevel: number;
  subclasses: string[];
}> = {
  Воин: {
    slug: '91-fighter', subclassLevel: 3, subclasses: ['Чемпион', 'Мистический рыцарь', 'Мастер боевых искусств'],
    levels: {
      2: [{ name: 'Всплеск действий', description: 'Даёт дополнительное действие в свой ход. Использование восстанавливается после короткого или длинного отдыха.' }],
      3: [{ name: 'Воинский архетип', description: 'Даёт первые умения выбранного архетипа воина.' }],
      5: [extraAttack],
    },
  },
  Следопыт: {
    slug: '97-ranger', subclassLevel: 3, subclasses: ['Охотник', 'Повелитель зверей'],
    levels: {
      2: [{ name: 'Боевой стиль', description: 'Даёт специализацию следопыта в бою.' }, spellcasting],
      3: [{ name: 'Архетип следопыта', description: 'Даёт первые умения выбранного архетипа следопыта.' }],
      5: [extraAttack],
    },
  },
  Волшебник: {
    slug: '105-wizard', subclassLevel: 2,
    subclasses: ['Школа Воплощения', 'Школа Вызова', 'Школа Иллюзии', 'Школа Некромантии',
      'Школа Ограждения', 'Школа Очарования', 'Школа Преобразования', 'Школа Прорицания'],
    levels: {
      2: [{ name: 'Магическая традиция', description: 'Открывает первые умения выбранной школы магии.' }],
      5: [{ name: 'Заклинания 3-го уровня', description: 'Волшебник получает доступ к заклинаниям и ячейкам третьего круга.' }],
    },
  },
};
const classAliases: Record<string, string> = { fighter: 'Воин', ranger: 'Следопыт', wizard: 'Волшебник' };
const classSkills: Record<string, string[]> = {
  Воин: ['Акробатика', 'Атлетика', 'Внимательность', 'Выживание', 'Запугивание', 'История', 'Проницательность', 'Уход за животными'],
  Следопыт: ['Атлетика', 'Внимательность', 'Выживание', 'Природа', 'Проницательность', 'Скрытность', 'Уход за животными'],
  Волшебник: ['Анализ', 'История', 'Магия', 'Медицина', 'Проницательность', 'Религия'],
};

export function LevelReview({ actor, progression, onSave, onCancel, onRoll }: {
  actor: Actor; progression: Progression; onSave: (actor: Actor) => void; onCancel: () => void; onRoll: () => number;
}) {
  const nextLevel = progression.level + 1;
  const className = classAliases[progression.className.trim().toLowerCase()] ?? progression.className.trim();
  const reference = classReference[className];
  const options = (reference?.levels[nextLevel] ?? []).filter(({ name }) => !progression.features.includes(name));
  const [selected, setSelected] = useState(options.map(({ name }) => name));
  const [skills, setSkills] = useState<string[]>([]);
  const [hpGain, setHpGain] = useState('');
  const [selectedSpell, setSelectedSpell] = useState('');
  const [subclass, setSubclass] = useState(progression.subclass ?? '');
  const [addResource, setAddResource] = useState(true);
  const [fightingStyle, setFightingStyle] = useState('Стрельба');
  const gain = Number(hpGain);
  const proficiency = 2 + Math.floor((nextLevel - 1) / 4);
  const featureNames = [...new Set([...progression.features, ...selected])];
  const offeredSkills = (classSkills[className] ?? []).filter(name => !actor.sheetProfile?.skills.includes(name));
  const actionSurge = selected.includes('Всплеск действий') && addResource && !progression.resources?.some(item => item.name === 'Всплеск действий');

  const known = actorSpells(actor);
  const spells = availableSpells(actor, nextLevel, subclass).filter(spell => !known.some(item => item.name === spell.name));
  const chosen = spells.find(spell => spell.id === selectedSpell);

  function apply() {
    if (!hpGain.trim() || !Number.isInteger(gain) || gain < 0 || gain > 30) return;
    const profile = actor.sheetProfile;
    const featureNotes = { ...actor.featureNotes, ...Object.fromEntries(options
      .filter(({ name }) => selected.includes(name))
      .map(({ name, description }) => [name, name === 'Боевой стиль' ? fightingStyle + '. ' + description : description])) };
    onSave({ ...actor, ...(chosen ? { spells: [...known, chosen], actions: { ...actor.actions, spells: [...known, chosen].map(spell => spell.name).join('\n') } } : {}), featureNotes, maxHp: actor.maxHp + gain,
      progression: { ...progression, level: nextLevel, features: featureNames, subclass: subclass.trim() || undefined,
        resources: actionSurge ? [...(progression.resources ?? []), { name: 'Всплеск действий', current: 1, max: 1, rest: 'short' }] : progression.resources },
      sheetProfile: profile && { ...profile, proficiency, skills: [...new Set([...profile.skills, ...skills])] },
    });
  }

  return <section className="level-review" aria-label="Повышение уровня">
    <header><h3>{progression.className} · уровень {progression.level} → {nextLevel}</h3>
      <p className="sheet-subtitle">Предпросмотр изменений по D&D 5e 2014 · PROPOSED</p></header>
    <div className="character-columns">
      <section className="character-block"><h3>Предложено для класса</h3>
        {options.map(({ name, description }) => <div className="level-option" key={name}>
          <label className="checkline"><input type="checkbox" checked={selected.includes(name)}
            onChange={event => setSelected(event.target.checked ? [...selected, name] : selected.filter(item => item !== name))}/>{name}</label>
          <p className="sheet-subtitle">{description}</p>
        </div>)}
        {!options.length && <p className="sheet-subtitle">Для этого уровня в демобазе нет новых умений.</p>}
        <a className="level-reference" href={reference ? `https://5e14.dnd.su/class/${reference.slug}/` : 'https://5e14.dnd.su/class/'}
          target="_blank" rel="noreferrer">{reference ? 'Открыть описание класса на DnD.su' : 'Классы D&D 5e 2014 на DnD.su'}</a>
        {selected.includes('Боевой стиль') && <label>Боевой стиль
          <select value={fightingStyle} onChange={event => setFightingStyle(event.target.value)}>
            {['Стрельба', 'Оборона', 'Дуэлянт', 'Сражение двумя оружиями'].map(name => <option key={name}>{name}</option>)}
          </select>
        </label>}
        {selected.includes('Всплеск действий') && <label className="checkline"><input type="checkbox" checked={addResource}
          onChange={event => setAddResource(event.target.checked)}/>Создать счётчик 1 / 1</label>}
        {reference && nextLevel === reference.subclassLevel && !progression.subclass && <label>Подкласс
          <select value={subclass} onChange={event => setSubclass(event.target.value)}>
            <option value="">Выбрать позже</option>
            {reference.subclasses.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>}
        <label>Максимум HP: прибавка<input type="number" min={0} max={30} value={hpGain} onChange={event => setHpGain(event.target.value)}/></label>
        <Button onClick={() => setHpGain(String(onRoll()))}>Бросить d20 для HP</Button>
        {spells.length > 0 && <label>Добавить заклинание или заговор<select value={selectedSpell} onChange={event => setSelectedSpell(event.target.value)}>
          <option value="">Выбрать позже</option>
          {spells.map(spell => <option key={spell.id} value={spell.id}>{spell.name} · {spell.level ? `${spell.level} круг` : 'заговор'}</option>)}
        </select></label>}
        {chosen && <p className="sheet-subtitle">{chosen.description}</p>}
      </section>
      <section className="character-block"><h3>Перед применением</h3>
        <p>Максимум HP: {actor.maxHp} → {actor.maxHp + (Number.isFinite(gain) ? gain : 0)}</p>
        <p>Бонус мастерства: +{proficiency}</p>
        <p>Новых классовых умений: {featureNames.length - progression.features.length}</p>
        {actionSurge && <p>Новый ресурс: Всплеск действий · 1 / 1</p>}
        {actor.sheetProfile && offeredSkills.length > 0 && <details><summary>Навыки класса · ручная правка</summary>
          <p className="sheet-subtitle">Выбирайте владение, только если оно получено по правилам или решению мастера.</p>
          {offeredSkills.map(name => <label className="checkline" key={name}><input type="checkbox" checked={skills.includes(name)}
            onChange={event => setSkills(event.target.checked ? [...skills, name] : skills.filter(item => item !== name))}/>{name}</label>)}
        </details>}
      </section>
    </div>
    <footer className="creature-editor-footer"><Button onClick={onCancel}>Отмена</Button>
      <Button className="primary" disabled={!hpGain.trim() || !Number.isInteger(gain) || gain < 0 || gain > 30}
        onClick={apply}>Применить изменения</Button></footer>
  </section>;
}
