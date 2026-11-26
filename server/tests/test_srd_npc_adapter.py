from importlib import import_module, util
import re
from uuid import UUID

import pytest

from app.bestiary.catalog import Statblock, load_catalog


def test_frog_maps_zero_xp_and_keeps_source_note():
    catalog = load_catalog()
    snapshot = catalog.make_homebrew_draft("srd51:frog", UUID(int=1))
    expected = {
        "xp": 0,
        "note": snapshot.statblock.source_note,
        "trait_ids": ["swim-trait", "leap-trait"],
    }
    actual = {}
    if util.find_spec("app.bestiary.npc_adapter") is not None:
        from app.bestiary.npc_adapter import adapt_srd_npc

        result = adapt_srd_npc(
            snapshot, catalog.manifest, sheet_id="frog-sheet",
            card_ids={"traits": expected["trait_ids"]},
        )
        statblock = result["draft"]["statblock"]
        actual = {
            "xp": statblock["xp"],
            "note": statblock["sourceNote"],
            "trait_ids": [card["id"] for card in statblock["sections"]["traits"]],
        }
    assert actual == expected


def assignments(source):
    return {
        section: [f"{section}-{index}" for index in range(len(cards))]
        for section in ("traits", "actions", "bonus_actions", "reactions", "legendary_actions")
        if (cards := getattr(source, section))
    }


def snapshot_for(template_id="srd51:goblin"):
    return CATALOG.make_homebrew_draft(template_id, UUID(int=1))


CATALOG = load_catalog()


@pytest.fixture
def adapt():
    return import_module("app.bestiary.npc_adapter").adapt_srd_npc


@pytest.mark.parametrize("template", CATALOG.templates, ids=lambda template: template.id)
def test_catalog_mapping(template, adapt):
    snapshot = snapshot_for(template.id)
    source = snapshot.statblock
    manifest = CATALOG.manifest
    ids = assignments(source)
    result = adapt(snapshot, manifest, sheet_id="sheet", card_ids=ids)
    assert result["import_metadata"] == {"catalog_schema_version": CATALOG.schema_version}
    draft = result["draft"]
    assert set(draft) == {"sheetId", "name", "rulesEdition", "statblock", "provenance"}
    assert (draft["sheetId"], draft["name"], draft["rulesEdition"]) == ("sheet", template.statblock.name, "2014")
    assert draft["provenance"] == {
        "kind": "srd51", "homebrewSnapshotId": str(snapshot.id), "templateId": template.id,
        "sourceId": template.source, "firstPage": template.provenance.first_page,
        "lastPage": template.provenance.last_page, "lastLine": template.provenance.last_line,
        "documentSha256": manifest.document_sha256, "documentUrl": manifest.document_url,
        "title": manifest.title, "language": manifest.language, "license": manifest.license,
        "licenseUrl": manifest.license_url, "attribution": manifest.attribution, "changes": manifest.changes,
    }

    actual = draft["statblock"]
    required = {
        "creatureType": source.creature_type, "size": source.size, "alignment": source.alignment,
        "armorClass": {"value": source.armor_class},
        "hp": {"max": source.hit_points, "hitDice": source.hit_dice},
        "movement": source.movement, "abilityScores": source.abilities.model_dump(),
        "savingThrows": [{"ability": save.name.lower(), "bonus": save.bonus} for save in source.saving_throws],
        "skills": [{"name": skill.name, "bonus": skill.bonus} for skill in source.skills],
        "senses": source.senses, "languages": source.languages,
        "challengeRating": source.challenge_rating, "xp": source.xp,
    }
    if source.armor_class_details is not None:
        required["armorClass"]["details"] = source.armor_class_details
    for field, value in {
        "damageResistances": source.damage_resistances,
        "damageVulnerabilities": source.damage_vulnerabilities,
        "damageImmunities": source.damage_immunities,
        "conditionImmunities": source.condition_immunities,
        "legendaryIntro": source.legendary_intro,
        "sourceNote": source.source_note,
    }.items():
        if value is not None:
            required[field] = value
    assert {key: value for key, value in actual.items() if key != "sections"} == required

    section_pairs = [
        ("traits", source.traits), ("actions", source.actions), ("bonusActions", source.bonus_actions),
        ("reactions", source.reactions), ("legendaryActions", source.legendary_actions),
    ]
    assert list(actual["sections"]) == [name for name, entries in section_pairs if entries]
    expected_ids = [card_id for section_ids in ids.values() for card_id in section_ids]
    actual_ids = [card["id"] for cards in actual["sections"].values() for card in cards]
    assert actual_ids == expected_ids
    assert len(set(actual_ids)) == len(actual_ids)
    for section, abilities in section_pairs:
        cards = actual["sections"].get(section, [])
        assert [(card["label"], card["text"]) for card in cards] == [
            (ability.label, ability.text) for ability in abilities
        ]
        for card, ability in zip(cards, abilities, strict=True):
            role = {"Spellcasting": "spellcasting", "Innate Spellcasting": "innateSpellcasting"}.get(ability.label)
            if re.fullmatch(r"Multiattack(?: \([^)]+\))?", ability.label):
                role = "multiattack"
            recharge = re.search(r"\((Recharges? [^)]+)\)$", ability.label)
            assert card.get("role") == role
            assert card.get("usage") == ([{"kind": "recharge", "text": recharge[1]}] if recharge else None)
    assert adapt(snapshot, manifest, sheet_id="sheet", card_ids=ids) == result


