import type { Actor, Role } from '../../entities/model';
import { Button } from '../../shared/ui';

export const reviewIteration = 'Beta 0.5 · Gameplay First Refinement';
const cases = [
  ['gm-screen', 'D01 · Ширма мастера', 'Карта видна за ширмой. Переместите окно от алтаря в тёмный край, измените размер и откройте журнал.'],
  ['quick-actions', 'D02 · Быстрые действия ГМ', 'В карточке героя на вкладке «Партия». Закрепите или переставьте действие.'],
  ['quick-actions-player', 'D02 · Быстрые действия игрока', 'Доступны только подконтрольные персонажи. Проверьте расход и сворачивание.'],
  ['quick-actions-empty', 'D02 · Пустая панель', 'Закрепите первую команду. Нулевой ресурс недоступен.'],
  ['quick-actions-compact', 'Компактная карточка игрока', 'Откройте действия в мини-карточке своего героя.'],
  ['quick-actions-edit', 'Редактирование избранного игрока', 'Закрепите, открепите и переставьте команды.'],
  ['quick-actions-tokens', 'Два экземпляра существа', 'Стражи используют один шаблон и отдельные хиты.'],
  ['sidebar', 'Правая панель', 'Сверните панель и проверьте вкладки.'],
  ['objects', 'Геометрия, декали и ручной туман', 'ЛКМ выделяет. ПКМ или Shift+F10 открывает меню со свойствами.'],
  ['dice-overlay', 'D03 · Результаты бросков', 'Воспроизведите одиночные, смешанные, критические и скрытые результаты поверх листа.'],
  ['guide', 'D04 · Первое знакомство', 'Приглашение открывается независимо от сохранённого выбора. Можно отказаться или открыть гид снова.'],
  ['guide-gm', 'Практика мастера', 'Откройте редактор и поставьте стену в отдельной демонстрационной вкладке.'],
  ['guide-player', 'D04 · Сценарий игрока', 'Практический маршрут с подсветкой нужных действий.'],
  ['exploration-reset', 'D05 · Сброс разведки', 'Выберите одного героя или всю партию. Сравните счётчик до и после сброса.'],
  ['classic-sheet', 'Classic 2014 A', 'Характеристики и навыки рядом, боевые показатели и атаки справа.'],
  ['classic-b', 'Classic 2014 B', 'Боевые действия на виду. Полный список навыков открывается в своей колонке.'],
  ['hp-hud', 'HP и боевой HUD', 'Проверьте отдельную строку HP, временные хиты и вертикальные отступы.'],
  ['overflow-sheet', 'Регрессия длинного имени', 'Длинное имя, большой инвентарь и магия на общем листе.'],
  ['dice-menu', 'Игровое меню кубиков', 'Соберите бросок и выберите допустимую видимость.'],
  ['guide-update', 'Что нового за столом', 'Короткий маршрут только по новым действиям.'],
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
export const reviewRole = (id?: ReviewCase): Role => (id?.startsWith('quick-actions-') && id !== 'quick-actions-tokens') || id === 'guide-player' || id === 'character-wizard' ? 'player' : 'gm';
export const reviewLayout = (id?: ReviewCase): Actor['sheetLayout'] =>
  id === 'classic-sheet' || id === 'classic-b' || id === 'hp-hud' || id === 'overflow-sheet' ? 'classic' : id === 'compact-sheet' ? 'compact' : id === 'laterna-sheet' ? 'full' : undefined;
const reviewImages = 'https://github.com/LunierVeil/Laterna-VTT/blob/';
const previousImages = reviewImages + 'c8628158a1af7ed8f06c9684d9c83ffedca13cd0/prototypes/beta-05/docs/review/';
const latestImages = reviewImages + 'prototype/beta-0.5-interface/prototypes/beta-05/docs/review/';
const captures: Partial<Record<ReviewCase, [string, string]>> = {
  'gm-screen':['gameplay-gm-screen.jpg','refinement-gm-screen.jpg'],
  'quick-actions':['gameplay-quick-actions.jpg','refinement-gm-actions.jpg'],
  'quick-actions-player':['gameplay-quick-actions-player.jpg','refinement-player-actions.jpg'],
  'dice-overlay':['gameplay-dice-lantern.jpg','refinement-dice.jpg'],
  'classic-sheet':['gameplay-classic-sheet.jpg','refinement-classic.jpg'],
  'classic-b':['stable-classic-sheet-1366.jpg','gameplay-classic-b.jpg'],
  'hp-hud':['stable-classic-sheet-1366.jpg','gameplay-hp-hud.jpg'],
  'decal-patterns':['stable-decal-patterns-1366.jpg','gameplay-decal-tracks.jpg'],
  'guide-gm':['gameplay-guide-gm.jpg','refinement-guide.jpg'],
};
const before: Partial<Record<ReviewCase, [string, string]>> = {
  'gm-screen':['Переключатель фона','Полупрозрачная ширма и кнопка журнала'],
  'quick-actions':['Отдельное окно','Действия в карточках Партии'],
  'quick-actions-player':['Отдельное окно над столом','Действия и расход ячейки в мини-карточке'],
  'dice-overlay':['Одна малая карточка','Три направления на одном результате'],
  'classic-sheet':['Общий блок характеристик с переключателем','Характеристики и навыки видны рядом'],
  'classic-b':['Общий блок характеристик с переключателем','Короткая сетка характеристик с раскрываемыми навыками'],
  'decal-patterns':['Простые условные метки','Реальный рендер на четырёх поверхностях'],
};
export function ReviewIndex() {
  return <main className="design-review">
    <header><div className="inline-form"><a href="?play=1">Обычный игровой стол</a><a href="https://github.com/LunierVeil/Laterna-VTT/pull/104">Обсудить в Draft PR #104</a></div><h1>Design Review</h1>
      <p>{reviewIteration}. NEEDS REVIEW · доработка игровых сценариев A01–A09.</p></header>
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
    {layout && <><a href="?review=laterna-sheet">Map-safe</a><a href="?review=compact-sheet">Компактный</a><a href="?review=classic-sheet">Classic A</a><a href="?review=classic-b">Classic B</a></>}
    {children}<a href="?play=1">К обычному столу</a>
  </nav>;
}

export function ReviewRolls({ play }: { play: (id: string) => void }) {
  return <details className="review-rolls glass">
    <summary>Демо T15 · заданные результаты</summary>
    <div>{['d4','d6','d8','d10','d12','d20','d100','advantage','disadvantage','critical-1','critical-20','secret','mixed','queue'].map((id, index) =>
      <Button onClick={() => play(id)} key={id}>{['d4','d6','d8','d10','d12','d20','d100','Преимущество','Помеха','Натуральная 1','Натуральная 20','Скрытый','Смешанный','Очередь'][index]}</Button>)}</div>
  </details>;
}
