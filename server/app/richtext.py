"""Документы TipTap в листе: тексты умений, описания предметов.

Белый список узлов и меток. Текст пишет игрок (в редакторе или в
импортированном файле), а видит вся кампания - всё, чего нет в списке,
выбрасываем. Клиент рисует по такому же списку и без innerHTML - это
второй слой, а не замена этому.
"""

from __future__ import annotations

import re

NODES = {"doc", "paragraph", "text", "hardBreak", "heading", "bulletList", "orderedList", "listItem", "resource"}
MARKS = {"bold", "italic"}
MAX_TEXT_DEPTH = 12


def clean_doc(node: object, depth: int = 0) -> dict | None:
    if depth > MAX_TEXT_DEPTH or not isinstance(node, dict):
        return None
    kind = node.get("type")
    if kind not in NODES:
        return None
    out: dict = {"type": kind}
    if kind == "text":
        text = node.get("text")
        if not isinstance(text, str) or not text:
            return None
        out["text"] = text[:5000]
        marks = [
            {"type": m["type"]}
            for m in node.get("marks") or []
            if isinstance(m, dict) and m.get("type") in MARKS
        ]
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
