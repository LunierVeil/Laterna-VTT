"""Read queries for the current single-campaign application."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.expression import ScalarSelect

from .models import Campaign, User


async def find_user(db: AsyncSession, campaign: Campaign, name: str) -> User | None:
    return (
        await db.execute(select(User).where(User.campaign_id == campaign.id, User.name == name))
    ).scalar_one_or_none()


def experimental_primary_campaign_id() -> ScalarSelect[str]:
    """Choose the primary campaign independently of the outer recipient query."""
    return (
        select(Campaign.id)
        .order_by(Campaign.created_at, Campaign.id)
        .limit(1)
        .correlate(None)
        .scalar_subquery()
    )
