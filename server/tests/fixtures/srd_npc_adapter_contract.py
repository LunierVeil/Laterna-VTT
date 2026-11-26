"""Emit live adapter results for the TypeScript compiler contract test."""

import json
from uuid import UUID

from app.bestiary.catalog import load_catalog
from app.bestiary.npc_adapter import adapt_srd_npc


def main():
    catalog = load_catalog()
    results = []
    for index, template in enumerate(catalog.templates, start=1):
        snapshot = catalog.make_homebrew_draft(template.id, UUID(int=index))
        ids = {}
        for section in ("traits", "actions", "bonus_actions", "reactions", "legendary_actions"):
            cards = getattr(snapshot.statblock, section)
            if cards:
                ids[section] = [f"{section}-{number}" for number in range(len(cards))]
        results.append(adapt_srd_npc(
            snapshot,
            catalog.manifest,
            sheet_id=f"sheet-{index}",
            card_ids=ids,
            legacy_mob_data={"equipment": [{"extension": [None, 0, False, "текст"]}]},
        ))
    print(json.dumps(results, ensure_ascii=True, allow_nan=False))


if __name__ == "__main__":
    main()
