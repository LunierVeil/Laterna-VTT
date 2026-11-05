"""Synthetic Alpha scenes, NOT a LOS implementation or a visibility policy.

Pure generation is shared by pytest and the optional Chromium PB-00 probe.
The SQLite adapter refuses anything except an empty scene in our existing test
fixtures' temporary database. No application import, schema creation or upgrade.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
from uuid import NAMESPACE_URL, uuid5


def scenes() -> dict[str, dict]:
    def token(name, x, y, owner="gm", layer="tokens", emits_light=0):
        return dict(name=name, x=x, y=y, size=1, color="#c75c5c", image_url=None,
                    layer=layer, owner=owner, character_id=None, hp=None,
                    vision_range=420, emits_light=emits_light)

    def wall(x1=350, y1=0, x2=350, y2=350, kind="wall", state="closed", movement=True):
        return dict(x1=x1, y1=y1, x2=x2, y2=y2, kind=kind, door_state=state,
                    blocks_movement=movement, blocks_sight=kind != "window", blocks_sound=False)

    def scene(name, walls=(), tokens=None, fog=()):
        return dict(name=name, width=2100, height=1400, grid_size=70, grid_type="square",
                    background_url=None, combat=None, fog=list(fog), walls=list(walls),
                    tokens=tokens if tokens is not None else [token("PB00 player", 105, 105, "player"), token("PB00 other", 805, 105)])

    out = {"empty": scene("PB00 empty grid", tokens=[]),
           "straight": scene("PB00 straight wall", [wall()]),
           "corner": scene("PB00 corner", [wall(), wall(350, 350, 700, 350)]),
           "door-closed": scene("PB00 closed door", [wall(kind="door")]),
           "door-open": scene("PB00 open door", [wall(kind="door", state="open")]),
           "door-locked": scene("PB00 locked door", [wall(kind="door", state="locked")]),
           # Model-only: Alpha wall.add does not accept window. These are data,
           # not an approved optical interpretation for PB-01/PB-02.
           "window-opening": scene("PB00 model-only window and gap", [
               wall(kind="window"), wall(700, 0, 700, 140), wall(700, 280, 700, 350)]),
           "gm-layer": scene("PB00 GM layer", tokens=[token("PB00 player", 105, 105, "player"), token("PB00 GM secret", 805, 105, layer="gm")]),
           "manual-fog": scene("PB00 manual fog", walls=[wall(735, 35, 875, 35)],
                               tokens=[token("PB00 player", 805, 175, "player"), token("PB00 fog secret", 805, 105), token("PB00 GM secret", 105, 105, layer="gm")],
                               fog=[dict(id="pb00-fog", x=700, y=0, w=280, h=280)]),
           "complex": scene("PB00 30 tokens 200 walls 15 potential lights",
                            [wall(35+(i % 20)*98, 385+(i//20)*84, 84+(i % 20)*98, 427+(i//20)*84) for i in range(200)],
                            [token(f"PB00 token {i:02}", 105+(i % 15)*126, 105+(i//15)*126,
                                   "player" if i == 0 else "gm", emits_light=210 if i < 15 else 0) for i in range(30)])}
    return out


def seed_database(database: Path, scene_id: str, gm_id: str, player_id: str, scenario: str) -> dict:
    """Seed only an empty fixture scene, in one transaction, before clients load it."""
    database = database.resolve(strict=True)
    parent = database.parent
    if (database.name != "test.db" or parent.parent != Path(tempfile.gettempdir()).resolve()
            or not parent.name.startswith(("laterna-regression-", "laterna-tests-"))):
        raise ValueError("PB00 seed requires the existing fixture's temporary test.db")
    data = scenes()[scenario]
    ids = {"tokens": [], "walls": []}
    # sqlite3's transaction context does not itself close the connection.
    with closing(sqlite3.connect(f"file:{database}?mode=rw", uri=True)) as db, db:
        db.execute("PRAGMA foreign_keys=ON")
        row = db.execute("SELECT campaign_id, seq, fog_json FROM scenes WHERE id=?", (scene_id,)).fetchone()
        if not row or row[1] != 0 or row[2] not in (None, "[]"):
            raise ValueError("PB00 seed requires a new, empty scene")
        for table in ("tokens", "walls"):
            if db.execute(f"SELECT count(*) FROM {table} WHERE scene_id=?", (scene_id,)).fetchone()[0]:
                raise ValueError("PB00 seed never overwrites scene objects")
        for actor_id, is_gm in ((gm_id, 1), (player_id, 0)):
            if db.execute("SELECT campaign_id, is_gm FROM users WHERE id=?", (actor_id,)).fetchone() != (row[0], is_gm):
                raise ValueError("PB00 actors must belong to the fixture campaign")
        db.execute("UPDATE scenes SET name=?, width=?, height=?, grid_size=?, fog_json=? WHERE id=?",
                   (data["name"], data["width"], data["height"], data["grid_size"], json.dumps(data["fog"]), scene_id))
        for table in ("tokens", "walls"):
            for index, source in enumerate(data[table]):
                record = dict(source)
                record["id"] = str(uuid5(NAMESPACE_URL, f"pb00:{scene_id}:{table}:{index}"))
                record["scene_id"] = scene_id
                record["owner_id"] = {"gm": gm_id, "player": player_id}[record.pop("owner", "gm")]
                columns = list(record)
                db.execute(f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", list(record.values()))
                ids[table].append(record["id"])
    return {"scenario": scenario, "ids": ids, "data": data}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", choices=scenes())
    parser.add_argument("--database", type=Path)
    parser.add_argument("--scene")
    parser.add_argument("--gm")
    parser.add_argument("--player")
    args = parser.parse_args()
    if args.database:
        if not all((args.scenario, args.scene, args.gm, args.player)):
            parser.error("seeding needs scenario, scene, gm and player")
        result = seed_database(args.database, args.scene, args.gm, args.player, args.scenario)
    else:
        result = scenes()[args.scenario] if args.scenario else scenes()
    print(json.dumps(result, sort_keys=True, allow_nan=False))
