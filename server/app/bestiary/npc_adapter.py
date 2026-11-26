"""Transform a validated SRD snapshot into the PB-21A editor's JSON draft."""

from collections.abc import Mapping, Sequence
from math import isfinite
from typing import Literal, TypedDict

from .catalog import HomebrewDraft, SourceManifest, Statblock

_SECTIONS = (
    ("traits", "traits"),
    ("actions", "actions"),
    ("bonus_actions", "bonusActions"),
    ("reactions", "reactions"),
    ("legendary_actions", "legendaryActions"),
)
_OPTIONAL_TEXT = (
    ("damage_vulnerabilities", "damageVulnerabilities"),
    ("damage_resistances", "damageResistances"),
    ("damage_immunities", "damageImmunities"),
    ("condition_immunities", "conditionImmunities"),
    ("legendary_intro", "legendaryIntro"),
    ("source_note", "sourceNote"),
)
_SAVING_THROWS = {"Str": "str", "Dex": "dex", "Con": "con", "Int": "int", "Wis": "wis", "Cha": "cha"}
_SPELLCASTING_ROLES = {"Spellcasting": "spellcasting", "Innate Spellcasting": "innateSpellcasting"}


class ImportMetadata(TypedDict):
    catalog_schema_version: Literal[1]


class NpcImport(TypedDict):
    draft: dict[str, object]
    import_metadata: ImportMetadata


def _map_sections(statblock: Statblock, card_ids: Mapping[str, Sequence[str]]) -> dict[str, list[dict[str, object]]]:
    populated = [(source, target) for source, target in _SECTIONS if getattr(statblock, source)]
    expected = {source for source, _ in populated}
    missing = expected - card_ids.keys()
    unexpected = card_ids.keys() - expected
    if missing or unexpected:
        raise ValueError(f"Invalid card ID sections. Missing: {sorted(missing)}. Unexpected: {sorted(unexpected)}.")

    sections = {}
    seen = set()
    for source, target in populated:
        abilities = getattr(statblock, source)
        ids = card_ids[source]
        if not isinstance(ids, Sequence) or isinstance(ids, (str, bytes)) or len(ids) != len(abilities):
            raise ValueError(f"Expected {len(abilities)} card IDs for {source}")
        cards = []
        for ability, card_id in zip(abilities, ids, strict=True):
            if not isinstance(card_id, str) or not card_id.strip():
                raise ValueError(f"Card ID in {source} must be a nonempty string")
            if card_id in seen:
                raise ValueError(f"Duplicate card ID: {card_id}")
            seen.add(card_id)
            card = {"id": card_id, "label": ability.label, "text": ability.text}
            if source == "traits" and ability.label in _SPELLCASTING_ROLES:
                card["role"] = _SPELLCASTING_ROLES[ability.label]
            if source == "actions" and ability.label.partition(" (")[0] == "Multiattack":
                card["role"] = "multiattack"
            recharge = ability.recharge
            if recharge is not None:
                card["usage"] = [{"kind": "recharge", "text": recharge}]
            cards.append(card)
        sections[target] = cards
    return sections


def _copy_legacy_value(value: object, ancestors: set[int]) -> object:
    """Copy JSON without silently coercing keys, containers or numbers."""
    if value is None or type(value) in (str, bool):
        return value
    if type(value) in (float, int):
        try:
            if isfinite(value) and float(value) == value:
                return value
        except OverflowError:
            pass
        raise ValueError("Legacy JSON number cannot be represented losslessly in NPC draft")
    if type(value) not in (dict, list):
        raise ValueError("Legacy data must be JSON")
    identity = id(value)
    if identity in ancestors:
        raise ValueError("Legacy JSON cannot contain cycles")
    ancestors.add(identity)
    try:
        if isinstance(value, list):
            return [_copy_legacy_value(item, ancestors) for item in value]
        if any(type(key) is not str for key in value):
            raise ValueError("Legacy JSON object keys must be strings")
        return {key: _copy_legacy_value(item, ancestors) for key, item in value.items()}
    finally:
        ancestors.remove(identity)


def adapt_srd_npc(
    snapshot: HomebrewDraft,
    manifest: SourceManifest,
    *,
    sheet_id: str,
    card_ids: Mapping[str, Sequence[str]],
    legacy_mob_data: dict[str, object] | None = None,
) -> NpcImport:
    """Build a detached draft. Card IDs are supplied in each populated source section's order."""
    if not isinstance(snapshot, HomebrewDraft) or not isinstance(manifest, SourceManifest):
        raise ValueError("Expected a validated SRD snapshot and manifest")
    origin = snapshot.origin
    if origin is None:
        raise ValueError("SRD import requires snapshot origin")
    if origin.source != manifest.id:
        raise ValueError("SRD source does not match manifest")
    if origin.document_sha256 != manifest.document_sha256:
        raise ValueError("SRD document SHA-256 does not match manifest")
    if not isinstance(sheet_id, str) or not sheet_id.strip() or sheet_id in (str(snapshot.id), origin.template_id):
        raise ValueError("Expected a nonempty sheet ID distinct from the snapshot and template IDs")
    if not isinstance(card_ids, Mapping) or any(not isinstance(section, str) for section in card_ids):
        raise ValueError("Card IDs must be mapped by source section")

    source = snapshot.statblock
    armor_class = {"value": source.armor_class}
    if source.armor_class_details is not None:
        armor_class["details"] = source.armor_class_details
    statblock = {
        "size": source.size,
        "creatureType": source.creature_type,
        "alignment": source.alignment,
        "armorClass": armor_class,
        "hp": {"max": source.hit_points, "hitDice": source.hit_dice},
        "movement": source.movement,
        "abilityScores": source.abilities.model_dump(),
        "savingThrows": [{"ability": _SAVING_THROWS[save.name], "bonus": save.bonus} for save in source.saving_throws],
        "skills": [skill.model_dump() for skill in source.skills],
        "senses": source.senses,
        "languages": source.languages,
        "challengeRating": source.challenge_rating,
        "xp": source.xp,
        "sections": _map_sections(source, card_ids),
    }
    for source_key, target_key in _OPTIONAL_TEXT:
        value = getattr(source, source_key)
        if value is not None:
            statblock[target_key] = value
    draft = {
        "sheetId": sheet_id,
        "name": source.name,
        "rulesEdition": manifest.rules_edition,
        "statblock": statblock,
        "provenance": {
            "kind": "srd51",
            "homebrewSnapshotId": str(snapshot.id),
            "templateId": origin.template_id,
            "sourceId": origin.source,
            "firstPage": origin.provenance.first_page,
            "lastPage": origin.provenance.last_page,
            "lastLine": origin.provenance.last_line,
            "documentSha256": origin.document_sha256,
            "documentUrl": manifest.document_url,
            "title": manifest.title,
            "language": manifest.language,
            "license": manifest.license,
            "licenseUrl": manifest.license_url,
            "attribution": manifest.attribution,
            "changes": manifest.changes,
        },
    }
    if legacy_mob_data is not None:
        if type(legacy_mob_data) is not dict:
            raise ValueError("Legacy data must be a JSON object")
        draft["legacyMobData"] = _copy_legacy_value(legacy_mob_data, set())
    return {"draft": draft, "import_metadata": {"catalog_schema_version": manifest.catalog_schema_version}}
