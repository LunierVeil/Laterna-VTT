"""Импорт листа из Long Story Short (jsonType "character", version "2").

Такой файл отдаёт mycharacterbuilder.com кнопкой "скачать" и сам LSS.
Адаптер переводит его в схему листа Laterna (web/src/sheets/dnd5e.ts).
Формат LSS внутрь не попадает: он версионирован и поменяется, а свой лист
- наш. Исходный файл хранится рядом с листом целиком, чтобы при смене
адаптера переимпортировать.

Правил тут нет: только перенос значений из одних полей в другие.
"""

from __future__ import annotations

import json
import re

from .. import dice
from ..richtext import clean_doc, has_text, safe_href

FORMAT = "lss-2"
SUPPORTED_VERSION = "2"
MAX_BYTES = 512 * 1024


class LssError(ValueError):
    pass


# --- значения ---------------------------------------------------------------

def _val(node: object) -> object:
    """LSS почти всё хранит как {"value": x}."""
    return node.get("value") if isinstance(node, dict) else node


def _str(node: object, limit: int = 200) -> str | None:
    value = _val(node)
    if value is None or isinstance(value, (dict, list)):
        return None
    text = str(value).strip()
    return text[:limit] or None


def _int(node: object, lo: int, hi: int) -> int | None:
    """Число из 16, "16", "+10". Вне пределов схемы - обрезаем до границы:
    пределы в листе - защита от опечаток, и файл им тоже подчиняется."""
    value = _val(node)
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        m = re.fullmatch(r"\s*([+-]?\d+)\s*", value)
        value = int(m.group(1)) if m else None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if not isinstance(value, int):
        return None
    return max(lo, min(hi, value))


def _prof(node: object) -> bool:
    """isProf бывает 0/1, true/false, None. 2 - пока тоже владение: похоже на
    мастерство (двойной бонус), но поля под него в листе нет - не выдумываем."""
    value = _val(node) if isinstance(node, dict) else node
    return bool(value) and value is not False


# Урон из LSS - и формула, и слова: "1 д8 +4 рубящий +1д6 сияющий". Бросаемое
# (кубы и числа) - в формулу, слова (типы урона) - в type. Это разбор записи,
# а не правило: что бросать, решает текст игрока.
_DMG_TERM = re.compile(
    r"(?P<sign>[+\-−])?\s*(?P<term>\d*\s*[dDдДкКkK]\s*\d+|\d+)(?!\d)(?![a-zA-Zа-яА-ЯёЁ])"
)


def _split_damage(text: str | None) -> tuple[str | None, list[str]]:
    """Строка урона -> (формула с "к" или None, слова-типы)."""
    if not text:
        return None, []
    terms = []
    for m in _DMG_TERM.finditer(text):
        term = re.sub(r"\s+", "", m.group("term"))
        term = re.sub(r"[dDдДкКkK]", "к", term)
        sign = "-" if m.group("sign") in ("-", "−") else "+"
        terms.append((sign, term))
    rest = _DMG_TERM.sub(" ", text)
    words = [w for w in re.split(r"[\s+,;/]+", rest) if re.search(r"[a-zA-Zа-яА-ЯёЁ]", w)]
    if not terms:
        return None, words
    formula = "".join(f"{sign}{term}" for sign, term in terms).lstrip("+")
    try:
        dice.roll(formula)  # бросаемо ли - проверяет тот же парсер, что и бросок
    except dice.DiceError:
        return None, words
    return formula, words


