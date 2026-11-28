import { useState } from 'react';
import type { Actor } from '../../entities/model';
import { Button, Dialog } from '../../shared/ui';
import { explorationKey, readExploration, writeExploration } from './exploration';

export function ExplorationReset({ heroes, campaign, scene, sceneName, activeHero, review }: {
  heroes: Actor[]; campaign: string; scene: string; sceneName: string; activeHero: string; review: boolean;
}) {
  const [target, setTarget] = useState(activeHero);
  const [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState('');
  const choices = target === '*' ? heroes : heroes.filter(hero => hero.id === target);
  const keys = choices.map(hero => explorationKey(campaign, scene, hero.id));
  const count = keys.reduce((sum, key) => sum + readExploration(key).length, 0);
  const label = target === '*' ? 'Вся партия' : choices[0]?.name;
  return <details className="exploration-reset glass" open={review || undefined}>
    <summary>Разведка</summary>
    <small>{sceneName}</small>
    <label>Цель<select value={target} onChange={event => { setTarget(event.target.value); setFeedback(''); }}>
      {!heroes.some(hero => hero.id === target) && target !== '*' && <option value={target} disabled>Выберите игрока</option>}
      {heroes.map(hero => <option key={hero.id} value={hero.id}>{hero.name}</option>)}
      <option value="*">Вся партия</option>
    </select></label>
    <small>Клеток в памяти: {count}</small>
    <Button disabled={!keys.length} onClick={() => setConfirm(true)}>Сбросить разведку</Button>
    {review && <Button onClick={() => {
      heroes.forEach((hero, i) => writeExploration(explorationKey(campaign,scene,hero.id), [24+i,25+i,47+i,48+i,50+i]));
      setFeedback('Демонстрационная разведка восстановлена');
    }}>Восстановить пример</Button>}
    <small role="status">{feedback}</small>
    {confirm && <Dialog title="Сбросить разведку?" onClose={() => setConfirm(false)}>
      <p>{sceneName} · {label}</p><p>Будет очищена память о {count} клетках только на этой сцене. Текущий обзор и ручной туман сохранятся.</p>
      <div className="inline-form"><Button autoFocus onClick={() => setConfirm(false)}>Отмена</Button>
        <Button className="danger" onClick={() => {
          keys.forEach(key => writeExploration(key, []));
          setFeedback(`${label} · клетки до и после: ${count} → 0`);
          setConfirm(false);
        }}>Подтвердить сброс</Button></div>
    </Dialog>}
  </details>;
}
