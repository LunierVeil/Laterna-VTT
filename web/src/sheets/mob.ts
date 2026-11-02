import { equipmentBlock } from "./equipment.ts";
import type { SheetSchema } from "./schema";

/**
 * Моб или NPC - шаблон. Хиты здесь - максимум: текущие у каждого экземпляра
 * на карте свои (хранятся на токене), иначе пять гоблинов с одного листа
 * падали бы от одного удара. Другой вариант моба - копия листа.
 *
 * Как и в листе персонажа - только поля, правила не проверяются.
 */
export const mob: SheetSchema = {
  id: "mob",
  title: "Моб / NPC",
  portrait: "portrait",
  summary: {
    subtitle: ["size", "kind"],
    stats: [
      { key: "hp.max", label: "Хиты", kind: "number" },
      { key: "ac", label: "КД", kind: "number" },
      { key: "speed", label: "Скорость", kind: "text" },
      { key: "initiative", label: "Инициатива", kind: "number" },
      { key: "cr", label: "Опасность", kind: "text" },
    ],
  },
  token: {
    // current - тоже максимум: у экземпляра на карте текущие хиты свои (Token.hp).
    bar: { current: "hp.max", max: "hp.max" },
    badge: { key: "ac", label: "КД" },
    speed: "speed",
    initiative: "initiative",
  },
  tabs: [
    {
      id: "main",
      title: "Главное",
      blocks: [
        {
          kind: "fields",
          title: "Основное",
          fields: [
            { key: "kind", label: "Тип", kind: "text", width: 14 },
            { key: "size", label: "Размер", kind: "text", width: 10 },
            // Текстом: "1/4", "1/2" - не число.
            { key: "cr", label: "Опасность (CR)", kind: "text", width: 5 },
            { key: "hp.max", label: "Хиты", kind: "number", width: 5, min: 1, max: 99999 },
            { key: "ac", label: "КД", kind: "number", width: 4, min: 0, max: 40 },
            { key: "speed", label: "Скорость", kind: "text", width: 8 },
            // Ручное: у монстра бывает не равна модификатору Ловкости.
            { key: "initiative", label: "Инициатива", kind: "number", width: 4, min: -10, max: 30 },
          ],
        },
        {
          kind: "abilities",
          title: "Характеристики",
          path: "abilities",
          min: 1,
          max: 30,
          items: [
            { key: "str", label: "Сила" },
            { key: "dex", label: "Ловкость" },
            { key: "con", label: "Телосложение" },
            { key: "int", label: "Интеллект" },
            { key: "wis", label: "Мудрость" },
            { key: "cha", label: "Харизма" },
          ],
        },
        {
          kind: "fields",
          title: "Чувства и защита",
          fields: [
            { key: "senses", label: "Чувства", kind: "text", width: 24 },
            { key: "languages", label: "Языки", kind: "text", width: 24 },
            { key: "defenses", label: "Сопротивления и иммунитеты", kind: "text", width: 30 },
            // Текстом, как в статблоке: "Лов +4, Скрытность +6".
            { key: "saves_skills", label: "Спасброски и навыки", kind: "text", width: 30 },
          ],
        },
        {
          kind: "table",
          title: "Атаки",
          path: "attacks",
          addLabel: "Добавить атаку",
          columns: [
            { key: "name", label: "Название", kind: "text" },
            { key: "attack", label: "Атака", kind: "text", width: 5 },
            { key: "damage", label: "Урон", kind: "text", width: 8 },
            { key: "type", label: "Тип", kind: "text", width: 8 },
          ],
          rolls: {
            titleKey: "name",
            items: [
              {
                label: "атака",
                key: "attack",
                d20: { normal: "1d20", advantage: "2d20kh1", disadvantage: "2d20kl1" },
              },
              { label: "урон", key: "damage" },
            ],
          },
        },
        {
          kind: "cards",
          title: "Особенности",
          path: "traits",
          titleKey: "title",
          addLabel: "+ Особенность",
          resourcesPath: "resources",
          fields: [],
        },
        {
          kind: "cards",
          title: "Реакции",
          path: "reactions",
          titleKey: "title",
          addLabel: "+ Реакция",
          resourcesPath: "resources",
          fields: [],
        },
        {
          kind: "fields",
          title: "Заметки",
          // Старые мобы писали особенности сюда - поле осталось, данные целы.
          fields: [{ key: "notes", label: "Заметки", kind: "longtext" }],
        },
      ],
    },
    {id: "gear", title: "Снаряжение", blocks: [{...equipmentBlock, weight: undefined}]},
  ],
};