def test_recharge_inventory_covers_overlapping_groups(adapt):
    expected = {
        "adult-black-dragon", "air-elemental", "ancient-red-dragon", "ankheg", "behir", "chimera",
        "cloaker", "ghost", "giant-spider", "gold-dragon-wyrmling", "knight", "water-elemental",
    }
    observed = set()
    for template in CATALOG.templates:
        snapshot = snapshot_for(template.id)
        draft = adapt(snapshot, CATALOG.manifest, sheet_id="sheet", card_ids=assignments(snapshot.statblock))["draft"]
        if any(card.get("usage") for cards in draft["statblock"]["sections"].values() for card in cards):
            observed.add(template.id.removeprefix("srd51:"))
    assert observed == expected


def test_zero_armor_class_and_modifier_and_explicit_bonus_section(adapt):
    snapshot = snapshot_for("srd51:frog")
    data = snapshot.statblock.model_dump()
    data["abilities"]["con"] = {"score": 10, "modifier": 0}
    data.update(armor_class=0, bonus_actions=({"label": "Synthetic bonus", "text": "Record a note."},))
    snapshot.statblock = Statblock.model_validate(data)
    statblock = adapt(snapshot, CATALOG.manifest, sheet_id="sheet", card_ids=assignments(snapshot.statblock))["draft"]["statblock"]
    assert statblock["armorClass"] == {"value": 0}
    assert statblock["abilityScores"]["con"]["modifier"] == 0
    assert statblock["xp"] == 0
    assert list(statblock["sections"]) == ["traits", "bonusActions"]
    assert statblock["sections"]["bonusActions"] == [
        {"id": "bonus_actions-0", "label": "Synthetic bonus", "text": "Record a note."},
    ]


def test_independent_drafts_preserve_legacy_json_and_catalog(adapt):
    first = snapshot_for()
    second = CATALOG.make_homebrew_draft("srd51:goblin", UUID(int=2))
    ids = assignments(first.statblock)
    legacy = {"equipment": [{"name": "Kit", "unknown": [None, False, 0, {}, ["текст"]]}]}
    original = CATALOG.model_dump(mode="json")
    one = adapt(first, CATALOG.manifest, sheet_id="first", card_ids=ids, legacy_mob_data=legacy)["draft"]
    two = adapt(second, CATALOG.manifest, sheet_id="second", card_ids=ids, legacy_mob_data=legacy)["draft"]
    one["statblock"]["sections"]["actions"][0]["text"] = "An edit"
    one["statblock"]["abilityScores"]["str"]["score"] = 42
    one["provenance"]["firstPage"] = 0
    one["legacyMobData"]["equipment"][0]["unknown"].append("changed")
    assert two["legacyMobData"] == legacy
    assert two["statblock"]["sections"]["actions"][0]["text"] == second.statblock.actions[0].text
    assert two["statblock"]["abilityScores"]["str"]["score"] == second.statblock.abilities.str.score
    assert two["provenance"]["firstPage"] == second.origin.provenance.first_page
    assert CATALOG.model_dump(mode="json") == original
    assert (one["sheetId"], two["sheetId"]) == ("first", "second")
    assert one["provenance"]["homebrewSnapshotId"] != two["provenance"]["homebrewSnapshotId"]


