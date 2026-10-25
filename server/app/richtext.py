"""Документы TipTap в листе: тексты умений, описания предметов.

Белый список узлов и меток. Текст пишет игрок (в редакторе или в
импортированном файле), а видит вся кампания - всё, чего нет в списке,
выбрасываем. Клиент рисует по такому же списку и без innerHTML - это
второй слой, а не замена этому.
"""

from __future__ import annotations

import re

from urllib.parse import urlsplit

NODES = {
    "doc", "paragraph", "text", "hardBreak", "heading", "bulletList", "orderedList", "listItem", "resource",
    "horizontalRule",
}
# Другие имена тех же узлов: LSS пишет горизонтальную черту как divider,
# а редактор листа (TipTap) знает её как horizontalRule.
ALIASES = {"divider": "horizontalRule"}
MARKS = {"bold", "italic", "link"}
MAX_TEXT_DEPTH = 12
MAX_HREF = 2000
_HREF = re.compile(r"https://[^\s<>\"'`\\]+")


def safe_href(value: object) -> str | None:
    """Ссылка - только https с хостом. javascript:, data:, http:, // и
    прочее - None: текст останется, ссылки не будет. rel и target ставит
    клиент при отрисовке, из файла их не берём."""
    if not isinstance(value, str) or len(value) > MAX_HREF or not _HREF.fullmatch(value):
        return None
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    return value if parts.scheme == "https" and parts.hostname else None


def _mark(m: object) -> dict | None:
    if not isinstance(m, dict) or m.get("type") not in MARKS:
        return None
    if m["type"] != "link":
        return {"type": m["type"]}
    href = safe_href((m.get("attrs") or {}).get("href") if isinstance(m.get("attrs"), dict) else None)
    return {"type": "link", "attrs": {"href": href}} if href else None


def clean_doc(node: object, depth: int = 0) -> dict | None:
    if depth > MAX_TEXT_DEPTH or not isinstance(node, dict):
        return None
    kind = ALIASES.get(node.get("type"), node.get("type"))
    if kind not in NODES:
        return None
    out: dict = {"type": kind}
    if kind == "text":
        text = node.get("text")
        if not isinstance(text, str) or not text:
            return None
        out["text"] = text[:5000]
        marks = [m for m in (_mark(x) for x in node.get("marks") or []) if m]
        if marks:
            out["marks"] = marks
        return out
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    if kind == "resource":
        rid = attrs.get("id")
        if not isinstance(rid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", rid):
            return None
        out["attrs"] = {"id": rid}
        return out
    if kind == "horizontalRule":
        return out  # пустой узел: ни атрибутов, ни содержимого
    if kind == "heading":
        level = attrs.get("level")
        out["attrs"] = {"level": level if isinstance(level, int) and 1 <= level <= 6 else 3}
    content = [c for c in (clean_doc(x, depth + 1) for x in node.get("content") or []) if c]
    if content:
        out["content"] = content
    return out


def has_text(node: dict) -> bool:
    if node.get("type") == "text":
        return bool(node.get("text", "").strip())
    if node.get("type") == "resource":
        return True
    return any(has_text(c) for c in node.get("content", []))


def clean_docs(value: object) -> object:
    """Пройти по значению и почистить каждый документ TipTap в нём."""
    if isinstance(value, dict):
        if value.get("type") == "doc":
            return clean_doc(value) or {"type": "doc"}
        return {k: clean_docs(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_docs(v) for v in value]
    return value