def _weapon(w: dict) -> dict:
    formula, words = _split_damage(_str(w.get("dmg"), 120))
    types = [t for t in [_str(w.get("dmgType"), 60), *words] if t]
    notes = _str(w.get("notes"), 2000)
    raw_dmg = _str(w.get("dmg"), 120)
    if raw_dmg and formula is None:
        # Бросить нечего - текст остаётся заметкой, без кнопки броска.
        notes = f"{raw_dmg}\n{notes}" if notes else raw_dmg
    ability = w.get("ability") if w.get("ability") in _ABILITIES else None
    return {
        "name": _str(w.get("name")),
        # Нет mod - атаку не выдумываем: лист покажет подсказку из ability и
        # владения, ручное значение игрока главнее.
        "attack": _str(w.get("mod"), 20),
        "damage": formula,
        "type": ", ".join(dict.fromkeys(types))[:120] or None,
        "notes": notes,
        "ability": ability,
        "prof": _prof(w.get("isProf")),
        "source": "lss",
    }


def _text_doc(text: str | None) -> dict | None:
    """Простой текст (заметки ресурса) -> документ: абзацы по пустой строке,
    переносы внутри - hardBreak. Через тот же белый список, что и тексты."""
    if not text or not text.strip():
        return None
    paragraphs = []
    for block in re.split(r"\n\s*\n", text.strip()):
        content: list = []
        for i, line in enumerate(block.split("\n")):
            if i:
                content.append({"type": "hardBreak"})
            if line.strip():
                content.append({"type": "text", "text": line.rstrip()})
        paragraphs.append({"type": "paragraph", "content": content})
    return clean_doc({"type": "doc", "content": paragraphs})


# Где ресурс лежит в LSS: снаряжение - это предметы, а не счётчики.
_ITEM_LOCATIONS = {"equipment", "items"}


