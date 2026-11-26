from importlib.util import find_spec
import json
from pathlib import Path
import socket
from uuid import UUID

import pytest
from pydantic import ValidationError


def test_srd_catalog_loads_offline(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    def no_network(*args, **kwargs):
        raise AssertionError("catalog must not open a socket")

    monkeypatch.setattr(socket, "socket", no_network)
    assert find_spec("app.bestiary.catalog") is not None, "offline catalog is missing"
    from app.bestiary.catalog import load_catalog

    catalog = load_catalog()
    assert len(catalog.templates) >= 50
    assert len({template.id for template in catalog.templates}) == len(catalog.templates)
    assert not list(Path.cwd().iterdir())


def test_srd_metadata_and_range():
    from app.bestiary.catalog import load_catalog

    catalog = load_catalog()
    manifest = catalog.manifest
    assert catalog.schema_version == 1
    assert (manifest.language, manifest.rules_edition, manifest.license) == ("en", "2014", "CC-BY-4.0")
    assert manifest.license_url in manifest.attribution
    assert all(template.source == manifest.id for template in catalog.templates)
    assert len({template.statblock.size for template in catalog.templates}) == 6
    assert len({template.statblock.creature_type.split(" (")[0] for template in catalog.templates}) == 14
    assert {"0", "1/8", "1/4", "1/2", "30"} <= {
        template.statblock.challenge_rating for template in catalog.templates
    }
    with pytest.raises(KeyError):
        catalog.get("srd51:missing")


def test_source_distinctions_survive():
    from app.bestiary.catalog import load_catalog

    catalog = load_catalog()
    frog = catalog.get("srd51:frog").statblock
    assert (frog.challenge_rating, frog.xp, frog.actions) == ("0", 0, ())
    assert frog.source_note.startswith("A frog has no effective attacks.")
    assert catalog.get("srd51:commoner").statblock.xp == 10
    shrieker = catalog.get("srd51:shrieker").statblock
    assert shrieker.actions == ()
    assert shrieker.reactions[0].label == "Shriek"
    goblin = catalog.get("srd51:goblin").statblock
    assert goblin.bonus_actions == ()
    assert goblin.bonus_action_references[0].label == "Nimble Escape"
    assert goblin.traits[0].text == (
        "The goblin can take the Disengage or Hide action as a bonus action on each of its turns."
    )

    dragon = catalog.get("srd51:gold-dragon-wyrmling")
    assert (dragon.provenance.first_page, dragon.provenance.last_page) == (300, 301)
    bite, breath = dragon.statblock.actions
    assert bite.recharge is None
    assert breath.recharge == "Recharge 5–6"
    assert "\nFire Breath." in breath.text and "\nWeakening Breath." in breath.text
    knight = catalog.get("srd51:knight").statblock
    assert knight.actions[-1].recharge == "Recharges after a Short or Long Rest"
    assert knight.reactions[0].label == "Parry"

    archmage = catalog.get("srd51:archmage").statblock
    assert archmage.armor_class_details == "(15 with mage armor)"
    assert "\n9th level (1 slot): time stop\n*The archmage" in archmage.spellcasting[0].text
    deva = catalog.get("srd51:deva").statblock
    assert deva.spellcasting[0].label == "Innate Spellcasting"
    assert deva.damage_resistances == "radiant; bludgeoning, piercing, and slashing from nonmagical attacks"
    skeleton = catalog.get("srd51:skeleton").statblock
    assert skeleton.damage_vulnerabilities == "bludgeoning"
    assert skeleton.damage_immunities == "poison"
    aboleth = catalog.get("srd51:aboleth").statblock
    assert "Only one legendary action option" in aboleth.legendary_intro
    assert aboleth.legendary_actions[-1].label == "Psychic Drain (Costs 2 Actions)"


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("id",), "homebrew:aboleth", "String should match pattern"),
        (("source",), "srd52-en", "Input should be 'srd51-en'"),
        (("provenance",), None, "Field required"),
        (("provenance", "first_page"), 400, "Source page range is reversed"),
        (("statblock", "hit_points"), True, "Input should be a valid integer"),
        (("statblock", "hit_dice"), None, "Field required"),
        (("statblock", "size"), "Colossal", "Input should be"),
        (("statblock", "challenge_rating"), "0.5", "Input should be"),
        (("statblock", "challenge_rating"), 10, "Input should be"),
        (("statblock", "xp"), 0, "Invalid SRD XP"),
        (("statblock", "legendary_intro"), None, "must be supplied together"),
        (("statblock", "foreign_field"), "another source", "Extra inputs are not permitted"),
    ],
)
def test_reject_invalid_template(path, value, message):
    from app.bestiary.catalog import SrdTemplate, load_catalog

    template = load_catalog().get("srd51:aboleth")
    record = template.model_dump(mode="json")
    obj = record
    for key in path[:-1]:
        obj = obj[key]
    if value is None:
        obj.pop(path[-1])
    else:
        obj[path[-1]] = value
    with pytest.raises(ValidationError, match=message):
        SrdTemplate.model_validate_json(json.dumps(record))


def test_reject_duplicate_templates_and_incomplete_catalog():
    from app.bestiary.catalog import SrdCatalog, load_catalog

    catalog = load_catalog()
    with pytest.raises(ValidationError, match="Duplicate SRD template ID"):
        SrdCatalog(manifest=catalog.manifest, templates=(catalog.templates[0], *catalog.templates))
    duplicate = catalog.templates[0].model_copy(update={"id": "srd51:duplicate"})
    with pytest.raises(ValidationError, match="Duplicate SRD source statblock"):
        SrdCatalog(manifest=catalog.manifest, templates=(*catalog.templates, duplicate))
    with pytest.raises(ValidationError, match="at least 50"):
        SrdCatalog(manifest=catalog.manifest, templates=catalog.templates[:49])


def test_homebrew_snapshots_are_independent():
    from app.bestiary.catalog import Statblock, load_catalog

    catalog = load_catalog()
    template = catalog.get("srd51:goblin")
    first = catalog.make_homebrew_draft(template.id, UUID(int=1))
    second = catalog.make_homebrew_draft(template.id, UUID(int=2))
    assert first.id != second.id
    assert first.origin == second.origin
    assert first.origin.template_id == template.id
    assert (first.origin.source, first.origin.provenance) == (template.source, template.provenance)
    assert first.origin.document_sha256 == catalog.manifest.document_sha256
    assert first.statblock is not template.statblock
    assert first.statblock.actions[0] is not second.statblock.actions[0]
    with pytest.raises(ValidationError, match="frozen"):
        template.statblock.abilities.str.score = 30
    with pytest.raises(ValidationError, match="frozen"):
        first.id = second.id

    edited = first.statblock.model_dump()
    edited["name"] = "Campaign Goblin"
    edited["hit_points"] = 19
    first.statblock = Statblock.model_validate(edited)
    with pytest.raises(ValidationError):
        first.statblock = {"hit_points": False}
    assert (first.statblock.name, first.statblock.hit_points) == ("Campaign Goblin", 19)
    assert second.statblock == catalog.get(template.id).statblock == load_catalog().get(template.id).statblock
