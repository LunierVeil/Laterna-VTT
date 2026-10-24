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

from ..richtext import clean_doc, has_text

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


# Пределы - те же, что min/max в web/src/sheets/dnd5e.ts.
_ABILITIES = ("str", "dex", "con", "int", "wis", "cha")
_COINS = ("cp", "sp", "ep", "gp", "pp")


# --- тексты (TipTap) --------------------------------------------------------

# Раздел текста LSS -> карточка листа. Снаряжение - карточкой предмета,
# остальное - карточками умений: в листе их можно править и дополнять.
_TEXT_LABELS = {
    "features": "Умения и способности",
    "traits": "Умения и особенности",
    "attacks": "Атаки и заклинания",
    "equipment": "Снаряжение",
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


# --- разбор -----------------------------------------------------------------

def parse(raw: object) -> tuple[str, dict]:
    """Файл LSS -> (имя персонажа, data по схеме Laterna)."""
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

    data: dict = {
        "info": {
            "class": _str(info.get("charClass")),
            "subclass": _str(info.get("charSubclass")),
            "level": _int(info.get("level"), 1, 20),
            "race": _str(info.get("race")),
            "background": _str(info.get("background")),
            "alignment": _str(info.get("alignment")),
            "xp": _int(info.get("experience"), 0, 1_000_000),
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
                "save": bool((saves.get(key) or {}).get("isProf")),
            }
            for key in _ABILITIES
        },
        # Только владение. Бонус навыка не считаем: это уже правило.
        "skills": {
            re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_"): {"prof": bool(s.get("isProf"))}
            for key, s in skills.items()
            if isinstance(s, dict)
        },
        "weapons": [
            {
                "name": _str(w.get("name")),
                "attack": _str(w.get("mod"), 20),
                "damage": _str(w.get("dmg"), 60),
                "type": _str(w.get("dmgType"), 60),
            }
            for w in inner.get("weaponsList") or []
            if isinstance(w, dict)
        ],
        "resources": [
            {
                # id - чтобы узлы resource в текстах находили свой счётчик.
                "id": r.get("id") if isinstance(r.get("id"), str) else None,
                "name": _str(r.get("name")),
                "current": _int(r.get("current"), 0, 999),
                "max": _int(r.get("resolvedMax"), 0, 999),
                "rest": "long" if r.get("isLongRest") else "short" if r.get("isShortRest") else None,
            }
            for r in (inner.get("resources") or {}).values()
            if isinstance(r, dict)
        ]
        if isinstance(inner.get("resources"), dict)
        else [],
        "coins": {c: _int((inner.get("coins") or {}).get(c), 0, 9_999_999) for c in _COINS}
        if isinstance(inner.get("coins"), dict)
        else {},
        "features": [],
        "equipment": [],
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
        label = _str(entry.get("customLabel")) or _TEXT_LABELS.get(key) or key
        # id из ключа LSS: переимпорт даёт те же карточки, а не новые.
        if key == "equipment":
            data["equipment"].append({"id": f"lss-{key}", "name": label, "doc": doc, "source": "lss"})
        else:
            data["features"].append({"id": f"lss-{key}", "title": label, "doc": doc, "source": "lss"})

    return name, data
