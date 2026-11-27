import type { Actor, Role } from '../../entities/model';
import { Button } from '../../shared/ui';

export const reviewIteration = 'Beta 0.5 · Stable UI Baseline candidate';
const cases = [
  ['gm-screen', 'D01 · Ширма мастера', 'Карта видна за ширмой. Переместите окно от алтаря в тёмный край, измените размер и сравните режимы фона.'],
  ['quick-actions', 'D02 · Быстрые действия ГМ', 'Над нижней полосой. Смените героя, закрепите или переставьте действие.'],
  ['quick-actions-player', 'D02 · Быстрые действия игрока', 'Доступны только подконтрольные персонажи. Проверьте расход и сворачивание.'],
  ['quick-actions-empty', 'D02 · Пустая панель', 'Закрепите первую команду. Нулевой ресурс недоступен.'],
  ['dice-overlay', 'D03 · Результаты бросков', 'Воспроизведите одиночные, смешанные, критические и скрытые результаты поверх листа.'],
  ['guide', 'D04 · Первое знакомство', 'Приглашение открывается независимо от сохранённого выбора. Можно отказаться или открыть гид снова.'],
  ['guide-player', 'D04 · Сценарий игрока', 'Практический маршрут с подсветкой нужных действий.'],
  ['exploration-reset', 'D05 · Сброс разведки', 'Выберите одного героя или всю партию. Сравните счётчик до и после сброса.'],
  ['classic-sheet', 'D06 · Classic 2014', 'Закреплённые боевые показатели, длинные записи, инвентарь и магия.'],
  ['laterna-sheet', 'D06 · Laterna Map-safe', 'Тот же персонаж и данные, рядом остаётся карта.'],
  ['compact-sheet', 'D06 · Компактный Laterna', 'Тот же персонаж и данные в узкой компоновке.'],
  ['decal-patterns', 'D07 · Генератор декалей', 'На сцене все пять паттернов. Проверьте поворот, вариант и отмену.'],
  ['initiative', 'R01 · Инициатива', 'Сравните модификатор +4 в листе с итогом 18 в очереди боя.'],
  ['lighting', 'Свет', 'Открыт пресет алтарного огня в редакторе сцены.'],
  ['character-wizard', 'Создание или импорт героя', 'Демонстрационный мастер с выбором раскладки.'],
] as const;
export type ReviewCase = typeof cases[number][0];
export function readReview(): ReviewCase | '1' | undefined {
  const value = new URLSearchParams(location.search).get('review');
  return value === '1' ? '1' : cases.find(([id]) => id === value)?.[0];
}
export const reviewRole = (id?: ReviewCase): Role => id === 'quick-actions-player' || id === 'guide-player' || id === 'character-wizard' ? 'player' : 'gm';
export const reviewLayout = (id?: ReviewCase): Actor['sheetLayout'] =>
  id === 'classic-sheet' ? 'classic' : id === 'compact-sheet' ? 'compact' : id === 'laterna-sheet' ? 'full' : undefined;
const reviewImages = 'https://github.com/LunierVeil/Laterna-VTT/blob/';
const previousImages = reviewImages + '013c9b81752b87e2e6927a71c6e840eca6c623ad/prototypes/beta-05/docs/review/';
const latestImages = reviewImages + 'prototype/beta-0.5-interface/prototypes/beta-05/docs/review/';
const captures: Partial<Record<ReviewCase, [string, string]>> = {
  'gm-screen':['translucent-screen-1366.jpg','stable-gm-screen-1366.jpg'],
  'quick-actions':['quick-actions-1366.jpg','stable-quick-actions-1366.jpg'],
  'dice-overlay':['guide-volume-1366.jpg','stable-dice-advantage-1366.jpg'],
  'exploration-reset':['exploration-reset-1366.jpg','stable-exploration-reset-1366.jpg'],
};
const before: Partial<Record<ReviewCase, [string, string]>> = {
  'gm-screen': ['Прозрачность была опцией вне фокуса', 'Карта видна через фон, текст остаётся непрозрачным'],
  'quick-actions': ['Панель слева', 'Панель над нижней полосой'],
  'dice-overlay': ['Объёмный эффект только у d6', 'Все поддерживаемые кубики в очереди результатов'],
  'exploration-reset': ['Сброс активного героя', 'Выбор героя или всей партии на текущей сцене'],
  'decal-patterns': ['Листва и угли в наборе', 'Кровь и грязь в наборе'],
};

export function ReviewIndex() {
  return <main className="design-review">
    <header><div className="inline-form"><a href="?play=1">Обычный игровой стол</a><a href="https://github.com/LunierVeil/Laterna-VTT/pull/104">Обсудить в Draft PR #104</a></div><h1>Design Review</h1>
      <p>{reviewIteration}. APPROVED · требования D01–D07. NEEDS REVIEW · визуальная реализация.</p></header>
    <ul>{cases.map(([id, name, description]) => <li key={id} className="character-block">
      <small>{id === 'character-wizard' ? 'PROPOSED · DEMO' : 'CHANGED · NEEDS REVIEW'}</small><h2>{name}</h2><p>{description}</p>
      {before[id] && <dl><dt>До</dt><dd>{before[id][0]}</dd><dt>После</dt><dd>{before[id][1]}</dd></dl>}
      {captures[id] && <div className="inline-form"><a href={previousImages + captures[id][0]}>Кадр до</a><a href={latestImages + captures[id][1]}>Кадр после</a></div>}
      <a className="button" href={'?review=' + id}>Открыть <span className="sr-only">{name}</span></a>
    </li>)}</ul>
    <p>DEFERRED · Серверная разведка и формат декалей согласуются в PB-15 и PB-19.</p>
  </main>;
}

export function ReviewBar({ scenario, children }: { scenario: ReviewCase; children?: React.ReactNode }) {
  const name = cases.find(([id]) => id === scenario)?.[1];
  const layout = reviewLayout(scenario);
  return <nav className="review-bar" aria-label="Согласование дизайна">
    <a href="?review=1">К перечню изменений</a><strong>{name}</strong><small>{scenario === 'character-wizard' ? 'PROPOSED · DEMO' : 'NEEDS REVIEW'}</small>
    {layout && <><a href="?review=laterna-sheet">Map-safe</a><a href="?review=compact-sheet">Компактный</a><a href="?review=classic-sheet">Classic</a></>}
    {children}<a href="?play=1">К обычному столу</a>
  </nav>;
}

export function ReviewRolls({ play }: { play: (id: string) => void }) {
  return <details className="review-rolls glass">
    <summary>Воспроизвести бросок T15</summary>
    <div>{['d4','d6','d8','d10','d12','d20','d100','advantage','disadvantage','critical-1','critical-20','secret','mixed','queue'].map((id, index) =>
      <Button onClick={() => play(id)} key={id}>{['d4','d6','d8','d10','d12','d20','d100','Преимущество','Помеха','Натуральная 1','Натуральная 20','Скрытый','Смешанный','Очередь'][index]}</Button>)}</div>
  </details>;
}