def _resources(raw: object) -> tuple[list, list, int]:
    """resources LSS -> (счётчики, карточки снаряжения, сколько удалённых).

    Удалённое (isDeleted) и осиротевшее (orphanedAt - удалили то, к чему
    ресурс был привязан) не переносим. Снаряжение - предметами: имя,
    количество = current, описание = notes; resolvedMax у предмета - шум
    формата, не счётчик. Остальное - счётчики, current > max не обрезаем:
    так в файле, лист покажет как есть. Дубли по имени склеиваем.
    """
    if not isinstance(raw, dict):
        return [], [], 0
    counters: dict[str, dict] = {}
    items: dict[str, dict] = {}
    deleted = 0
    for r in raw.values():
        if not isinstance(r, dict):
            continue
        if r.get("isDeleted") or r.get("orphanedAt"):
            deleted += 1
            continue
        name = _str(r.get("name"))
        key = (name or "").casefold()
        rid = r.get("id") if isinstance(r.get("id"), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", r["id"]) else None
        if r.get("location") in _ITEM_LOCATIONS:
            qty = _int(r.get("current"), 0, 99999)
            doc = _text_doc(_str(r.get("notes"), 20_000))
            if key in items:
                same = items[key]
                if qty is not None:
                    same["qty"] = (same.get("qty") or 0) + qty
                if doc and same.get("doc") != doc:
                    same["doc"] = {"type": "doc", "content": (same.get("doc") or {}).get("content", []) + doc["content"]}
                continue
            items[key] = {
                # id ресурса как есть: на него ссылаются фишки в текстах LSS
                # (раздел "Снаряжение" - это список таких фишек).
                "id": rid or f"lss-item-{len(items) + 1}",
                "name": name,
                "qty": qty,
                "doc": doc,
                "source": "lss",
            }
            continue
        if key in counters:
            continue  # дубль счётчика - первый главнее
        counters[key] = {
            # id - чтобы узлы resource в текстах находили свой счётчик.
            "id": rid,
            "name": name,
            "current": _int(r.get("current"), 0, 999),
            "max": _int(r.get("resolvedMax"), 0, 999),
            "rest": "long" if r.get("isLongRest") else "short" if r.get("isShortRest") else None,
            "source": "lss",
        }
    return list(counters.values()), list(items.values()), deleted


# Внешность из subInfo - поля "О персонаже".
_SUB_INFO = ("age", "height", "weight", "eyes", "skin", "hair")
# Размер - значения select в схеме листа.
_SIZES = {"tiny", "small", "medium", "large", "huge", "gargantuan"}


def _size(node: object) -> str | None:
    value = _str(node, 20)
    return value.lower() if value and value.lower() in _SIZES else None


# Пределы - те же, что min/max в web/src/sheets/dnd5e.ts.
_ABILITIES = ("str", "dex", "con", "int", "wis", "cha")
_COINS = ("cp", "sp", "ep", "gp", "pp")


# --- тексты (TipTap) --------------------------------------------------------

# Раздел текста LSS -> карточка листа. Снаряжение - карточкой предмета,
# личность и история - на вкладку «О персонаже» (data.lore), остальное -
# карточками умений. В листе их можно править и дополнять.
_TEXT_LABELS = {
    "features": "Умения и способности",
    "traits": "Умения и особенности",
    "attacks": "Атаки и заклинания",
    "equipment": "Снаряжение",
    "items": "Предметы",
    "prof": "Прочие владения и языки",
    "personality": "Черты характера",
    "ideals": "Идеалы",
    "bonds": "Привязанности",
    "flaws": "Слабости",
    "allies": "Союзники и организации",
    "background": "Предыстория",
    "quests": "Задания",
    "feats": "Черты",
    "appearance": "Внешность",
    "notes-1": "Заметки",
    "notes-2": "Заметки 2",
    "notes-3": "Заметки 3",
}


# Тексты о персонаже, а не о его умениях. Карточками (lore), а не в поля
# textarea: в LSS это документы TipTap со списками и жирным, в textarea они
# потеряли бы вид. Поля «Внешность», «Черты характера»... листа - для
# своего текста игрока, импорт их не трогает (и переимпорт не затирает).
_LORE_KEYS = {
    "background", "appearance", "personality", "ideals", "bonds", "flaws",
    "allies", "quests", "notes-1", "notes-2", "notes-3",
}

# --- разбор -----------------------------------------------------------------

def _unique_title(label: str, cards: list, title_key: str) -> str:
    """Два раздела с одним заголовком ("Записи", одинаковые customLabel) -
    нумеруем: "Записи 2", чтобы карточки различались."""
    taken = {c.get(title_key) for c in cards}
    if label not in taken:
        return label
    n = 2
    while f"{label} {n}" in taken:
        n += 1
    return f"{label} {n}"


def parse(raw: object) -> tuple[str, dict]:
    """Файл LSS -> (имя персонажа, data по схеме Laterna)."""
    name, data, _ = parse_report(raw)
    return name, data


def _bad_links(node: object, depth: int = 0) -> int:
    """Сколько ссылок в тексте отброшено (не https) - для отчёта."""
    if not isinstance(node, dict) or depth > 24:
        return 0
    count = sum(
        1
        for m in node.get("marks") or []
        if isinstance(m, dict) and m.get("type") == "link"
        and not safe_href((m.get("attrs") or {}).get("href") if isinstance(m.get("attrs"), dict) else None)
    )
    return count + sum(_bad_links(c, depth + 1) for c in node.get("content") or [])


def _report(data: dict, deleted: int, avatar: bool, bad_links: int) -> dict:
    """Что перенесено и что нет - одной строкой в интерфейсе после загрузки."""
    items = [c for c in data["equipment"] if c.get("qty") is not None]
    texts = len(data["features"]) + len(data["lore"]) + len(data["equipment"]) - len(items)
    done = [
        f"{label} {n}"
        for label, n in (
            ("оружие", len(data["weapons"])),
            ("счётчики", len(data["resources"])),
            ("предметы", len(items)),
            ("тексты", texts),
        )
        if n
    ]
    skipped = []
    if deleted:
        skipped.append(f"удалённое в LSS: {deleted}")
    if avatar:
        skipped.append("портрет не перенесён, загрузите вручную")
    if bad_links:
        skipped.append(f"ссылки не https: {bad_links}")
    return {"done": done, "skipped": skipped}


def parse_report(raw: object) -> tuple[str, dict, dict]:
    """parse + отчёт: что перенесено, что пропущено (удалённое, портрет,
    ссылки не https)."""
    # Размер - первым: дальше файл разбирается целиком.
    if isinstance(raw, str) and len(raw.encode()) > MAX_BYTES:
        raise LssError(f"файл больше {MAX_BYTES // 1024} КБ")
    if not isinstance(raw, str) or not raw.strip():
        raise LssError("пустой файл")
    try:
        outer = json.loads(raw)
    except json.JSONDecodeError:
        raise LssError("это не JSON")
    if not isinstance(outer, dict) or outer.get("jsonType") != "character":
        raise LssError("это не лист персонажа Long Story Short (нет jsonType: character)")
    version = str(outer.get("version"))
    if version != SUPPORTED_VERSION:
        raise LssError(
            f"версия файла LSS {version!r} не поддерживается - умеем только {SUPPORTED_VERSION!r}"
        )

    # data - JSON строкой внутри JSON: разбираем второй раз.
    inner = outer.get("data")
    if isinstance(inner, str):
        try:
            inner = json.loads(inner)
        except json.JSONDecodeError:
            raise LssError("поле data повреждено: внутри не JSON")
    if not isinstance(inner, dict):
        raise LssError("в файле нет данных персонажа (поле data)")

    name = _str(inner.get("name")) or "Персонаж"
    info = inner.get("info") if isinstance(inner.get("info"), dict) else {}
    vit = inner.get("vitality") if isinstance(inner.get("vitality"), dict) else {}
    stats = inner.get("stats") if isinstance(inner.get("stats"), dict) else {}
    saves = inner.get("saves") if isinstance(inner.get("saves"), dict) else {}
    skills = inner.get("skills") if isinstance(inner.get("skills"), dict) else {}
    sub = inner.get("subInfo") if isinstance(inner.get("subInfo"), dict) else {}

    counters, items, deleted = _resources(inner.get("resources"))

    data: dict = {
        "info": {
            "class": _str(info.get("charClass")),
            "subclass": _str(info.get("charSubclass")),
            "level": _int(info.get("level"), 1, 20),
            "race": _str(info.get("race")),
            "background": _str(info.get("background")),
            "alignment": _str(info.get("alignment")),
            "xp": _int(info.get("experience"), 0, 1_000_000),
            "size": _size(info.get("size")),
            # Внешность (subInfo): пустые значения _str отбрасывает в None.
            **{key: _str(sub.get(key), 60) for key in _SUB_INFO},
        },
        "vitals": {
            "hp": {
                "current": _int(vit.get("hp-current"), -999, 9999),
                "max": _int(vit.get("hp-max"), 1, 9999),
                "temp": _int(vit.get("hp-temp"), 0, 9999),
            },
            "ac": _int(vit.get("ac"), 0, 40),
            "speed": _str(vit.get("speed"), 40),
            "initiative": _int(vit.get("initiative"), -10, 30),
            "hit_dice": _str(vit.get("hit-die"), 40),
        },
        "proficiency": _int(inner.get("proficiency"), 0, 10),
        "abilities": {
            key: {
                "score": _int((stats.get(key) or {}).get("score"), 1, 30),
                "save": _prof((saves.get(key) or {}).get("isProf")),
            }
            for key in _ABILITIES
        },
        # Только владение. Бонус навыка не считаем: это уже правило.
        "skills": {
            re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_"): {"prof": _prof(s.get("isProf"))}
            for key, s in skills.items()
            if isinstance(s, dict)
        },
        "weapons": [_weapon(w) for w in inner.get("weaponsList") or [] if isinstance(w, dict)],
        "resources": counters,
        "coins": {c: _int((inner.get("coins") or {}).get(c), 0, 9_999_999) for c in _COINS}
        if isinstance(inner.get("coins"), dict)
        else {},
        "features": [],
        "equipment": items,
        "lore": [],
        "import": {"edition": _str(outer.get("edition"), 20)},
    }

    texts = inner.get("text") if isinstance(inner.get("text"), dict) else {}
    for key, entry in texts.items():
        if not isinstance(entry, dict) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", key):
            continue
        value = entry.get("value") if isinstance(entry.get("value"), dict) else {}
        doc = clean_doc(value.get("data") if "data" in value else value)
        # Пустые разделы (в LSS там часто пустые абзацы) не тащим в лист.
        if not doc or not has_text(doc):
            continue
        # Заголовок: своя подпись игрока, иначе из таблицы, иначе "Записи" -
        # сырой ключ формата ("items") игроку ничего не говорит.
        label = _str(entry.get("customLabel")) or _TEXT_LABELS.get(key) or "Записи"
        # id из ключа LSS: переимпорт даёт те же карточки, а не новые.
        if key in ("equipment", "items"):
            target, title_key = "equipment", "name"
        elif key in _LORE_KEYS:
            target, title_key = "lore", "title"
        else:
            target, title_key = "features", "title"
        cards = data[target]
        data[target].append({"id": f"lss-{key}", title_key: _unique_title(label, cards, title_key), "doc": doc, "source": "lss"})

    avatar = inner.get("avatar")
    # Портрет в LSS - ссылка на их сервер. Не скачиваем и не храним чужие
    # адреса: в <img> они заставили бы браузеры всех ходить туда.
    has_avatar = bool(avatar) and avatar != {}
    bad_links = sum(
        _bad_links(e.get("value", {}).get("data") if isinstance(e.get("value"), dict) else None)
        for e in texts.values()
        if isinstance(e, dict)
    )
    return name, data, _report(data, deleted, has_avatar, bad_links)


# --- переимпорт --------------------------------------------------------------

def _identity(row: dict) -> object:
    return row.get("id") or row.get("name") or row.get("title")


def _merge_rows(old: list, new: list) -> list:
    """Строки и карточки из файла - заново, свои строки игрока - остаются.

    Своё - без пометки source="lss" и не совпадает с новой строкой по id или
    имени: у листов, импортированных до пометки source, строки из файла
    узнаются по имени и не дублируются.
    """
    taken = {_identity(r) for r in new if isinstance(r, dict)}
    previous = {_identity(r): r for r in old if isinstance(r, dict)}
    # Та же строка, что была (по id или имени), - по полям: пустое в файле не
    # затирает вписанное игроком (атака оружия, которой в LSS не было).
    fresh = [
        _merge_dict(previous[_identity(r)], r) if isinstance(r, dict) and _identity(r) in previous else r
        for r in new
    ]
    own = [
        r for r in old
        if isinstance(r, dict) and r.get("source") != "lss" and _identity(r) not in taken
    ]
    return fresh + own


def _merge_dict(old: dict, new: dict) -> dict:
    out = dict(old)
    for key, value in new.items():
        prev = old.get(key)
        if isinstance(value, dict) and isinstance(prev, dict):
            out[key] = _merge_dict(prev, value)
        elif isinstance(value, list) and isinstance(prev, list):
            out[key] = _merge_rows(prev, value)
        elif value is None and key in old:
            continue  # в файле пусто - вписанное игроком не трогаем
        else:
            out[key] = value
    return out


def merge_reimport(old: object, new: dict) -> dict:
    """Переимпорт поверх листа, не теряя того, что игрок вписал сам.

    Значения, которые есть в файле (хиты, характеристики, владения...), -
    из файла: ради этого переимпорт и запускают. Чего в файле нет - остаётся:
    поля «О персонаже», заметки, портрет, свой бонус навыка, свои карточки,
    оружие и ресурсы. Правил тут тоже нет - только какое значение чьё.
    """
    return _merge_dict(old if isinstance(old, dict) else {}, new)
