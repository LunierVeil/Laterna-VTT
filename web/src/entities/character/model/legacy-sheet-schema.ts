/**
 * Описание листа персонажа. Схема - это данные: какие поля, где лежат,
 * как подписаны. Компоненты листа ничего не знают о системе правил и
 * рисуют то, что описано здесь. Новая система = новый файл схемы.
 *
 * Пути - через точку от корня data ("vitals.hp.current"). Так же они
 * уходят на сервер в character.update.
 */

/**
 * prof - уровень владения: 0 нет, 1 владение, 2 мастерство (удвоенный
 * бонус). Старые листы с true/false читаются как 1/0.
 */
export type FieldKind = "text" | "number" | "longtext" | "checkbox" | "link" | "select" | "prof";

export interface Field {
  /** Путь внутри data. В таблицах и списках - внутри строки. */
  key: string;
  label: string;
  kind: FieldKind;
  /** Для select. */
  options?: { value: string; label: string }[];
  /** Ширина колонки или поля в символах, примерно. */
  width?: number;
  /**
   * Пределы для number - защита от опечатки (+99 вместо +9), а не правило
   * игры. Вне пределов форма не сохраняет. Числа в листе - только целые.
   */
  min?: number;
  max?: number;
  /** Дробное число (вес 0,5 фнт). Без этого - только целые. */
  decimal?: boolean;
}

/**
 * Бросок по строке таблицы. Формула собирается из ячейки и уходит на сервер,
 * бросает сервер. Как именно - описано здесь, а не в компоненте:
 * - без d20: ячейка уже формула ("1к8+4");
 * - с d20: "1d20" + число из ячейки ("+10"), а для преимущества и помехи -
 *   свои кубы. Это способ записи броска, а не проверка правил.
 */
export interface RollSpec {
  label: string;
  key: string;
  d20?: { normal: string; advantage: string; disadvantage: string };
  /**
   * Ячейка пустая - бонус из характеристики строки: модификатор +
   * мастерство при владении (как у навыков). Ручное значение главнее.
   * ability и flag - ключи внутри строки, остальное - от корня data.
   */
  computed?: { ability: string; flag: string; abilities: string; score: string; proficiency: string };
}

/**
 * Счётчик в строке таблицы: ресурсы. Кнопки отдыха поднимают current до max
 * у строк, чей rest попал в restores. Какой отдых что восстанавливает -
 * данные схемы, а не код: в другой системе отдыхи другие.
 */
export interface Counter {
  titleKey: string;
  current: string;
  max: string;
  rest: string;
  rests: { label: string; restores: string[] }[];
}

/**
 * Бонус строки списка: модификатор характеристики + мастерство при
 * владении. Это арифметика формы, а не правило: ручное поле (manual)
 * главнее - экспертизу, предметы и хоумбрю вписывает игрок.
 * Пути flag и manual - внутри строки, остальные - от корня data.
 */
export interface CheckBonus {
  flag: string;
  manual: string;
  abilities: string;
  score: string;
  proficiency: string;
}

/**
 * Итог по полям блока - подсказка, а не хранимое значение: «всего в зм».
 * Курсы - данные схемы (в другой системе монеты другие), а не код.
 */
export interface Total {
  label: string;
  terms: { key: string; factor: number }[];
  unit: string;
}

