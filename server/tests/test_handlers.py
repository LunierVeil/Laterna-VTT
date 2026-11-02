"""Команды сервера через настоящий websocket, без живого процесса.

pytest tests/ - приложение поднимается на временной SQLite (conftest.py).
Проверяется то, что сломать проще всего и что не видно в интерфейсе:
права, утечки игрокам, мусор в числах.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

# Временную базу подставляет conftest.py - его грузит pytest. Запуск без
# него (unittest, импорт руками) писал бы в настоящую базу мастера.
if "laterna-tests-" not in os.environ.get("DATABASE_URL", ""):
    raise RuntimeError("tests/test_handlers.py запускается через pytest (нужен conftest.py)")

from app import auth, handlers, main
from app.main import app

GM_KEY = os.environ["LANTERNA_GM_KEY"]  # задаёт conftest.py


def recv_until(ws, pred, limit=50):
    for _ in range(limit):
        msg = ws.receive_json()
        if pred(msg):
            return msg
    raise AssertionError("ожидаемое сообщение не пришло")


def run(ws, cid: str, name: str, payload: dict) -> dict:
    """Команда и ответ на неё (событие или ошибка с тем же cmd_id)."""
    # json.dumps пишет inf как Infinity - ровно так их пришлёт и браузер-злоумышленник.
    ws.send_text(json.dumps({"type": "cmd", "id": cid, "name": name, "payload": payload}))
    return recv_until(ws, lambda m: m.get("cmd_id") == cid)


# Один TestClient на всё: у каждого клиента свой цикл событий, а движок базы
# общий - соединения двух циклов блокировали SQLite. ГМ и игрок отличаются
# cookie сессии в заголовке, банка cookie клиента остаётся пустой.
@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def session_headers(client: TestClient, response) -> dict:
    assert response.status_code == 200, response.text
    token = response.cookies[auth.SESSION_COOKIE]
    client.cookies.clear()
    return {"cookie": f"{auth.SESSION_COOKIE}={token}"}


@pytest.fixture(scope="module")
def gm(client) -> dict:
    r = client.post("/api/gm/login", json={"key": GM_KEY, "name": "Мастер", "password": "masterpass1"})
    return session_headers(client, r)


@pytest.fixture(scope="module")
def scene_id(client, gm) -> str:
    return client.get("/api/campaign", headers=gm).json()["active_scene_id"]


@pytest.fixture(scope="module")
def player(client, gm, scene_id) -> dict:
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
        ws.receive_json()
        ws.send_text(json.dumps({"type": "cmd", "id": "inv", "name": "invite.create", "payload": {}}))
        token = recv_until(ws, lambda m: m.get("type") == "reply")["payload"]["token"]
        # После ответа сервер рассылает список кампании - ещё в сессии базы.
        # Закрыть сокет раньше - TestClient оборвёт обработчик с открытым
        # чтением, и следующая запись упрётся в "database is locked".
        recv_until(ws, lambda m: m.get("type") == "campaign")
    r = client.post("/api/invite/accept", json={"token": token, "name": "Игрок", "password": "playerpass1"})
    headers = session_headers(client, r)
    headers_id = r.json()["id"]
    return {"headers": headers, "id": headers_id}


@pytest.fixture
def sockets(client, gm, player, scene_id):
    """Сокеты ГМ и игрока на одной сцене, снапшоты уже прочитаны."""
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as g, client.websocket_connect(
        f"/ws/scene/{scene_id}", headers=player["headers"]
    ) as p:
        assert g.receive_json()["type"] == "snapshot"
        assert p.receive_json()["type"] == "snapshot"
        yield g, p


def is_event(m: dict) -> bool:
    return m.get("type") == "event"


# --- двери ------------------------------------------------------------------


def test_doors(sockets):
    g, p = sockets
    door = run(g, "d1", "wall.add", {"x1": 280, "y1": 560, "x2": 280, "y2": 630, "kind": "door"})["payload"]["wall"]
    tok = run(p, "d2", "token.add", {"x": 245, "y": 595})["payload"]["token"]
    try:
        # Закрытая дверь - стена.
        assert run(p, "d3", "token.move", {"id": tok["id"], "x": 315, "y": 595})["type"] == "error"
        # Открыть может игрок, и тогда проход есть.
        assert run(p, "d4", "wall.door", {"id": door["id"], "state": "open"})["type"] == "event"
        assert run(p, "d5", "token.move", {"id": tok["id"], "x": 315, "y": 595})["type"] == "event"
        assert run(p, "d6", "token.move", {"id": tok["id"], "x": 245, "y": 595})["type"] == "event"
        # Запертую игрок не отпирает и сам не запирает.
        assert run(g, "d7", "wall.door", {"id": door["id"], "state": "locked"})["type"] == "event"
        err = run(p, "d8", "wall.door", {"id": door["id"], "state": "open"})
        assert err["type"] == "error" and "заперта" in err["message"]
        assert run(p, "d9", "token.move", {"id": tok["id"], "x": 315, "y": 595})["type"] == "error"
        assert run(g, "d10", "wall.door", {"id": door["id"], "state": "closed"})["type"] == "event"
        assert run(p, "d11", "wall.door", {"id": door["id"], "state": "locked"})["type"] == "error"
    finally:
        run(p, "d12", "token.remove", {"id": tok["id"]})
        run(g, "d13", "wall.remove", {"id": door["id"]})


# --- скрытый бросок ---------------------------------------------------------


def test_hidden_roll(sockets):
    g, p = sockets
    g.send_text(json.dumps({"type": "cmd", "id": "r1", "name": "chat.say", "payload": {"text": "/gr 1d20+7"}}))
    got_g = recv_until(g, lambda m: m.get("type") == "chat")
    got_p = recv_until(p, lambda m: m.get("type") == "chat")
    assert got_g["message"]["roll"]["hidden"] and got_g["message"]["roll"]["formula"] == "1d20+7"
    msg = got_p["message"]
    assert msg["kind"] == "hidden_roll" and msg["roll"] is None and msg["text"] == ""
    # Ни формулы, ни итога - нигде в сообщении.
    raw = json.dumps(got_p)
    assert "1d20" not in raw and f'"total": {got_g["message"]["roll"]["total"]}' not in raw

    err = run(p, "r2", "chat.say", {"text": "/gr 1d20"})
    assert err["type"] == "error"
    err = run(p, "r3", "dice.roll", {"formula": "1d20", "hidden": True})
    assert err["type"] == "error"


# --- хиты моба --------------------------------------------------------------


def test_mob_hp_visibility(sockets, player):
    g, p = sockets
    g.send_text(json.dumps({"type": "cmd", "id": "m1", "name": "character.create", "payload": {"name": "Гоблин", "system": "mob"}}))
    mob = recv_until(g, lambda m: m.get("cmd_id") == "m1")["payload"]["character"]
    g.send_text(json.dumps({"type": "cmd", "id": "m2", "name": "character.update", "payload": {"id": mob["id"], "set": {"hp.max": 7}}}))
    recv_until(g, lambda m: m.get("type") == "character")
    try:
        ev = run(g, "m3", "token.add", {"x": 455, "y": 175, "character_id": mob["id"]})
        tok = ev["payload"]["token"]
        assert tok["hp"] == 7, "ГМ видит хиты экземпляра"
        seen = recv_until(p, lambda m: m.get("name") == "token.added")
        assert seen["payload"]["token"]["hp"] is None, "игроку хиты моба не уходят"

        # Отдали токен игроку - теперь он владелец и видит число.
        ev = run(g, "m4", "token.update", {"id": tok["id"], "owner_id": player["id"]})
        assert ev["payload"]["token"]["hp"] == 7
        seen = recv_until(p, lambda m: m.get("name") == "token.updated")
        assert seen["payload"]["token"]["hp"] == 7, "владелец токена видит хиты"
    finally:
        run(g, "m5", "token.remove", {"id": tok["id"]})
        g.send_text(json.dumps({"type": "cmd", "id": "m6", "name": "character.delete", "payload": {"id": mob["id"]}}))
        recv_until(g, lambda m: m.get("type") == "character_deleted")


# --- конечные числа ---------------------------------------------------------


def test_infinite_wall_rejected_and_scene_still_loads(client, gm, sockets, scene_id):
    g, _ = sockets
    for bad in (float("inf"), float("-inf"), float("nan")):
        err = run(g, "n1", "wall.add", {"x1": bad, "y1": 0, "x2": 100, "y2": 100})
        assert err["type"] == "error", err
    # Снапшот сцены сериализуется: inf в базе ронял бы его с 500 для всех.
    r = client.get(f"/api/scenes/{scene_id}", headers=gm)
    assert r.status_code == 200
    assert all(abs(w["x1"]) < 1e9 for w in r.json()["walls"])


def test_wall_clamped_to_scene(client, gm, sockets, scene_id):
    g, _ = sockets
    wall = run(g, "n2", "wall.add", {"x1": -500, "y1": 10, "x2": 10**9, "y2": 10})["payload"]["wall"]
    try:
        scene = client.get(f"/api/scenes/{scene_id}", headers=gm).json()
        assert wall["x1"] == 0 and wall["x2"] == scene["width"]
    finally:
        run(g, "n3", "wall.remove", {"id": wall["id"]})


@pytest.mark.parametrize(
    "name,payload",
    [
        ("token.add", {"x": 10, "y": 10, "size": float("inf")}),
        ("token.add", {"x": float("nan"), "y": 10}),
        ("scene.update", {"grid_size": float("inf")}),
        ("scene.update", {"width": float("nan")}),
        ("scene.update", {"height": "1e400"}),
    ],
)
def test_non_finite_numbers_rejected(sockets, name, payload):
    g, _ = sockets
    err = run(g, "n4", name, payload)
    assert err["type"] == "error", err


def test_combat_numbers_rejected(sockets):
    g, _ = sockets
    tok = run(g, "c1", "token.add", {"x": 35, "y": 35})["payload"]["token"]
    try:
        ev = run(g, "c2", "combat.add", {"token_id": tok["id"]})
        entry_id = ev["payload"]["combat"]["entries"][-1]["id"]
        assert run(g, "c3", "combat.set", {"entry_id": entry_id, "init": float("inf")})["type"] == "error"
        assert run(g, "c4", "combat.roll", {"entry_id": entry_id, "bonus": float("nan")})["type"] == "error"
    finally:
        run(g, "c5", "combat.end", {})
        run(g, "c6", "token.remove", {"id": tok["id"]})


def test_hp_inf_is_error_and_socket_survives(sockets):
    g, _ = sockets
    g.send_text(json.dumps({"type": "cmd", "id": "h1", "name": "character.create", "payload": {"name": "Волк", "system": "mob"}}))
    mob = recv_until(g, lambda m: m.get("cmd_id") == "h1")["payload"]["character"]
    tok = run(g, "h2", "token.add", {"x": 105, "y": 105, "character_id": mob["id"]})["payload"]["token"]
    try:
        for bad in (float("inf"), float("nan"), 2.5, True):
            err = run(g, "h3", "token.update", {"id": tok["id"], "hp": bad})
            assert err["type"] == "error", (bad, err)
        # Тот же сокет жив и принимает команды.
        g.send_text(json.dumps({"type": "cmd", "id": "h4", "name": "chat.say", "payload": {"text": "жив"}}))
        assert recv_until(g, lambda m: m.get("type") == "chat")["message"]["text"] == "жив"
    finally:
        run(g, "h5", "token.remove", {"id": tok["id"]})
        g.send_text(json.dumps({"type": "cmd", "id": "h6", "name": "character.delete", "payload": {"id": mob["id"]}}))
        recv_until(g, lambda m: m.get("type") == "character_deleted")


def test_internal_error_keeps_socket(sockets, monkeypatch):
    """Упал сам хендлер (не CommandError) - ответ "внутренняя ошибка", сокет жив."""
    g, _ = sockets

    async def broken(*args, **kwargs):
        raise RuntimeError("сломалось")

    monkeypatch.setitem(main.HANDLERS, "token.add", broken)
    monkeypatch.setitem(main.CAMPAIGN_HANDLERS, "dice.roll", broken)
    err = run(g, "e1", "token.add", {"x": 1, "y": 1})
    assert err["type"] == "error" and err["message"] == "внутренняя ошибка"
    err = run(g, "e2", "dice.roll", {"formula": "1d6"})
    assert err["type"] == "error" and err["message"] == "внутренняя ошибка"
    g.send_text(json.dumps({"type": "cmd", "id": "e3", "name": "chat.say", "payload": {"text": "после ошибки"}}))
    assert recv_until(g, lambda m: m.get("type") == "chat")["message"]["text"] == "после ошибки"


def test_as_num_helpers():
    for bad in (float("inf"), float("nan"), "nan", "1e400", True, None, "abc", [1]):
        with pytest.raises(handlers.CommandError):
            handlers._as_num(bad, "x")
    assert handlers._as_num("12.5", "x") == 12.5
    assert handlers._int({"v": 7.9}, "v", 0, 5) == 5


# --- ограничение попыток входа ----------------------------------------------


def test_login_rate_limit(client, player):
    for _ in range(main.LOGIN_MAX_FAILURES):
        assert client.post("/api/login", json={"name": "Игрок", "password": "wrong-pass"}).status_code == 401
    r = client.post("/api/login", json={"name": "Игрок", "password": "playerpass1"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    # Другое имя с того же адреса - пока можно (лимит по адресу мягче).
    assert client.post("/api/login", json={"name": "Кто-то", "password": "wrong-pass"}).status_code == 401
    main.login_limiter.reset("testclient|игрок")
    # Успешный вход сбрасывает счётчик неудач.
    assert client.post("/api/login", json={"name": "Игрок", "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/login", json={"name": "Игрок", "password": "playerpass1"}).status_code == 200
    client.cookies.clear()
    assert main.login_limiter.retry_after("testclient|игрок") is None


def test_gm_key_rate_limit(client, gm):
    for _ in range(main.LOGIN_MAX_FAILURES):
        assert client.post("/api/gm/login", json={"key": "nope"}).status_code == 403
    r = client.post("/api/gm/login", json={"key": GM_KEY})
    assert r.status_code == 429 and "retry-after" in r.headers
    main.login_limiter.reset("testclient|ключ ГМ")
    main.ip_limiter.reset("testclient")
    main.name_limiter.reset("ключ ГМ")


def test_forwarded_for_only_when_trusted(monkeypatch):
    def req(host, xff=None):
        return SimpleNamespace(client=SimpleNamespace(host=host), headers={"x-forwarded-for": xff} if xff else {})

    monkeypatch.setattr(main, "TRUST_PROXY", False)
    assert main.client_ip(req("127.0.0.1", "1.2.3.4")) == "127.0.0.1"
    monkeypatch.setattr(main, "TRUST_PROXY", True)
    # Последний адрес дописал прокси; левее - что прислал клиент.
    assert main.client_ip(req("127.0.0.1", "6.6.6.6, 1.2.3.4")) == "1.2.3.4"
    # Не с этой машины - заголовку не верим даже при включённой настройке.
    assert main.client_ip(req("10.0.0.5", "1.2.3.4")) == "10.0.0.5"


# --- переимпорт LSS ----------------------------------------------------------


def test_reimport_keeps_player_text(sockets):
    g, _ = sockets
    source = (Path(__file__).parent / "fixtures" / "lss_sample.json").read_text(encoding="utf-8")
    g.send_text(json.dumps({"type": "cmd", "id": "i1", "name": "character.import", "payload": {"source": source}}))
    reply = recv_until(g, lambda m: m.get("cmd_id") == "i1")
    char = reply["payload"]["character"]
    assert reply["payload"]["report"]["done"], "отчёт импорта - в ответе"
    try:
        g.send_text(json.dumps({"type": "cmd", "id": "i2", "name": "character.update", "payload": {
            "id": char["id"], "set": {"about.story": "своя история", "skills.athletics.bonus": 13},
        }}))
        recv_until(g, lambda m: m.get("type") == "character")
        g.send_text(json.dumps({"type": "cmd", "id": "i3", "name": "character.reimport", "payload": {"id": char["id"]}}))
        data = recv_until(g, lambda m: m.get("type") == "character")["character"]["data"]
        assert data["about"]["story"] == "своя история"
        assert data["skills"]["athletics"]["bonus"] == 13
        assert any(c["id"] == "lss-allies" for c in data["lore"])  # в образце из личных текстов заполнены союзники
    finally:
        g.send_text(json.dumps({"type": "cmd", "id": "i4", "name": "character.delete", "payload": {"id": char["id"]}}))
        recv_until(g, lambda m: m.get("type") == "character_deleted")


# --- операции листа: список и счётчик ----------------------------------------


def test_spell_list_and_slot_commands(sockets, player):
    g, p = sockets

    def say(ws, cid, name, payload, until="character"):
        ws.send_text(json.dumps({"type": "cmd", "id": cid, "name": name, "payload": payload}))
        return recv_until(ws, lambda m: m.get("type") == until or (m.get("type") == "error" and m.get("cmd_id") == cid))

    p.send_text(json.dumps({"type": "cmd", "id": "s1", "name": "character.create", "payload": {"name": "Маг"}}))
    char = recv_until(p, lambda m: m.get("cmd_id") == "s1")["payload"]["character"]
    recv_until(p, lambda m: m.get("type") == "character")  # рассылка нового листа владельцу
    try:
        say(p, "s2", "character.update", {"id": char["id"], "set": {"slots.1.total": 2}})
        data = say(p, "s3", "character.list", {"id": char["id"], "path": "spells", "op": "add",
                                               "item": {"name": "Заклинание А", "level": 1}})["character"]["data"]
        spell_id = data["spells"][0]["id"]
        data = say(p, "s4", "character.list", {"id": char["id"], "path": "spells", "op": "update",
                                               "item_id": spell_id, "changes": {"prepared": True}})["character"]["data"]
        assert data["spells"][0]["prepared"] is True
        data = say(p, "s5", "character.counter", {"id": char["id"], "path": "slots.1.left", "delta": -1,
                                                  "max_path": "slots.1.total"})["character"]["data"]
        assert data["slots"]["1"]["left"] == 1
        # Чужой лист игроку - "нет такого персонажа", в том числе для новых команд.
        g.send_text(json.dumps({"type": "cmd", "id": "s6", "name": "character.create", "payload": {"name": "Чужой"}}))
        other = recv_until(g, lambda m: m.get("cmd_id") == "s6")["payload"]["character"]
        recv_until(g, lambda m: m.get("type") == "character" and m["character"]["id"] == other["id"])
        err = say(p, "s7", "character.counter", {"id": other["id"], "path": "x", "delta": -1}, until="__none__")
        assert err["type"] == "error"
        err = say(p, "s8", "character.list", {"id": other["id"], "path": "spells", "op": "add", "item": {"name": "x"}}, until="__none__")
        assert err["type"] == "error"
        g.send_text(json.dumps({"type": "cmd", "id": "s9", "name": "character.delete", "payload": {"id": other["id"]}}))
        recv_until(g, lambda m: m.get("type") == "character_deleted")
    finally:
        p.send_text(json.dumps({"type": "cmd", "id": "s10", "name": "character.delete", "payload": {"id": char["id"]}}))
        recv_until(p, lambda m: m.get("type") == "character_deleted")


# --- вход через Porthole: все с 127.0.0.1 ---------------------------------------


def _invite(client, gm, scene_id) -> str:
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
        ws.receive_json()
        ws.send_text(json.dumps({"type": "cmd", "id": "inv", "name": "invite.create", "payload": {}}))
        token = recv_until(ws, lambda m: m.get("type") == "reply")["payload"]["token"]
        recv_until(ws, lambda m: m.get("type") == "campaign")  # см. фикстуру player
    return token


def test_porthole_players_share_loopback_but_not_lockout(client, gm, scene_id):
    """Десять игроков приходят с 127.0.0.1 (так их видит сервер мастера через
    Porthole). Один шесть раз ошибается паролем - блокируется только он."""
    names = [f"Портхол {i}" for i in range(10)]
    for name in names:
        token = _invite(client, gm, scene_id)
        r = client.post("/api/invite/accept", json={"token": token, "name": name, "password": "pass-" + name})
        assert r.status_code == 200, r.text
        client.cookies.clear()
    loop = TestClient(app, client=("127.0.0.1", 40000))
    try:
        unlucky = names[0]
        for attempt in range(6):
            r = loop.post("/api/login", json={"name": unlucky, "password": "неверный"})
            assert r.status_code == (429 if attempt == 5 else 401), (attempt, r.status_code)
            # Остальные входят между его попытками - с того же адреса.
            other = names[1 + attempt % 9]
            ok = loop.post("/api/login", json={"name": other, "password": "pass-" + other})
            assert ok.status_code == 200, (other, ok.text)
            loop.cookies.clear()
        for other in names[1:]:
            assert loop.post("/api/login", json={"name": other, "password": "pass-" + other}).status_code == 200
            loop.cookies.clear()
        # Даже с верным паролем ошибавшийся ждёт - счётчик "имя+адрес".
        assert loop.post("/api/login", json={"name": unlucky, "password": "pass-" + unlucky}).status_code == 429
    finally:
        for key in [f"127.0.0.1|{n.casefold()}" for n in names]:
            main.login_limiter.reset(key)
        for n in names:
            main.name_limiter.reset(n.casefold())


def test_name_limit_across_addresses(client):
    """30 неудач за час по одному имени с разных адресов - вход по имени закрыт."""
    who = "кто-то-без-аккаунта"
    try:
        for i in range(main.LOGIN_MAX_FAILURES_PER_NAME):
            main.name_limiter.fail(who)
        r = client.post("/api/login", json={"name": who, "password": "x"})
        assert r.status_code == 429
    finally:
        main.name_limiter.reset(who)
        client.cookies.clear()


def test_gm_key_is_the_only_way_to_gm(client, player):
    """Через Porthole игрок - 127.0.0.1, как и мастер. Адрес прав не даёт:
    без ключа - не мастер, и X-Forwarded-For по умолчанию не учитывается."""
    loop = TestClient(app, client=("127.0.0.1", 40001))
    me = loop.get("/api/me", headers=player["headers"]).json()
    assert me["is_gm"] is False
    assert loop.post("/api/gm/login", json={"key": ""}).status_code == 403
    assert loop.post("/api/gm/login", json={"key": "127.0.0.1"}).status_code == 403
    assert loop.get("/api/me").json() is None  # без сессии - никто
    req = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={"x-forwarded-for": "8.8.8.8"})
    assert main.client_ip(req) == "127.0.0.1"
    main.login_limiter.reset("127.0.0.1|ключ ГМ")
    main.name_limiter.reset("ключ ГМ")


def test_origin_loopback_any_port():
    def ws(origin, host):
        return SimpleNamespace(headers={"origin": origin, "host": host})

    # Porthole: страница игрока на своём порту, сервер мастера на 8000.
    assert main.origin_allowed(ws("http://127.0.0.1:54321", "127.0.0.1:54321"))
    assert main.origin_allowed(ws("http://127.0.0.1:54321", "127.0.0.1:8000"))
    assert main.origin_allowed(ws("http://localhost:3000", "127.0.0.1:8000"))
    assert main.origin_allowed(ws("http://[::1]:9000", "[::1]:8000"))
    # Чужой сайт - нет, в том числе к loopback-серверу.
    assert not main.origin_allowed(ws("https://evil.example", "127.0.0.1:8000"))
    assert not main.origin_allowed(ws("http://127.0.0.1.evil.example", "127.0.0.1:8000"))
    assert not main.origin_allowed(ws("http://127.0.0.1:5000", "192.168.1.5:8000"))


# --- пинг ----------------------------------------------------------------------


def test_ping_rate_limit_unit():
    scene = SimpleNamespace(width=1000, height=800)
    actor = SimpleNamespace(id="u-ping-test", name="Тест")
    first = handlers.ping(scene, actor, {"x": 5000, "y": -3}, now=100.0)
    assert first["x"] == 1000 and first["y"] == 0 and first["author"] == "Тест" and first["color"].startswith("#")
    assert handlers.ping(scene, actor, {"x": 1, "y": 1}, now=100.5) is None  # чаще 700 мс - мимо
    assert handlers.ping(scene, actor, {"x": 1, "y": 1}, now=100.8) is not None
    with pytest.raises(handlers.CommandError):
        handlers.ping(scene, actor, {"x": float("inf"), "y": 1}, now=200.0)


def test_ping_broadcast_without_seq(client, gm, sockets, scene_id):
    g, p = sockets
    seq_before = client.get(f"/api/scenes/{scene_id}", headers=gm).json()["seq"]
    handlers._last_ping.clear()
    g.send_text(json.dumps({"type": "cmd", "id": "pg1", "name": "ping", "payload": {"x": 100, "y": 120}}))
    g.send_text(json.dumps({"type": "cmd", "id": "pg2", "name": "ping", "payload": {"x": 300, "y": 320}}))
    g.send_text(json.dumps({"type": "cmd", "id": "pg3", "name": "chat.say", "payload": {"text": "после пингов"}}))
    got = []
    while True:
        m = p.receive_json()
        if m.get("type") == "chat":
            break
        if m.get("type") == "ping":
            got.append(m)
    assert len(got) == 1 and (got[0]["x"], got[0]["y"]) == (100, 120) and got[0]["author"] == "Мастер"
    assert client.get(f"/api/scenes/{scene_id}", headers=gm).json()["seq"] == seq_before  # состояние не менялось


# --- ручной туман ----------------------------------------------------------------


def _ev(ws, cid, name, payload):
    """Команда и ответ на неё (событие или ошибка с тем же cmd_id)."""
    return run(ws, cid, name, payload)


def _next_event(ws):
    return recv_until(ws, lambda m: m.get("type") == "event")


def test_fog_hides_tokens_and_walls_from_player(client, gm, player, sockets, scene_id):
    g, p = sockets
    run(g, "f0", "fog.clear", {})
    _next_event(p)
    tok = run(g, "f1", "token.add", {"x": 1505, "y": 1505, "name": "засада-в-тумане"})["payload"]["token"]
    _next_event(p)  # игрок пока видит токен (тумана нет)
    wall = run(g, "f2", "wall.add", {"x1": 1410, "y1": 1410, "x2": 1590, "y2": 1410})["payload"]["wall"]
    _next_event(p)
    try:
        # Мастер закрывает комнату: игроку - туман и "исчезли" токен и стена.
        ev = run(g, "f3", "fog.cover", {"x": 1400, "y": 1400, "w": 200, "h": 200})
        assert ev["name"] == "fog.updated" and "remove_tokens" not in ev["payload"]  # мастеру - без списков
        ev_p = _next_event(p)
        assert ev_p["name"] == "fog.updated"
        assert ev_p["payload"]["remove_tokens"] == [tok["id"]]
        assert ev_p["payload"]["remove_walls"] == [wall["id"]]
        assert len(ev_p["payload"]["fog"]) == 1
        # Ни в снапшоте, ни в одном байте - имени токена нет.
        snap = client.get(f"/api/scenes/{scene_id}", headers=player["headers"]).json()
        assert tok["id"] not in [t["id"] for t in snap["tokens"]]
        assert wall["id"] not in [w["id"] for w in snap["walls"]]
        assert "засада-в-тумане" not in json.dumps(snap, ensure_ascii=False)
        assert snap["fog"] and snap["fog"][0]["w"] == 200
        # Что происходит в тумане - пустые события с тем же seq.
        run(g, "f4", "token.move", {"id": tok["id"], "x": 1545, "y": 1505})
        assert _next_event(p)["name"] == "noop"
        # Мастер открывает - игрок получает недостающее целиком.
        run(g, "f5", "fog.reveal", {"x": 1300, "y": 1300, "w": 400, "h": 400})
        ev_p = _next_event(p)
        assert [t["id"] for t in ev_p["payload"]["add_tokens"]] == [tok["id"]]
        assert ev_p["payload"]["add_tokens"][0]["x"] == 1545  # где он теперь
        assert [w["id"] for w in ev_p["payload"]["add_walls"]] == [wall["id"]]
        assert ev_p["payload"]["fog"] == []
    finally:
        run(g, "f6", "token.remove", {"id": tok["id"]})
        run(g, "f7", "wall.remove", {"id": wall["id"]})
        run(g, "f8", "fog.clear", {})


def test_token_walks_into_and_out_of_fog(sockets):
    g, p = sockets
    run(g, "w0", "fog.clear", {})
    _next_event(p)
    run(g, "w1", "fog.cover", {"x": 2000, "y": 0, "w": 500, "h": 500})
    _next_event(p)
    tok = run(g, "w2", "token.add", {"x": 1905, "y": 105, "name": "разведчик"})["payload"]["token"]
    _next_event(p)
    try:
        run(g, "w3", "token.move", {"id": tok["id"], "x": 2105, "y": 105})  # в туман
        ev = _next_event(p)
        assert ev["name"] == "token.removed" and ev["payload"] == {"id": tok["id"]}
        run(g, "w4", "token.move", {"id": tok["id"], "x": 1905, "y": 105})  # обратно
        ev = _next_event(p)
        assert ev["name"] == "token.added" and ev["payload"]["token"]["name"] == "разведчик"
    finally:
        run(g, "w5", "token.remove", {"id": tok["id"]})
        run(g, "w6", "fog.clear", {})


def test_own_token_visible_in_fog(client, player, sockets, scene_id):
    g, p = sockets
    run(g, "o0", "fog.clear", {})
    mine = run(p, "o1", "token.add", {"x": 2705, "y": 105})["payload"]["token"]
    try:
        run(g, "o2", "fog.cover_all", {})
        snap = client.get(f"/api/scenes/{scene_id}", headers=player["headers"]).json()
        assert mine["id"] in [t["id"] for t in snap["tokens"]]  # свой персонаж не пропадает
    finally:
        run(p, "o3", "token.remove", {"id": mine["id"]})
        run(g, "o4", "fog.clear", {})


def test_fog_validation_and_rights(sockets, monkeypatch):
    g, p = sockets
    assert run(p, "v1", "fog.cover", {"x": 0, "y": 0, "w": 10, "h": 10})["type"] == "error"
    assert run(p, "v2", "fog.clear", {})["type"] == "error"
    for bad in ({"x": 0, "y": 0, "w": 0, "h": 10}, {"x": 0, "y": 0, "w": -5, "h": 10},
                {"x": float("inf"), "y": 0, "w": 10, "h": 10}, {"x": 0, "y": 0, "w": float("nan"), "h": 1}):
        assert run(g, "v3", "fog.cover", bad)["type"] == "error", bad
    run(g, "v4", "fog.clear", {})
    monkeypatch.setattr(handlers.fog, "MAX_RECTS", 2)
    run(g, "v5", "fog.cover", {"x": 0, "y": 0, "w": 10, "h": 10})
    run(g, "v6", "fog.cover", {"x": 20, "y": 0, "w": 10, "h": 10})
    err = run(g, "v7", "fog.cover", {"x": 40, "y": 0, "w": 10, "h": 10})
    assert err["type"] == "error" and "много" in err["message"]
    monkeypatch.undo()
    run(g, "v8", "fog.clear", {})


def test_fog_undo_only_own(client, gm, sockets, scene_id):
    g, p = sockets
    run(g, "u0", "fog.clear", {})
    run(g, "u1", "fog.cover", {"x": 0, "y": 0, "w": 100, "h": 100})
    run(g, "u2", "fog.cover", {"x": 200, "y": 0, "w": 100, "h": 100})
    assert len(client.get(f"/api/scenes/{scene_id}", headers=gm).json()["fog"]) == 2
    assert run(g, "u3", "fog.undo", {})["payload"]["fog"][0]["x"] == 0  # снят последний
    assert len(client.get(f"/api/scenes/{scene_id}", headers=gm).json()["fog"]) == 1
    assert run(p, "u4", "fog.undo", {})["type"] == "error"  # игрок - нельзя
    # Чужое последнее действие: подменяем историю, будто менял другой мастер.
    handlers._fog_history[scene_id].append(("другой-мастер", []))
    err = run(g, "u5", "fog.undo", {})
    assert err["type"] == "error" and "другой мастер" in err["message"]
    handlers._fog_history[scene_id].clear()
    run(g, "u6", "fog.clear", {})


def test_portrait_and_delete_refresh_tokens(client, gm, sockets, scene_id):
    g, p = sockets
    from app.config import UPLOAD_DIR
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / ("a" * 32 + ".png")).write_bytes(b"test")
    (UPLOAD_DIR / ("b" * 32 + ".png")).write_bytes(b"test")
    g.send_text(json.dumps({"id": "portrait-sheet", "name": "character.create", "payload": {"name": "Portrait", "system": "mob"}}))
    char = recv_until(g, lambda m: m.get("cmd_id") == "portrait-sheet")["payload"]["character"]
    tok = run(g, "portrait-token", "token.add", {"x": 175, "y": 175, "character_id": char["id"]})["payload"]["token"]
    g.send_text(json.dumps({"name": "character.update", "payload": {"id": char["id"], "set": {"portrait": "/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"}}}))
    recv_until(g, lambda m: m.get("type") == "character")
    recv_until(p, lambda m: m.get("type") == "tokens_refresh")
    snap = {"scene": client.get(f"/api/scenes/{scene_id}", headers=gm).json()}
    linked = next(t for t in snap["scene"]["tokens"] if t["id"] == tok["id"])
    assert linked["image_url"] is None
    assert linked["portrait_url"] == "/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"
    run(g, "portrait-own", "token.update", {"id": tok["id"], "image_url": "/uploads/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png"})
    g.send_text(json.dumps({"name": "character.delete", "payload": {"id": char["id"]}}))
    recv_until(g, lambda m: m.get("type") == "character_deleted")
    recv_until(p, lambda m: m.get("type") == "tokens_refresh")
    snap = {"scene": client.get(f"/api/scenes/{scene_id}", headers=gm).json()}
    token = next(t for t in snap["scene"]["tokens"] if t["id"] == tok["id"])
    assert token["portrait_url"] is None and token["hp"] is None
    assert token["image_url"] == "/uploads/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png"
    run(g, "portrait-cleanup", "token.remove", {"id": tok["id"]})


def test_concurrent_scene_events_and_reconnect_snapshot(client, gm, player, sockets, scene_id):
    """Two commands are in flight before either sender consumes its ack."""
    g, p = sockets
    run(g, "con-clear", "fog.clear", {})
    recv_until(p, lambda m: m.get("cmd_id") == "con-clear")
    baseline = client.get(f"/api/scenes/{scene_id}", headers=gm).json()["seq"]
    for ws, cid, x in [(g, "con-g", 3505), (p, "con-p", 3645)]:
        ws.send_text(json.dumps({"id": cid, "name": "token.add", "payload": {"x": x, "y": 705}}))
    g.send_text(json.dumps({"id": "con-fog", "name": "fog.cover", "payload": {"x": 3400, "y": 600, "w": 500, "h": 300}}))
    streams = []
    for ws in (g, p):
        events = [recv_until(ws, is_event) for _ in range(3)]
        assert [m["seq"] for m in events] == list(range(baseline + 1, baseline + 4))
        assert {m["cmd_id"] for m in events} == {"con-g", "con-p", "con-fog"}
        streams.append(events)
    ids = [m["payload"]["token"]["id"] for m in streams[0] if m["name"] == "token.added"]
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=player["headers"]) as reconnected:
        snap = reconnected.receive_json()
        assert snap["type"] == "snapshot" and snap["seq"] == baseline + 3
        assert snap["scene"]["fog"]
        # Own token remains visible, GM's token is hidden even on reconnect.
        visible = {t["id"] for t in snap["scene"]["tokens"]}
        gm_token = next(m["payload"]["token"]["id"] for m in streams[0] if m["cmd_id"] == "con-g")
        player_token = next(m["payload"]["token"]["id"] for m in streams[0] if m["cmd_id"] == "con-p")
        assert gm_token not in visible and player_token in visible
        run(g, "con-reveal", "fog.clear", {})
        reveal = recv_until(reconnected, lambda m: m.get("cmd_id") == "con-reveal")
        assert reveal["seq"] == baseline + 4
        assert gm_token in [t["id"] for t in reveal["payload"]["add_tokens"]]
    for i, tid in enumerate(ids):
        run(g, f"con-clean-{i}", "token.remove", {"id": tid})


def test_activate_scene_delivers_campaign_then_filtered_snapshot(client, gm, player, sockets, scene_id):
    g, p = sockets
    new_id = run(g, "switch-create", "scene.create", {"name": "switch-regression"})["payload"]["id"]
    with client.websocket_connect(f"/ws/scene/{new_id}", headers=gm) as new_gm:
        assert new_gm.receive_json()["type"] == "snapshot"
        tok = run(new_gm, "switch-token", "token.add", {"x": 105, "y": 105})["payload"]["token"]
        fog = run(new_gm, "switch-fog", "fog.cover", {"x": 0, "y": 0, "w": 300, "h": 300})
        run(g, "switch-activate", "scene.activate", {"id": new_id})
        campaign = recv_until(p, lambda m: m.get("type") == "campaign" and m["active_scene_id"] == new_id)
        assert campaign["active_scene_id"] == new_id
        with client.websocket_connect(f"/ws/scene/{new_id}", headers=player["headers"]) as new_p:
            snap = new_p.receive_json()
            assert snap["scene"]["id"] == new_id and snap["seq"] == fog["seq"]
            assert snap["scene"]["fog"] == fog["payload"]["fog"]
            assert tok["id"] not in [t["id"] for t in snap["scene"]["tokens"]]
            run(new_gm, "switch-reveal", "fog.clear", {})
            event = recv_until(new_p, lambda m: m.get("cmd_id") == "switch-reveal")
            assert event["seq"] == snap["seq"] + 1
            assert event["payload"]["add_tokens"][0]["id"] == tok["id"]
        run(g, "switch-return", "scene.activate", {"id": scene_id})
    run(g, "switch-delete", "scene.delete", {"id": new_id})


def test_gm_places_player_character_and_owner_can_move(client, gm, player, sockets, scene_id):
    g, p = sockets
    p.send_text(json.dumps({"id": "place-sheet", "name": "character.create", "payload": {"name": "Owner's hero"}}))
    char = recv_until(p, lambda m: m.get("cmd_id") == "place-sheet")["payload"]["character"]
    recv_until(g, lambda m: m.get("type") == "character" and m["character"]["id"] == char["id"])
    tok = run(g, "place-token", "token.add", {"x": 2805, "y": 105, "character_id": char["id"]})["payload"]["token"]
    delivered = recv_until(p, lambda m: m.get("cmd_id") == "place-token")["payload"]["token"]
    assert delivered["character_id"] == char["id"] and delivered["owner_id"] == player["id"]
    moved = run(p, "place-move", "token.move", {"id": tok["id"], "x": 2875, "y": 105})
    assert moved["name"] == "token.moved"
    assert recv_until(g, lambda m: m.get("cmd_id") == "place-move")["payload"]["x"] == 2875
    p.send_text(json.dumps({"name": "character.delete", "payload": {"id": char["id"]}}))
    recv_until(g, lambda m: m.get("type") == "character_deleted" and m["id"] == char["id"])
    recv_until(p, lambda m: m.get("type") == "tokens_refresh")
    # A second client actually reconnects: validate the WS snapshot, not REST/DB.
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=player["headers"]) as again:
        snap = again.receive_json()
        detached = next(t for t in snap["scene"]["tokens"] if t["id"] == tok["id"])
        assert detached["character_id"] is None and detached["hp"] is None
    run(g, "place-clean", "token.remove", {"id": tok["id"]})


def test_idle_websocket_receives_heartbeat_without_advancing_seq(client, gm, scene_id):
    """Real server heartbeat, not a fabricated client fixture."""
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
        snapshot = ws.receive_json()
        heartbeat = recv_until(ws, lambda m: m.get("type") == "heartbeat")
        assert heartbeat == {"type": "heartbeat"}
        event = run(ws, "after-idle", "token.add", {"x": 385, "y": 735})
        assert event["seq"] == snapshot["seq"] + 1
        run(ws, "idle-cleanup", "token.remove", {"id": event["payload"]["token"]["id"]})


@pytest.mark.parametrize("system", ["dnd5e", "mob"])
def test_fog_reappearance_preserves_portraits_and_visibility(client, gm, player, sockets, scene_id, system):
    """Actual recipient packets: snapshots and all visibility transitions agree."""
    from uuid import uuid4
    from app.config import UPLOAD_DIR
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    urls = []
    for _ in range(3):
        name = uuid4().hex + ".png"
        (UPLOAD_DIR / name).write_bytes(b"fixture")
        urls.append("/uploads/" + name)
    portrait, override, secret_image = urls
    g, p = sockets
    run(g, "img-clear", "fog.clear", {})
    recv_until(p, lambda m: m.get("cmd_id") == "img-clear")
    g.send_text(json.dumps({"id": "img-char", "name": "character.create", "payload": {"system": system, "name": "Fog image"}}))
    char = recv_until(g, lambda m: m.get("cmd_id") == "img-char")["payload"]["character"]
    g.send_text(json.dumps({"name": "character.update", "payload": {"id": char["id"], "set": {"portrait": portrait, "hp.max": 12}}}))
    recv_until(g, lambda m: m.get("type") == "character" and m["character"]["data"].get("portrait") == portrait)
    recv_until(p, lambda m: m.get("type") == "tokens_refresh")
    tokens = []
    for i, data in enumerate([{"character_id": char["id"]}, {"character_id": char["id"], "image_url": override}, {"image_url": override}]):
        cid = f"img-add-{i}"
        token = run(g, cid, "token.add", {"x": 3005 + 70*i, "y": 1005, **data})["payload"]["token"]
        got = recv_until(p, lambda m: m.get("cmd_id") == cid)["payload"]["token"]
        assert got["image_url"] == data.get("image_url")
        assert got["portrait_url"] == (portrait if "character_id" in data else None)
        tokens.append(token)
    secret = run(g, "img-secret", "token.add", {"x": 3285, "y": 1005, "layer": "gm", "image_url": secret_image})["payload"]["token"]
    assert recv_until(p, lambda m: m.get("type") == "event")["name"] == "noop"
    region = {"x": 2900, "y": 900, "w": 600, "h": 400}
    try:
        for cycle in range(3):
            cid = f"img-cover-{cycle}"
            run(g, cid, "fog.cover", region)
            covered = recv_until(p, lambda m: m.get("cmd_id") == cid)
            assert set(covered["payload"]["remove_tokens"]) == {t["id"] for t in tokens}
            assert covered["payload"]["add_tokens"] == []
            assert all(url not in json.dumps(covered) for url in urls)
            with client.websocket_connect(f"/ws/scene/{scene_id}", headers=player["headers"]) as reconnect:
                hidden_snapshot = reconnect.receive_json()
                assert not {t["id"] for t in tokens + [secret]} & {t["id"] for t in hidden_snapshot["scene"]["tokens"]}
                assert all(url not in json.dumps(hidden_snapshot) for url in urls)
            cid = f"img-reveal-{cycle}"
            run(g, cid, "fog.reveal", region)
            revealed = recv_until(p, lambda m: m.get("cmd_id") == cid)
            added = {t["id"]: t for t in revealed["payload"]["add_tokens"]}
            assert set(added) == {t["id"] for t in tokens}
            for i, token in enumerate(tokens):
                assert added[token["id"]].get("portrait_url") == (portrait if i < 2 else None)
                assert added[token["id"]]["image_url"] == (override if i else None)
                assert added[token["id"]]["hp"] is None
            assert secret_image not in json.dumps(revealed)
            # Compare exactly the token representation used after switching/reconnecting scenes.
            with client.websocket_connect(f"/ws/scene/{scene_id}", headers=player["headers"]) as reconnect:
                snapshot = reconnect.receive_json()["scene"]
                for t in snapshot["tokens"]:
                    if t["id"] in added:
                        assert t == added[t["id"]]
        run(g, "img-move-cover", "fog.cover", region)
        recv_until(p, lambda m: m.get("cmd_id") == "img-move-cover")
        run(g, "img-move-out", "token.move", {"id": tokens[0]["id"], "x": 2805, "y": 1005})
        moved = recv_until(p, lambda m: m.get("cmd_id") == "img-move-out")
        assert moved["name"] == "token.added" and moved["payload"]["token"].get("portrait_url") == portrait
        run(g, "img-layer-hide", "token.update", {"id": tokens[0]["id"], "layer": "gm"})
        recv_until(p, lambda m: m.get("cmd_id") == "img-layer-hide")
        run(g, "img-layer-show", "token.update", {"id": tokens[0]["id"], "layer": "tokens"})
        shown = recv_until(p, lambda m: m.get("cmd_id") == "img-layer-show")
        assert shown["name"] == "token.added" and shown["payload"]["token"].get("portrait_url") == portrait
    finally:
        for i, t in enumerate(tokens + [secret]):
            run(g, f"img-clean-{i}", "token.remove", {"id": t["id"]})
        run(g, "img-clean-fog", "fog.clear", {})
        g.send_text(json.dumps({"name": "character.delete", "payload": {"id": char["id"]}}))
        recv_until(g, lambda m: m.get("type") == "character_deleted" and m["id"] == char["id"])
        recv_until(p, lambda m: m.get("type") == "tokens_refresh")


def test_scene_folders_real_clients_preserve_state_and_secrets(client, gm, player, sockets, scene_id):
    g, p = sockets
    def apply(cid, command, payload):
        reply = run(g, cid, command, payload)
        assert reply["type"] == "reply", reply
        view = recv_until(g, lambda m: m.get("type") == "campaign")
        restricted = recv_until(p, lambda m: m.get("type") == "campaign")
        assert "folders" not in restricted and "scenes" not in restricted
        return reply, view
    before = client.get(f"/api/scenes/{scene_id}", headers=gm).json()
    folder, view = apply("folder-new", "folder.create", {"name": "Secret dungeon"})
    fid = folder["payload"]["id"]
    second, _ = apply("folder-second", "folder.create", {"name": "Town"})
    other = second["payload"]["id"]
    created, _ = apply("folder-scene", "scene.create", {"name": "Secret chamber", "folder_id": fid})
    sid = created["payload"]["id"]
    from io import BytesIO
    from PIL import Image
    png = BytesIO()
    Image.new("RGB", (32, 32), "#c59144").save(png, "PNG")
    image_url = client.post("/api/uploads", headers=gm, content=png.getvalue()).json()["url"]
    with client.websocket_connect(f"/ws/scene/{sid}", headers=gm) as private:
        private.receive_json()
        run(private, "seed-background", "scene.update", {"background_url": image_url})
        recv_until(g, lambda m: m.get("type") == "campaign")
        recv_until(p, lambda m: m.get("type") == "campaign")
        token = run(private, "seed-token", "token.add", {"x": 105, "y": 105, "image_url": image_url})["payload"]["token"]
        run(private, "seed-wall", "wall.add", {"x1": 210, "y1": 140, "x2": 280, "y2": 140})
        run(private, "seed-combat", "combat.add", {"token_id": token["id"]})
        run(private, "seed-fog", "fog.cover", {"x": 70, "y": 70, "w": 140, "h": 140})
    content = client.get(f"/api/scenes/{sid}", headers=gm).json()
    assert content["tokens"] and content["walls"] and content["fog"] and content["combat"] and content["background_url"]
    try:
        _, view = apply("folder-rename", "folder.rename", {"id": fid, "name": "Dungeon renamed"})
        assert {"id": fid, "name": "Dungeon renamed"} in view["folders"]
        _, view = apply("folder-move", "scene.move", {"id": scene_id, "folder_id": fid, "before_id": sid})
        assert [s["id"] for s in view["scenes"] if s["folder_id"] == fid] == [scene_id, sid]
        assert client.get(f"/api/scenes/{scene_id}", headers=gm).json() == before
        _, view = apply("folder-other", "scene.move", {"id": sid, "folder_id": other})
        assert next(s for s in view["scenes"] if s["id"] == sid)["folder_id"] == other
        _, view = apply("folder-root", "scene.move", {"id": sid, "folder_id": None})
        assert next(s for s in view["scenes"] if s["id"] == sid)["folder_id"] is None
        # A fresh process reads the persisted hierarchy (not the app's session/cache).
        import subprocess, sys
        script = """import json,sys
