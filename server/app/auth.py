"""Аккаунты и сессии.

Публичной регистрации нет. ГМ входит первый раз по ключу (roles.py) и
задаёт себе имя и пароль; игроков создаёт он же. Дальше все входят по
имени и паролю, сессия живёт в httpOnly cookie.
"""

from __future__ import annotations

import asyncio
import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuthSession, Campaign, User
from .roles import Actor

SESSION_COOKIE = "lanterna_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30
MIN_PASSWORD = 8

_hasher = PasswordHasher()

# Для несуществующего имени пароль всё равно проверяем - против этого
# хеша. Иначе по времени ответа было бы видно, есть ли такой игрок.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


class AuthError(Exception):
    pass


async def hash_password(password: str) -> str:
    # argon2 намеренно медленный. В потоке - чтобы вход одного игрока не
    # замораживал сокеты остальных.
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password_hash: str | None, password: str) -> bool:
    def check() -> bool:
        try:
            return _hasher.verify(password_hash or _DUMMY_HASH, password)
        except VerificationError:
            return False

    ok = await asyncio.to_thread(check)
    return ok and password_hash is not None


def clean_name(name: object) -> str:
    value = str(name or "").strip()
    if not value:
        raise AuthError("нужно имя")
    if len(value) > 100:
        raise AuthError("имя длиннее 100 символов")
    return value


def check_password(password: object) -> str:
    value = str(password or "")
    if len(value) < MIN_PASSWORD:
        raise AuthError(f"пароль - минимум {MIN_PASSWORD} символов")
    if len(value) > 200:
        raise AuthError("пароль длиннее 200 символов")
    return value


async def find_user(db: AsyncSession, campaign: Campaign, name: str) -> User | None:
    return (
        await db.execute(select(User).where(User.campaign_id == campaign.id, User.name == name))
    ).scalar_one_or_none()


async def create_user(
    db: AsyncSession, campaign: Campaign, name: object, password: object, *, is_gm: bool
) -> User:
    name = clean_name(name)
    password = check_password(password)
    if await find_user(db, campaign, name):
        raise AuthError("такое имя уже есть")
    user = User(
        campaign_id=campaign.id, name=name, password_hash=await hash_password(password), is_gm=is_gm
    )
    db.add(user)
    await db.flush()
    return user


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(db: AsyncSession, user: User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token_hash=_digest(token), user_id=user.id))
    await db.flush()
    return token


async def session_user(db: AsyncSession, token: str | None) -> User | None:
    if not token:
        return None
    session = await db.get(AuthSession, _digest(token))
    return await db.get(User, session.user_id) if session else None


async def drop_session(db: AsyncSession, token: str | None) -> None:
    if token:
        session = await db.get(AuthSession, _digest(token))
        if session:
            await db.delete(session)


def actor_of(user: User) -> Actor:
    return Actor(id=user.id, name=user.name, is_gm=user.is_gm)