@pytest.mark.parametrize(
    ("change", "match"),
    [
        ({"origin": None}, "requires snapshot origin"),
        ({"source": "other-source"}, "source does not match"),
        ({"document_sha256": "0" * 64}, "SHA-256 does not match"),
    ],
)
def test_rejects_incompatible_origin(change, match, adapt):
    snapshot = snapshot_for()
    # Simulate inconsistent metadata arriving at the seam. Invalid source
    # literals cannot be created by the strict catalog validator.
    if "origin" in change:
        snapshot = snapshot.model_copy(update=change)
    else:
        snapshot = snapshot.model_copy(update={"origin": snapshot.origin.model_copy(update=change)})
    with pytest.raises(ValueError, match=match):
        adapt(snapshot, CATALOG.manifest, sheet_id="sheet", card_ids=assignments(snapshot.statblock))


@pytest.mark.parametrize(
    ("ids", "match"),
    [
        ({}, "Missing:"),
        ({"traits": ["t"], "actions": ["a"]}, "Expected 2 card IDs"),
        ({"traits": ["t"], "actions": ["a", "b", "c"]}, "Expected 2 card IDs"),
        ({"traits": ["t"], "actions": ["a", "b"], "reactions": []}, "Unexpected:"),
        ({"traits": ["t"], "actions": ["t", "b"]}, "Duplicate card ID"),
        ({"traits": ["t"], "actions": ["a", "a"]}, "Duplicate card ID"),
        ({"traits": ["t"], "actions": "ab"}, "Expected 2 card IDs"),
        ({"traits": ["t"], "actions": ["a", " "]}, "nonempty string"),
        ({"traits": ["t"], "actions": ["a", 1]}, "nonempty string"),
        ([], "mapped by source section"),
    ],
)
def test_rejects_invalid_card_assignments(ids, match, adapt):
    with pytest.raises(ValueError, match=match):
        adapt(snapshot_for(), CATALOG.manifest, sheet_id="sheet", card_ids=ids)


@pytest.mark.parametrize("sheet_id", ["", " ", None, str(UUID(int=1)), "srd51:goblin"])
def test_rejects_invalid_sheet_id(sheet_id, adapt):
    snapshot = snapshot_for()
    with pytest.raises(ValueError, match="sheet ID"):
        adapt(snapshot, CATALOG.manifest, sheet_id=sheet_id, card_ids=assignments(snapshot.statblock))


@pytest.mark.parametrize("use_valid_snapshot", [False, True])
def test_requires_validated_models(use_valid_snapshot, adapt):
    snapshot = snapshot_for()
    with pytest.raises(ValueError, match="validated SRD snapshot and manifest"):
        adapt(
            snapshot if use_valid_snapshot else snapshot.model_dump(),
            CATALOG.manifest.model_dump() if use_valid_snapshot else CATALOG.manifest,
            sheet_id="sheet", card_ids=assignments(snapshot.statblock),
        )


@pytest.mark.parametrize("legacy", [[], {"key": (1,)}, {1: True}, {"key": float("nan")}, {"key": 2**53 + 1}])
def test_rejects_legacy_data_that_cannot_round_trip_as_json(legacy, adapt):
    snapshot = snapshot_for()
    with pytest.raises(ValueError, match="Legacy"):
        adapt(snapshot, CATALOG.manifest, sheet_id="sheet", card_ids=assignments(snapshot.statblock), legacy_mob_data=legacy)


def test_rejects_cycles_in_legacy_json(adapt):
    snapshot = snapshot_for()
    legacy = {}
    legacy["cycle"] = [legacy]
    with pytest.raises(ValueError, match="cycles"):
        adapt(snapshot, CATALOG.manifest, sheet_id="sheet", card_ids=assignments(snapshot.statblock), legacy_mob_data=legacy)


def test_adapter_has_no_io(monkeypatch, tmp_path, adapt):
    snapshot = snapshot_for()
    ids = assignments(snapshot.statblock)
    monkeypatch.chdir(tmp_path)

    def forbidden(*args, **kwargs):
        pytest.fail("adapter must not open a file or socket")

    with monkeypatch.context() as guarded:
        guarded.setattr("builtins.open", forbidden)
        guarded.setattr("pathlib.Path.open", forbidden)
        guarded.setattr("socket.socket", forbidden)
        assert adapt(snapshot, CATALOG.manifest, sheet_id="sheet", card_ids=ids)["draft"]["sheetId"] == "sheet"
    assert list(tmp_path.iterdir()) == []
