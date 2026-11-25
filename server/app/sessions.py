"""Session tokens and persistence operations on a caller-provided session."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuthSession, User
from .roles import Actor

SESSION_COOKIE = "lanterna_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def assume_utc(moment: datetime) -> datetime:
    # SQLite отдаёт время без пояса, хотя писали UTC.
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def session_expired(created_at: datetime) -> bool:
    return datetime.now(timezone.utc) - assume_utc(created_at) > timedelta(seconds=SESSION_MAX_AGE)


def session_id(token: str) -> str:
    """Под каким ключом сессия лежит в базе (и в Actor.session)."""
    return token_digest(token)


async def create_session(db: AsyncSession, user: User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token_hash=token_digest(token), user_id=user.id))
    await db.flush()
    return token


async def session_user(db: AsyncSession, token: str | None) -> User | None:
    if not token:
        return None
    session = await db.get(AuthSession, token_digest(token))
    if session is None:
        return None
    # Срок cookie - это просьба к браузеру, а не гарантия: украденный токен
    # можно слать и дальше. Поэтому срок проверяет и сервер.
    if session_expired(session.created_at):
        await db.delete(session)
        await db.commit()
        return None
    return await db.get(User, session.user_id)


async def drop_session(db: AsyncSession, token: str | None) -> None:
    if token:
        session = await db.get(AuthSession, token_digest(token))
        if session:
            await db.delete(session)


def actor_of(user: User, token: str | None = None) -> Actor:
    return Actor(
        id=user.id, name=user.name, is_gm=user.is_gm, session=token_digest(token) if token else ""
    )
