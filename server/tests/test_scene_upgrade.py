"""Upgrade an actual pre-folder database without dropping its scene data."""
import json
from sqlalchemy import create_engine, text
from app.db import Base, _check_columns
from app import models  # noqa: F401
from app.previews import preview_file


def test_existing_scene_upgrade_is_additive_and_repeatable(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    # Exact previous schema, generated with just the new columns omitted.
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE scenes (id VARCHAR(36) PRIMARY KEY, campaign_id VARCHAR(36), name VARCHAR(200), created_at DATETIME, width INTEGER, height INTEGER, grid_size INTEGER, grid_type VARCHAR(20), background_url VARCHAR(500), combat_json TEXT, fog_json TEXT, seq INTEGER)')
        conn.execute(text("INSERT INTO scenes VALUES (:id,'campaign','Legacy',CURRENT_TIMESTAMP,4000,3000,70,'square','/uploads/map.png',:combat,:fog,17)"), {"id": "legacy", "combat": json.dumps({"round": 3}), "fog": json.dumps([{"x": 5}])})
        before = dict(conn.execute(text("SELECT * FROM scenes")).mappings().one())
        Base.metadata.create_all(conn)
        _check_columns(conn)
        _check_columns(conn)
        after = dict(conn.execute(text("SELECT * FROM scenes")).mappings().one())
        assert after.pop("folder_id") is None and after.pop("sort_order") is None
        assert after == before
        assert "scene_folders" in Base.metadata.tables
    engine.dispose()


def test_preview_rejects_urls_traversal_corrupt_and_oversized_images(tmp_path, monkeypatch):
    from PIL import Image
    from app import previews
    monkeypatch.setattr(previews, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(previews, "PREVIEW_DIR", tmp_path / "private")
    for value in ["https://example.com/map.png", "/uploads/../secret.png", "/uploads/not-a-uuid.png"]:
        assert preview_file(value) is None
    name = "a" * 32 + ".png"
    (tmp_path / name).write_bytes(b"\x89PNG\r\n\x1a\ncorrupt")
    assert preview_file("/uploads/" + name) is None
    Image.new("RGB", (10, 10)).save(tmp_path / name)
    monkeypatch.setattr(previews, "MAX_PIXELS", 99)
    assert preview_file("/uploads/" + name) is None
    assert not (tmp_path / "private").exists()


def test_existing_one_use_invite_upgrade_preserves_hash_and_reset_semantics(tmp_path):
    engine=create_engine(f"sqlite:///{tmp_path / 'invites.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE invites (token_hash VARCHAR(64) PRIMARY KEY, campaign_id VARCHAR(36), user_id VARCHAR(36), created_at DATETIME, expires_at DATETIME)')
        conn.exec_driver_sql("INSERT INTO invites VALUES ('old-hash','old-campaign','old-player',CURRENT_TIMESTAMP,'2030-01-01')")
        before=dict(conn.execute(text('SELECT * FROM invites')).mappings().one())
        Base.metadata.create_all(conn);_check_columns(conn);_check_columns(conn)
        after=dict(conn.execute(text('SELECT * FROM invites')).mappings().one())
        for key in ('reusable','paused','token_value'):assert after.pop(key) is None
        assert after==before
    engine.dispose()
