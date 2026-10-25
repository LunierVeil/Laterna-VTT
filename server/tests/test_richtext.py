"""Белый список текстов: черта и ссылки. Без сервера: pytest tests/test_richtext.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.importers import lss  # noqa: E402
from app.richtext import clean_doc, safe_href  # noqa: E402


def doc(*content):
    return {"type": "doc", "content": list(content)}


def linked(href, **extra):
    return {"type": "paragraph", "content": [
        {"type": "text", "text": "клик", "marks": [{"type": "link", "attrs": {"href": href, **extra}}]},
    ]}


def test_divider_becomes_empty_horizontal_rule():
    out = clean_doc(doc({"type": "divider", "attrs": {"onclick": "x"}, "content": [{"type": "text", "text": "злое"}]}))
    assert out == {"type": "doc", "content": [{"type": "horizontalRule"}]}


def test_https_link_kept_with_href_only():
    out = clean_doc(doc(linked("https://5e14.ttg.club/x", target="_self", rel="opener", onclick="alert(1)")))
    mark = out["content"][0]["content"][0]["marks"][0]
    assert mark == {"type": "link", "attrs": {"href": "https://5e14.ttg.club/x"}}


def test_dangerous_links_dropped_text_kept():
    for href in (
        "javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>", "data:image/png;base64,AAAA",
        "http://plain.example", "//evil.example", "https://", "https://a b",
        'https://x"onmouseover="alert(1)', "vbscript:x", None, 42,
    ):
        out = clean_doc(doc(linked(href)))
        text = out["content"][0]["content"][0]
        assert text == {"type": "text", "text": "клик"}, href
        assert safe_href(href) is None, href


def test_nilon_links_and_dividers_survive_import():
    data = lss.parse((Path(__file__).parent / "fixtures" / "lss_nilon_app.json").read_text(encoding="utf-8"))[1]
    raw = json.dumps(data, ensure_ascii=False)
    assert '"horizontalRule"' in raw and '"divider"' not in raw
    assert raw.count('"type": "link"') >= 1
    assert "javascript:" not in raw.lower()
