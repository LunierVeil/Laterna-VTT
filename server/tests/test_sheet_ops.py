"""Операции листа: элемент списка и счётчик. Без сервера: cd server && pytest tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.sheet_data import SheetError, apply_counter, apply_list  # noqa: E402


def test_list_add_assigns_server_id_and_cleans():
    data = apply_list({}, "spells", "add", item={"id": "my-own", "name": "А", "level": 1,
                                                  "doc": {"type": "doc", "content": [{"type": "html", "text": "<x>"}]}})
    spell = data["spells"][0]
    assert spell["name"] == "А" and spell["id"].startswith("i-") and spell["id"] != "my-own"
    assert spell["doc"] == {"type": "doc"}  # белый список текстов


def test_list_update_and_remove_by_id():
    data = apply_list({}, "spells", "add", item={"name": "А", "prepared": False})
    data = apply_list(data, "spells", "add", item={"name": "Б"})
    first = data["spells"][0]["id"]
    data = apply_list(data, "spells", "update", item_id=first, changes={"prepared": True})
    assert data["spells"][0] == {**data["spells"][0], "name": "А", "prepared": True}
    data = apply_list(data, "spells", "remove", item_id=first)
    assert [s["name"] for s in data["spells"]] == ["Б"]


@pytest.mark.parametrize("kwargs", [
    {"op": "update", "item_id": "nope", "changes": {"x": 1}},
    {"op": "remove", "item_id": None},
    {"op": "explode"},
    {"op": "add", "item": "not a dict"},
    {"op": "update", "item_id": "i-1", "changes": {"id": "hijack"}},
])
def test_list_errors(kwargs):
    data = {"spells": [{"id": "i-1", "name": "А"}]}
    with pytest.raises(SheetError):
        apply_list(data, "spells", **kwargs)


def test_list_on_non_list_path():
    with pytest.raises(SheetError):
        apply_list({"spells": {"a": 1}}, "spells", "add", item={"name": "x"})


def test_counter_spend_slot():
    data = {"slots": {"1": {"total": 2}}}
    data = apply_counter(data, "slots.1.left", -1, "slots.1.total")  # пусто = полно -> 1
    assert data["slots"]["1"]["left"] == 1
    data = apply_counter(data, "slots.1.left", -1, "slots.1.total")
    data = apply_counter(data, "slots.1.left", -1, "slots.1.total")  # не ниже 0
    assert data["slots"]["1"]["left"] == 0
    data = apply_counter(data, "slots.1.left", 5, "slots.1.total")  # не выше всего
    assert data["slots"]["1"]["left"] == 2


@pytest.mark.parametrize("delta", [1.5, True, "1", 1000, float("inf")])
def test_counter_bad_delta(delta):
    with pytest.raises(SheetError):
        apply_counter({}, "x", delta)
