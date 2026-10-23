from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .config import DEFAULT_GRID_SIZE
from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), default="Новая кампания")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # Сцена, которую видят игроки. Остальные - заготовки ГМ, игрокам их
    # сервер не отдаёт вовсе. Без FK: сцена и кампания ссылались бы друг
    # на друга, а удаление активной сцены всё равно запрещено в хендлере.
    active_scene_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    scenes: Mapped[list["Scene"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )
    # Чат общий на кампанию: ГМ в заготовке видит, что пишут игроки, а
    # переключение сцены не стирает историю бросков.
    messages: Mapped[list["Message"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )


class Scene(Base):
    __tablename__ = "scenes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200), default="Новая сцена")
    # Для порядка в списке сцен: id случайные, по ним не отсортируешь.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    width: Mapped[int] = mapped_column(Integer, default=4000)
    height: Mapped[int] = mapped_column(Integer, default=3000)
    grid_size: Mapped[int] = mapped_column(Integer, default=DEFAULT_GRID_SIZE)
    grid_type: Mapped[str] = mapped_column(String(20), default="square")  # square | hex_v | hex_h
    background_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Монотонный счётчик событий сцены. Основа дедупликации на клиенте.
    seq: Mapped[int] = mapped_column(Integer, default=0)

    campaign: Mapped[Campaign] = relationship(back_populates="scenes")
    tokens: Mapped[list["Token"]] = relationship(
        back_populates="scene", cascade="all, delete-orphan"
    )
    walls: Mapped[list["Wall"]] = relationship(
        back_populates="scene", cascade="all, delete-orphan"
    )


class Token(Base):
    __tablename__ = "tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scene_id: Mapped[str] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(200), default="Токен")
    # Координаты - в пикселях сцены, не в клетках. См. ARCHITECTURE.md.
    x: Mapped[float] = mapped_column(Float, default=0.0)
    y: Mapped[float] = mapped_column(Float, default=0.0)
    # Размер в клетках: 1 = обычный, 2 = large и т.д.
    size: Mapped[float] = mapped_column(Float, default=1.0)

    color: Mapped[str] = mapped_column(String(20), default="#c75c5c")
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    layer: Mapped[str] = mapped_column(String(20), default="tokens")  # tokens | gm

    owner: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Пока не используется. Понадобится на этапе освещения.
    vision_range: Mapped[float] = mapped_column(Float, default=0.0)
    emits_light: Mapped[float] = mapped_column(Float, default=0.0)

    scene: Mapped[Scene] = relationship(back_populates="tokens")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "x": self.x,
            "y": self.y,
            "size": self.size,
            "color": self.color,
            "image_url": self.image_url,
            "layer": self.layer,
            "owner": self.owner,
            "vision_range": self.vision_range,
            "emits_light": self.emits_light,
        }


class Wall(Base):
    """Стена существует с первого дня, даже пока свет не реализован.

    Сейчас реально работает только blocks_movement. Остальные флаги
    лежат в БД и ждут этапа видимости - чтобы потом не переделывать
    схему, редактор и миграции.
    """

    __tablename__ = "walls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scene_id: Mapped[str] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True)

    x1: Mapped[float] = mapped_column(Float)
    y1: Mapped[float] = mapped_column(Float)
    x2: Mapped[float] = mapped_column(Float)
    y2: Mapped[float] = mapped_column(Float)

    kind: Mapped[str] = mapped_column(String(20), default="wall")
    # wall | door | secret_door | window | invisible
    door_state: Mapped[str] = mapped_column(String(20), default="closed")
    # closed | open | locked

    blocks_movement: Mapped[bool] = mapped_column(Boolean, default=True)
    blocks_sight: Mapped[bool] = mapped_column(Boolean, default=True)
    blocks_sound: Mapped[bool] = mapped_column(Boolean, default=False)

    # Кто поставил. Удалять можно только свою стену; без владельца - общая.
    owner: Mapped[str | None] = mapped_column(String(100), nullable=True)

    scene: Mapped[Scene] = relationship(back_populates="walls")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "x1": self.x1,
            "y1": self.y1,
            "x2": self.x2,
            "y2": self.y2,
            "kind": self.kind,
            "door_state": self.door_state,
            "blocks_movement": self.blocks_movement,
            "blocks_sight": self.blocks_sight,
            "blocks_sound": self.blocks_sound,
            "owner": self.owner,
        }


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )

    author: Mapped[str] = mapped_column(String(100))
    text: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(20), default="text")  # text | roll
    roll_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    campaign: Mapped[Campaign] = relationship(back_populates="messages")

    def to_dict(self) -> dict:
        import json

        return {
            "id": self.id,
            "author": self.author,
            "text": self.text,
            "kind": self.kind,
            "roll": json.loads(self.roll_json) if self.roll_json else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