export type Block =
  /** Обычные поля. total - подсказка-итог под ними (взвешенная сумма полей). */
  | { kind: "fields"; title: string; fields: Field[]; total?: Total }
  /**
   * Характеристики: data[path][key] = { score, save }. Модификатор
   * считается из значения - это арифметика, а не правило.
   */
  | {
      kind: "abilities";
      title: string;
      path: string;
      items: { key: string; label: string }[];
      /** Пределы значения характеристики. */
      min: number;
      max: number;
    }
  /** Фиксированный список строк с одинаковыми полями: навыки. data[path][item.key][field.key]. */
  | {
      kind: "checklist";
      title: string;
      path: string;
      /** ability - чья характеристика у строки (для bonus). */
      items: { key: string; label: string; hint?: string; ability?: string }[];
      fields: Field[];
      /** Как посчитать бонус строки, если ручного нет. */
      bonus?: CheckBonus;
      /** Бросок по клику на строку (режим "игра"): d20 + бонус, подпись - label + название. */
      roll?: { label: string; d20: { normal: string; advantage: string; disadvantage: string } };
    }
  /** Таблица, строки добавляет игрок: оружие, ресурсы. data[path] = [{...}, ...]. */
  | {
      kind: "table";
      title: string;
      path: string;
      columns: Field[];
      addLabel: string;
      /** Броски по строке (в режиме "игра"). Клик по названию - все сразу. */
      rolls?: { titleKey: string; items: RollSpec[] };
      /** Строки-счётчики: −/+ и кнопки отдыха (в режиме "игра"). */
      counter?: Counter;
    }
  /**
   * Книга заклинаний: десять кругов (0 - заговоры) с ячейками
   * (slots.N.total, slots.N.left) и заклинаниями data[path] = [{id, name,
   * level, prepared, ritual, concentration, comp_v/s/m, ...}]. Элементы
   * меняются командой character.list, ячейка тратится character.counter -
   * клиент ничего не пересчитывает сам.
   */
  | { kind: "spellbook"; title: string; path: string; slots: string; resourcesPath: string }
  /**
   * Спасброски от смерти: две строки по max отметок (успехи, провалы),
   * бросок d20 (бросает сервер). Достигли max - подпись "стабилизирован"
   * или "мёртв"; что это значит в игре, решает стол, лист только пишет.
   */
  | {
      kind: "deathSaves";
      title: string;
      successes: string;
      fails: string;
      dying?: string;
      max: number;
      roll: { label: string; formula: string };
    }
  /**
   * Карточки: умения, предметы, заклинания. data[path] = [{ id, [titleKey],
   * ...fields, doc }]. Описание (doc) - документ TipTap. Добавлять и править
   * можно и в режиме "игра": предмет нашли посреди сессии - не надо искать
   * кнопку "Редактировать". resourcesPath - откуда брать счётчики для
   * ссылок на ресурсы в описаниях.
   */
  | {
      kind: "cards";
      title: string;
      path: string;
      titleKey: string;
      fields: Field[];
      addLabel: string;
      resourcesPath: string;
      /**
       * Итог веса под карточками: вес × количество (без количества - 1).
       * capacity - подсказка "грузоподъёмность": значение × factor, без штрафов.
       */
      weight?: { weight: string; qty: string; capacity?: { score: string; factor: number; label: string } };
    };

/**
 * Шапка листа - то, что нужно видеть всегда, на любой вкладке: хиты,
 * КД и подобное. Хиты - отдельно, у них кнопки −/+.
 */
export interface Summary {
  /** Пути, значения которых через пробел образуют подзаголовок: "Воин 5". */
  subtitle: string[];
  /**
   * resetOnHeal - пути, которые обнуляются, когда хиты поднялись с 0 и
   * ниже выше нуля (спасброски от смерти сбрасываются при лечении).
   */
  hp?: { current: string; max: string; temp?: string; resetOnHeal?: string[] };
  /** Короткие значения рядом с хитами. */
  stats: Field[];
}

export interface Tab {
  id: string;
  title: string;
  blocks: Block[];
}

/**
 * Что рисовать на токене, привязанном к листу: полоску (хиты) и значок
 * (КД). Видно только тем, кому виден лист.
 */
export interface TokenView {
  bar: { current: string; max: string };
  badge: { key: string; label: string };
  /** Скорость в футах - подсказка при перетаскивании токена. */
  speed?: string;
  /** Бонус инициативы - для броска из трекера боя. */
  initiative?: string;
}

export interface SheetSchema {
  id: string;
  title: string;
  /**
   * Путь к портрету (URL загруженной картинки). Сервер о нём не знает -
   * поэтому показываем только адрес вида /uploads/..., см. safeUpload.
   */
  portrait?: string;
  summary: Summary;
  token?: TokenView;
  /** Первая вкладка - та, что нужна в бою. */
  tabs: Tab[];
}