from fastapi.testclient import TestClient
from app.main import app
with TestClient(app) as client:
 response=client.get('/api/campaign',headers=json.loads(sys.argv[1]))
 assert response.status_code==200,response.text
 print('PERSISTED:'+json.dumps(response.json()))
"""
        result = subprocess.run([sys.executable, "-c", script, json.dumps(gm)], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=20)
        assert result.returncode == 0, result.stderr
        persisted = json.loads(result.stdout.rsplit("PERSISTED:", 1)[1])
        assert persisted["scenes"] == view["scenes"]
        assert {"id": fid, "name": "Dungeon renamed"} in persisted["folders"]
        assert client.get(f"/api/scenes/{sid}", headers=gm).json() == content
        apply("folder-return", "scene.move", {"id": sid, "folder_id": fid})
        _, view = apply("folder-delete", "folder.delete", {"id": fid})
        assert all(f["id"] != fid for f in view["folders"])
        assert next(s for s in view["scenes"] if s["id"] == scene_id)["folder_id"] is None
        assert client.get(f"/api/scenes/{scene_id}", headers=gm).json() == before
        assert client.get(f"/api/scenes/{sid}", headers=gm).json() == content
        assert next(scene for scene in view["scenes"] if scene["id"] == sid)["folder_id"] is None
        assert client.get(f"/api/scenes/{sid}", headers=player["headers"]).status_code == 404
        for command, payload in [("folder.create", {"name": "forbidden"}), ("folder.rename", {"id": other, "name": "hack"}), ("folder.delete", {"id": other}), ("scene.move", {"id": scene_id, "folder_id": other})]:
            assert run(p, command, command, payload)["type"] == "error"
        assert run(g, "bad-folder", "scene.move", {"id": scene_id, "folder_id": "missing"})["type"] == "error"
        assert run(g, "bad-order", "scene.move", {"id": scene_id, "folder_id": None, "before_id": "missing"})["type"] == "error"
    finally:
        apply("folder-clean-scene", "scene.delete", {"id": sid})
        apply("folder-clean", "folder.delete", {"id": other})


def test_scene_preview_is_small_cached_gm_only_and_background_change_published(client, gm, player, sockets, scene_id):
    from io import BytesIO
    from PIL import Image
    from app.previews import PREVIEW_DIR
    g, p = sockets
    source = BytesIO()
    Image.new("RGB", (2400, 1600), "#c89140").save(source, "PNG")
    uploaded = client.post("/api/uploads", headers=gm, content=source.getvalue())
    assert uploaded.status_code == 200
    url = uploaded.json()["url"]
    old = client.get(f"/api/scenes/{scene_id}", headers=gm).json()["background_url"]
    try:
        run(g, "preview-bg", "scene.update", {"background_url": url})
        view = recv_until(g, lambda m: m.get("type") == "campaign")
        assert "scenes" not in recv_until(p, lambda m: m.get("type") == "campaign")
        preview = next(s for s in view["scenes"] if s["id"] == scene_id)["preview_url"]
        assert client.get(preview).status_code == 401
        assert client.get(preview, headers=player["headers"]).status_code == 403
        result = client.get(preview, headers=gm)
        assert result.status_code == 200 and result.headers["content-type"] == "image/webp"
        assert result.headers["cache-control"] == "private, no-store"
        image = Image.open(BytesIO(result.content))
        assert image.width <= 480 and image.height <= 300
        assert len(result.content) < len(source.getvalue())
        cached = PREVIEW_DIR / (url.split("/")[-1].split(".")[0] + ".webp")
        stamp = cached.stat().st_mtime_ns
        assert client.get(preview, headers=gm).content == result.content
        assert cached.stat().st_mtime_ns == stamp
        outside = client.get("/uploads-previews/" + cached.name, headers=player["headers"])
        # Unknown paths may return the SPA shell, but never the cached image.
        assert outside.content != result.content and "image/" not in outside.headers.get("content-type", "")
    finally:
        run(g, "preview-reset", "scene.update", {"background_url": old})
        view = recv_until(g, lambda m: m.get("type") == "campaign")
        if old is None:
            assert next(s for s in view["scenes"] if s["id"] == scene_id)["preview_url"] is None
        recv_until(p, lambda m: m.get("type") == "campaign")


@pytest.mark.parametrize("sides", [4, 6, 8, 10, 12, 20, 100])
def test_dice_menu_results_two_clients_and_history(client, gm, player, sockets, scene_id, monkeypatch, sides):
    from app import dice
    monkeypatch.setattr(dice.secrets, "randbelow", lambda n: n - 1)
    g, p = sockets
    seq = client.get(f"/api/scenes/{scene_id}", headers=gm).json()["seq"]
    formula = f"2d{sides}-3"
    g.send_text(json.dumps({"id": "dice-menu", "name": "dice.roll", "payload": {"formula": formula, "total": -999, "rolls": [0]}}))
    a = recv_until(g, lambda m: m.get("type") == "chat")["message"]
    b = recv_until(p, lambda m: m.get("type") == "chat")["message"]
    assert a == b and a["roll"]["total"] == 2 * sides - 3
    assert a["roll"]["terms"][0]["rolls"] == [sides, sides]
    assert a["roll"]["terms"][0]["kept"] == [sides, sides]
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=player["headers"]) as again:
        snap = again.receive_json()
        assert snap["seq"] == seq
        assert_message_history(next(m for m in snap["scene"]["messages"] if m["id"] == a["id"]), a)
    p.send_text(json.dumps({"id": "dice-player", "name": "dice.roll", "payload": {"formula": f"1d{sides}+5"}}))
    own = recv_until(p, lambda m: m.get("type") == "chat")["message"]
    assert own == recv_until(g, lambda m: m.get("type") == "chat")["message"]
    assert own["roll"]["total"] == sides + 5


def test_dice_menu_limits_and_secret_packets(client, gm, player, sockets, scene_id):
    g, p = sockets
    assert run(p, "dice-hidden-denied", "dice.roll", {"formula": "d20", "hidden": True})["type"] == "error"
    assert run(g, "dice-limit", "dice.roll", {"formula": "101d6"})["type"] == "error"
    g.send_text(json.dumps({"name": "dice.roll", "payload": {"formula": "100d4-5", "hidden": True, "label": "Secret dice menu"}}))
    actual = recv_until(g, lambda m: m.get("type") == "chat")["message"]
    filtered = recv_until(p, lambda m: m.get("type") == "chat")["message"]
    assert len(actual["roll"]["terms"][0]["rolls"]) == 100
    assert filtered["id"] == actual["id"] and filtered["roll"] is None and filtered["kind"] == "hidden_roll"
    assert "100d4" not in json.dumps(filtered) and "Secret dice menu" not in json.dumps(filtered)
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=player["headers"]) as again:
        snap = again.receive_json()
        assert_message_history(next(m for m in snap["scene"]["messages"] if m["id"] == actual["id"]), filtered)


def assert_message_history(history, live):
    from datetime import datetime, timezone
    assert {k: v for k, v in history.items() if k != "created_at"} == {k: v for k, v in live.items() if k != "created_at"}
    # SQLite drops the UTC suffix on DateTime reads; the instant must agree.
    assert datetime.fromisoformat(history["created_at"]).replace(tzinfo=timezone.utc) == datetime.fromisoformat(live["created_at"]).replace(tzinfo=timezone.utc)


def test_group_deletion_keeps_server_permissions_and_actual_recipient_events(client, gm, player, sockets, scene_id):
    g, p = sockets
    ids = []
    for i in range(2):
        t = run(p, f"group-own-{i}", "token.add", {"x": 2205 + i * 70, "y": 1505})["payload"]["token"]
        recv_until(g, lambda m: m.get("cmd_id") == f"group-own-{i}")
        ids.append(t["id"])
    foreign = run(g, "group-foreign", "token.add", {"x": 2415, "y": 1505})["payload"]["token"]
    recv_until(p, lambda m: m.get("cmd_id") == "group-foreign")
    shared = run(g, "group-shared", "token.add", {"x": 2485, "y": 1505, "owner_id": None})["payload"]["token"]
    recv_until(p, lambda m: m.get("cmd_id") == "group-shared")
    hidden = run(g, "group-secret", "token.add", {"x": 2555, "y": 1505, "layer": "gm"})["payload"]["token"]
    assert recv_until(p, lambda m: m.get("type") == "event")["name"] == "noop"
    try:
        before = client.get(f"/api/scenes/{scene_id}", headers=gm).json()["seq"]
        assert run(p, "group-denied", "token.remove", {"id": foreign["id"]})["type"] == "error"
        assert client.get(f"/api/scenes/{scene_id}", headers=gm).json()["seq"] == before
        for i, token_id in enumerate(ids + [shared["id"]]):
            cid = f"group-remove-{i}"
            actual = run(p, cid, "token.remove", {"id": token_id})
            other = recv_until(g, lambda m: m.get("cmd_id") == cid)
            assert actual == other
            assert actual["name"] == "token.removed" and actual["payload"] == {"id": token_id}
            assert actual["seq"] == before + i + 1
        snap = client.get(f"/api/scenes/{scene_id}", headers=player["headers"]).json()
        remaining = {t["id"] for t in snap["tokens"]}
        assert foreign["id"] in remaining and hidden["id"] not in remaining
        assert not remaining.intersection(ids + [shared["id"]])
    finally:
        run(g, "group-clean-foreign", "token.remove", {"id": foreign["id"]})
        run(g, "group-clean-secret", "token.remove", {"id": hidden["id"]})


def shared_link(g):
    reply = run(g, 'shared-link', 'invite.shared', {})
    assert reply['type'] == 'reply'
    view = recv_until(g, lambda m: m.get('type') == 'campaign')
    link = next(i for i in view['invites'] if i.get('reusable'))
    return link


def test_shared_link_multiple_users_existing_login_pause_rotation_and_privacy(client, gm, player, sockets, scene_id):
    from uuid import uuid4
    g, p = sockets
    link = shared_link(g)
    hidden = recv_until(p, lambda m: m.get('type') == 'campaign')
    assert 'invites' not in hidden and link['token'] not in json.dumps(hidden)
    users = []
    try:
        for _ in range(3):
            name = 'Shared-' + uuid4().hex[:8]
            result = client.post('/api/invite/accept', json={'token':link['token'], 'name':name, 'password':'sharedpass123','is_gm':True,'campaign_id':'fake'})
            assert result.status_code == 200, result.text
            assert not result.json()['is_gm']
            users.append(result.json())
            client.cookies.clear()
        assert client.post('/api/invite/info',json={'token':link['token']}).json()['kind'] == 'shared'
        current = client.get('/api/campaign',headers=gm)
        assert current.headers['cache-control'] == 'no-store'
        assert next(i for i in current.json()['invites'] if i.get('reusable'))['token'] == link['token']
        count = len(current.json()['users'])
        login = client.post('/api/invite/accept',json={'token':link['token'],'name':users[0]['name'],'password':'sharedpass123','mode':'login'})
        assert login.status_code == 200 and login.json()['id'] == users[0]['id']
        again = client.post('/api/invite/accept',json={'token':link['token'],'mode':'continue'})
        assert again.status_code == 200 and again.json()['id'] == users[0]['id']
        client.cookies.clear()
        assert len(client.get('/api/campaign',headers=gm).json()['users']) == count
        assert client.post('/api/invite/accept',json={'token':link['token'],'name':users[0]['name'],'password':'wrongpass123','mode':'login'}).status_code == 401
        assert client.post('/api/invite/accept',json={'token':link['token'],'name':'missing-'+uuid4().hex,'password':'sharedpass123','mode':'login'}).status_code == 401
        assert client.post('/api/invite/accept',headers=gm,json={'token':link['token'],'mode':'continue'}).status_code == 401
        run(g,'pause-shared','invite.pause',{'id':link['id'],'enabled':False})
        assert client.post('/api/invite/accept',json={'token':link['token'],'name':'Paused-'+uuid4().hex,'password':'sharedpass123'}).status_code == 403
        assert client.post('/api/invite/accept',json={'token':link['token'],'name':users[0]['name'],'password':'sharedpass123'}).status_code == 200
        client.cookies.clear()
        run(g,'rotate-shared','invite.shared',{'rotate':True})
        view = recv_until(g,lambda m:m.get('type')=='campaign' and any(i.get('reusable') and i['id']!=link['id'] for i in m['invites']))
        new = next(i for i in view['invites'] if i.get('reusable'))
        assert new['token'] != link['token'] and len([i for i in view['invites'] if i.get('reusable')]) == 1
        assert client.post('/api/invite/accept',json={'token':link['token'],'name':'Revoked-'+uuid4().hex,'password':'sharedpass123'}).status_code == 404
        run(g,'revoke-shared','invite.revoke',{'id':new['id']})
        assert client.post('/api/invite/info',json={'token':new['token']}).status_code == 404
        assert client.post('/api/login',json={'name':users[0]['name'],'password':'sharedpass123'}).status_code == 200
        client.cookies.clear()
        assert run(p,'shared-forbidden','invite.shared',{})['type']=='error'
    finally:
        for u in users: run(g,'shared-clean-'+u['id'],'player.delete',{'id':u['id']})


def test_shared_link_registration_limits_and_wrong_campaign(client, gm, sockets, monkeypatch):
    from app.ratelimit import LoginLimiter
    from uuid import uuid4
    g,_ = sockets
    link = shared_link(g)
    monkeypatch.setattr(main,'registration_ip_limiter',LoginLimiter(1,600))
    async def foreign_invitation():
        from app.models import Campaign, Invite
        from datetime import datetime, timedelta, timezone
        async with main.SessionLocal() as db:
            other=Campaign(name='Other protected campaign');db.add(other);await db.flush()
            token='foreign-'+uuid4().hex
            invite=Invite(token_hash=auth._digest(token),campaign_id=other.id,user_id=None,reusable=True,token_value=token,expires_at=datetime.now(timezone.utc)+timedelta(days=1))
            db.add(invite);await db.commit();return token
    foreign=client.portal.call(foreign_invitation)
    assert client.post('/api/invite/accept',json={'token':foreign,'name':'foreign-user','password':'limitedpass1'}).status_code==404
    name='Limit-'+uuid4().hex
    result=client.post('/api/invite/accept',json={'token':link['token'],'name':name,'password':'limitedpass1'})
    assert result.status_code==200
    user=result.json();client.cookies.clear()
    try:
        rejected=client.post('/api/invite/accept',json={'token':link['token'],'name':name+'x','password':'limitedpass1'})
        assert rejected.status_code==429 and int(rejected.headers['retry-after'])>0
        assert client.post('/api/invite/accept',json={'token':link['token'],'name':name,'password':'limitedpass1','mode':'login'}).status_code==200
        client.cookies.clear()
    finally:
        run(g,'limit-revoke','invite.revoke',{'id':link['id']})
        run(g,'limit-clean','player.delete',{'id':user['id']})


def test_npc_equipment_persists_uses_character_lists_and_never_reaches_players(client, gm, player, sockets, scene_id):
    g,p=sockets
    c=run(g,'npc-gear-create','character.create',{'name':'Hidden NPC equipment','system':'mob'})['payload']['character']
    recv_until(g,lambda m:m.get('type')=='character' and m['character']['id']==c['id'])
    # The same character.list / JSON equipment model as PC cards.
    g.send_text(json.dumps({'name':'character.list','payload':{'id':c['id'],'path':'equipment','op':'add','item':{'name':'Secret sword','qty':2,'doc':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'Secret properties'}]}]}}}}))
    saved=recv_until(g,lambda m:m.get('type')=='character' and m['character']['data'].get('equipment'))['character']
    item=saved['data']['equipment'][0]
    assert item['name']=='Secret sword' and item['qty']==2
    g.send_text(json.dumps({'name':'character.list','payload':{'id':c['id'],'path':'equipment','op':'update','item_id':item['id'],'changes':{'name':'Secret axe','qty':3}}}))
    changed=recv_until(g,lambda m:m.get('type')=='character' and m['character']['data'].get('equipment',[{}])[0].get('name')=='Secret axe')['character']
    assert changed['data']['equipment'][0]['qty']==3
    assert client.get('/api/characters',headers=gm).json()[-1]['data']['equipment']==changed['data']['equipment']
    assert all(x['id']!=c['id'] for x in client.get('/api/characters',headers=player['headers']).json())
    assert run(p,'npc-gear-forbidden','character.update',{'id':c['id'],'set':{'equipment':[]}})['type']=='error'
    with client.websocket_connect(f'/ws/scene/{scene_id}',headers=gm) as again:
        again.receive_json()
        # API reload reads persisted JSON; no local-only item state.
        assert any(x['id']==c['id'] and x['data']['equipment'][0]['name']=='Secret axe' for x in client.get('/api/characters',headers=gm).json())
    g.send_text(json.dumps({'name':'character.list','payload':{'id':c['id'],'path':'equipment','op':'remove','item_id':item['id']}}))
    assert recv_until(g,lambda m:m.get('type')=='character' and m['character']['id']==c['id'])['character']['data']['equipment']==[]
    g.send_text(json.dumps({'name':'character.delete','payload':{'id':c['id']}}));recv_until(g,lambda m:m.get('type')=='character_deleted')


def test_scene_rename_without_switch_updates_only_permitted_metadata(client, gm, player, sockets, scene_id):
    g,p=sockets
    created=run(g,'rename-private-create','scene.create',{'name':'Private rename old'})['payload']['id']
    recv_until(g,lambda m:m.get('type')=='campaign');recv_until(p,lambda m:m.get('type')=='campaign')
    before=client.get(f'/api/scenes/{created}',headers=gm).json()
    assert run(g,'rename-private','scene.rename',{'id':created,'name':'Secret renamed room'})['type']=='reply'
    view=recv_until(g,lambda m:m.get('type')=='campaign');safe=recv_until(p,lambda m:m.get('type')=='campaign')
    assert next(s for s in view['scenes'] if s['id']==created)['name']=='Secret renamed room'
    assert 'Secret renamed room' not in json.dumps(safe) and created not in json.dumps(safe)
    after=client.get(f'/api/scenes/{created}',headers=gm).json();assert after.pop('name')=='Secret renamed room';before.pop('name');assert before==after
    assert run(p,'rename-denied','scene.rename',{'id':scene_id,'name':'hack'})['type']=='error'
    run(g,'rename-clean','scene.delete',{'id':created})


def messages_until(ws,predicate):
    frames=[]
    for _ in range(80):
        msg=ws.receive_json();frames.append(msg)
        if predicate(msg):return frames
    raise AssertionError('barrier was not delivered')


def test_drag_preview_actual_clients_intermediate_confirm_cancel_reject_and_disconnect(client, gm, player, sockets, scene_id, monkeypatch):
    from uuid import uuid4
    g,p=sockets;now=[1000.0];monkeypatch.setattr(main.previews,'clock',lambda:now[0])
    tok=run(p,'preview-token','token.add',{'x':2005,'y':1605})['payload']['token'];recv_until(g,lambda m:m.get('cmd_id')=='preview-token')
    before=client.get(f'/api/scenes/{scene_id}',headers=gm).json();base=before['seq']
    drag=str(uuid4())
    def preview(ws,step,x,drag_id=drag,seq=None):
        now[0]+=.11
        ws.send_text(json.dumps({'id':'preview-'+str(step),'name':'token.preview','payload':{'id':tok['id'],'drag_id':drag_id,'step':step,'base_seq':base if seq is None else seq,'x':x,'y':1605}}))
    try:
        for step,x in [(1,2040),(2,2080),(3,2115)]:
            preview(p,step,x);m=recv_until(g,lambda m:m.get('type')=='token_preview' and not m['end'])
            assert m['x']==x and m['origin_x']==2005 and m['base_seq']==base
            assert 'image_url' not in m and 'portrait_url' not in m
        assert client.get(f'/api/scenes/{scene_id}',headers=gm).json()==before
        p.send_text(json.dumps({'name':'token.preview.end','payload':{'drag_id':drag}}))
        assert recv_until(g,lambda m:m.get('type')=='token_preview')['end']
        preview(p,99,2200)
        p.send_text(json.dumps({'name':'chat.say','payload':{'text':'preview-cancel-barrier'}}))
        frames=messages_until(g,lambda m:m.get('type')=='chat' and m['message']['text']=='preview-cancel-barrier')
        assert not any(m.get('type')=='token_preview' and not m['end'] for m in frames)
        drag2=str(uuid4());preview(p,1,2115,drag2)
        recv_until(g,lambda m:m.get('type')=='token_preview' and not m['end'])
        event=run(p,'preview-confirm','token.move',{'id':tok['id'],'x':2115,'y':1605})
        assert event['seq']==base+1
        frames=messages_until(g,lambda m:m.get('cmd_id')=='preview-confirm')
        assert any(m.get('type')=='token_preview' and m['end'] for m in frames)
        assert frames[-1]==event
        preview(p,99,2500,drag2,base+1)
        p.send_text(json.dumps({'name':'chat.say','payload':{'text':'preview-late-barrier'}}))
        assert not any(m.get('type')=='token_preview' and not m['end'] for m in messages_until(g,lambda m:m.get('type')=='chat' and m['message']['text']=='preview-late-barrier'))
        wall=run(g,'preview-wall','wall.add',{'x1':2185,'y1':1570,'x2':2185,'y2':1640})['payload']['wall'];recv_until(p,lambda m:m.get('cmd_id')=='preview-wall')
        seq=client.get(f'/api/scenes/{scene_id}',headers=gm).json()['seq'];drag3=str(uuid4());preview(p,1,2255,drag3,seq)
        recv_until(g,lambda m:m.get('type')=='token_preview' and not m['end'])
        assert run(p,'preview-reject','token.move',{'id':tok['id'],'x':2255,'y':1605})['type']=='error'
        assert recv_until(g,lambda m:m.get('type')=='token_preview')['end']
        assert next(t for t in client.get(f'/api/scenes/{scene_id}',headers=gm).json()['tokens'] if t['id']==tok['id'])['x']==2115
        run(g,'preview-wall-clean','wall.remove',{'id':wall['id']});recv_until(p,lambda m:m.get('cmd_id')=='preview-wall-clean')
        seq=client.get(f'/api/scenes/{scene_id}',headers=gm).json()['seq']
        with client.websocket_connect(f'/ws/scene/{scene_id}',headers=player['headers']) as other:
            snap=other.receive_json();assert 'previews' not in snap and 'token_preview' not in json.dumps(snap)
            preview(other,1,2200,str(uuid4()),seq);recv_until(g,lambda m:m.get('type')=='token_preview' and not m['end'])
        assert recv_until(g,lambda m:m.get('type')=='token_preview')['end']
        assert client.get(f'/api/scenes/{scene_id}',headers=gm).json()['seq']==seq
    finally:
        run(g,'preview-clean','token.remove',{'id':tok['id']})


def test_shared_invite_request_budget_limits_invalid_token_scanning(client, monkeypatch):
    from app.ratelimit import LoginLimiter
    monkeypatch.setattr(main,'invite_request_limiter',LoginLimiter(1,60))
    assert client.post('/api/invite/info',json={'token':'invalid-first'}).status_code==404
    limited=client.post('/api/invite/info',json={'token':'invalid-next'})
    assert limited.status_code==429 and int(limited.headers['retry-after'])>0


def test_drag_preview_real_recipient_privacy_hidden_layer_and_fog(client, gm, player, sockets, scene_id, monkeypatch):
    from uuid import uuid4
    g,p=sockets;now=[2000.0];monkeypatch.setattr(main.previews,'clock',lambda:now[0])
    run(g,'privacy-clear','fog.clear',{});recv_until(p,lambda m:m.get('cmd_id')=='privacy-clear')
    secret=run(g,'privacy-token','token.add',{'x':2805,'y':2005,'layer':'gm'})['payload']['token']
    assert recv_until(p,lambda m:m.get('type')=='event')['name']=='noop'
    def preview_and_barrier(drag,x,step,marker):
        now[0]+=.11
        seq=client.get(f'/api/scenes/{scene_id}',headers=gm).json()['seq']
        g.send_text(json.dumps({'name':'token.preview','payload':{'id':secret['id'],'drag_id':drag,'step':step,'base_seq':seq,'x':x,'y':2005}}))
        g.send_text(json.dumps({'name':'chat.say','payload':{'text':marker}}))
        return messages_until(p,lambda m:m.get('type')=='chat' and m['message']['text']==marker)
    try:
        frames=preview_and_barrier(str(uuid4()),2875,1,'hidden-preview-barrier')
        assert secret['id'] not in json.dumps(frames)
        run(g,'privacy-show','token.update',{'id':secret['id'],'layer':'tokens'});recv_until(p,lambda m:m.get('cmd_id')=='privacy-show')
        drag=str(uuid4());frames=preview_and_barrier(drag,2875,1,'visible-preview-barrier')
        assert any(m.get('type')=='token_preview' and not m['end'] for m in frames)
        run(g,'privacy-cover','fog.cover',{'x':2840,'y':1960,'w':100,'h':100})
        frames=messages_until(p,lambda m:m.get('cmd_id')=='privacy-cover')
        assert any(m.get('type')=='token_preview' and m['end'] for m in frames)
        frames=preview_and_barrier(str(uuid4()),2875,1,'destination-fog-barrier')
        assert not any(m.get('type')=='token_preview' for m in frames)
        # Source visibility is checked as well, including a shared token hidden by fog.
        run(g,'privacy-source-cover','fog.cover',{'x':2760,'y':1960,'w':100,'h':100});recv_until(p,lambda m:m.get('cmd_id')=='privacy-source-cover')
        frames=preview_and_barrier(str(uuid4()),2705,1,'origin-fog-barrier')
        assert secret['id'] not in json.dumps(frames)
    finally:
        run(g,'privacy-clean','token.remove',{'id':secret['id']});run(g,'privacy-clear-final','fog.clear',{})
