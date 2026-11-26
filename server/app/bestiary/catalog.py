"""Versioned statblock contract and read-only access to bundled SRD templates."""

from importlib.resources import files
import re
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator

Text = Annotated[str, StringConstraints(pattern=r"\S")]
TemplateId = Annotated[str, StringConstraints(pattern=r"^srd51:[a-z0-9]+(?:-[a-z0-9]+)*$")]
AbilityName = Literal["Str", "Dex", "Con", "Int", "Wis", "Cha"]
Size = Literal["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]
Challenge = Literal[
    "0", "1/8", "1/4", "1/2", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23",
    "24", "25", "26", "27", "28", "29", "30",
]

# Experience Points by Challenge Rating, SRD 5.1 p. 258.
_XP_BY_CR = (
    0, 200, 450, 700, 1100, 1800, 2300, 2900, 3900, 5000, 5900, 7200, 8400,
    10000, 11500, 13000, 15000, 18000, 20000, 22000, 25000, 33000, 41000,
    50000, 62000, 75000, 90000, 105000, 120000, 135000, 155000,
)
_FRACTIONAL_XP = {"1/8": 25, "1/4": 50, "1/2": 100}


class CatalogValue(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)


class AbilityScore(CatalogValue):
    score: int = Field(ge=1, le=30)
    modifier: int = Field(ge=-5, le=10)


class AbilityScores(CatalogValue):
    str: AbilityScore
    dex: AbilityScore
    con: AbilityScore
    int: AbilityScore
    wis: AbilityScore
    cha: AbilityScore


class SavingThrow(CatalogValue):
    name: AbilityName
    bonus: int


class SkillBonus(CatalogValue):
    name: Text
    bonus: int


class Ability(CatalogValue):
    label: Text
    text: Text

    @property
    def recharge(self) -> str | None:
        """Return the printed recharge qualifier, without evaluating it."""
        match = re.search(r"\((Recharge[^()]*)\)$", self.label)
        return match[1] if match else None


class Statblock(CatalogValue):
    """Rules content shared by templates and independent homebrew snapshots."""

    name: Text
    size: Size
    creature_type: Annotated[str, StringConstraints(
        pattern=r"^(aberration|beast|celestial|construct|dragon|elemental|fey|fiend|"
                r"giant|humanoid|monstrosity|ooze|plant|undead)( \([^()]+\))?$",
    )]
    alignment: Text
    armor_class: int = Field(ge=0)
    armor_class_details: Text | None = None
    hit_points: int = Field(gt=0)
    hit_dice: Annotated[str, StringConstraints(pattern=r"^[1-9]\d*d(?:4|6|8|10|12|20)( [+-−] \d+)?$")]
    movement: Text
    abilities: AbilityScores
    saving_throws: tuple[SavingThrow, ...] = ()
    skills: tuple[SkillBonus, ...] = ()
    damage_vulnerabilities: Text | None = None
    damage_resistances: Text | None = None
    damage_immunities: Text | None = None
    condition_immunities: Text | None = None
    senses: Text
    languages: Text
    challenge_rating: Challenge
    xp: int = Field(ge=0)
    traits: tuple[Ability, ...] = ()
    actions: tuple[Ability, ...] = ()
    bonus_actions: tuple[Ability, ...] = ()
    reactions: tuple[Ability, ...] = ()
    legendary_intro: Text | None = None
    legendary_actions: tuple[Ability, ...] = ()
    source_note: Text | None = None

    @property
    def spellcasting(self) -> tuple[Ability, ...]:
        return tuple(trait for trait in self.traits if trait.label in ("Spellcasting", "Innate Spellcasting"))

    @property
    def bonus_action_references(self) -> tuple[Ability, ...]:
        """Return entries mentioning a bonus action, in their printed sections."""
        return tuple(
            ability for ability in (*self.traits, *self.actions, *self.reactions, *self.legendary_actions)
            if "bonus action" in ability.text.casefold()
        )

    @model_validator(mode="after")
    def validate_legendary_actions(self) -> Self:
        if bool(self.legendary_actions) != bool(self.legendary_intro):
            raise ValueError("Legendary actions and their printed preamble must be supplied together")
        return self


class SourceManifest(CatalogValue):
    catalog_schema_version: Literal[1]
    id: Literal["srd51-en"]
    title: Literal["System Reference Document 5.1"]
    language: Literal["en"]
    rules_edition: Literal["2014"]
    license: Literal["CC-BY-4.0"]
    license_url: Literal["https://creativecommons.org/licenses/by/4.0/legalcode"]
    document_url: Literal["https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf"]
    document_sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    attribution: Text
    changes: Text


class SourceLocation(CatalogValue):
    first_page: int = Field(ge=261, le=401)
    last_page: int = Field(ge=261, le=401)
    last_line: Text

    @model_validator(mode="after")
    def validate_page_order(self) -> Self:
        if self.first_page > self.last_page:
            raise ValueError("Source page range is reversed")
        return self


class SrdTemplate(CatalogValue):
    kind: Literal["srd_template"] = "srd_template"
    id: TemplateId
    source: Literal["srd51-en"]
    provenance: SourceLocation
    statblock: Statblock

    @model_validator(mode="after")
    def validate_source_xp(self) -> Self:
        cr, xp = self.statblock.challenge_rating, self.statblock.xp
        if cr == "0":
            valid_xp = (0, 10)
        elif cr in _FRACTIONAL_XP:
            valid_xp = (_FRACTIONAL_XP[cr],)
        else:
            valid_xp = (_XP_BY_CR[int(cr)],)
        if xp not in valid_xp:
            raise ValueError(f"Invalid SRD XP for challenge rating {cr}: {xp}")
        return self


class HomebrewOrigin(CatalogValue):
    template_id: TemplateId
    source: Literal["srd51-en"]
    provenance: SourceLocation
    document_sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class HomebrewDraft(BaseModel):
    """Editable in-memory record. Replacing the statblock validates the new snapshot."""

    model_config = ConfigDict(strict=True, extra="forbid", validate_assignment=True)

    kind: Literal["homebrew_draft"] = Field(default="homebrew_draft", frozen=True)
    id: UUID = Field(frozen=True)
    origin: HomebrewOrigin | None = Field(default=None, frozen=True)
    statblock: Statblock


class SrdCatalog(CatalogValue):
    manifest: SourceManifest
    templates: tuple[SrdTemplate, ...] = Field(min_length=50)

    @property
    def schema_version(self) -> Literal[1]:
        return self.manifest.catalog_schema_version

    @model_validator(mode="after")
    def validate_unique_templates(self) -> Self:
        if len({template.id for template in self.templates}) != len(self.templates):
            raise ValueError("Duplicate SRD template ID")
        locations = {(template.statblock.name, template.provenance.first_page) for template in self.templates}
        if len(locations) != len(self.templates):
            raise ValueError("Duplicate SRD source statblock")
        return self

    def get(self, template_id: str) -> SrdTemplate:
        for template in self.templates:
            if template.id == template_id:
                return template
        raise KeyError(template_id)

    def make_homebrew_draft(self, template_id: str, instance_id: UUID) -> HomebrewDraft:
        template = self.get(template_id)
        return HomebrewDraft(
            id=instance_id,
            origin=HomebrewOrigin(
                template_id=template.id,
                source=template.source,
                provenance=template.provenance,
                document_sha256=self.manifest.document_sha256,
            ),
            statblock=template.statblock.model_copy(deep=True),
        )


_TEMPLATES = TypeAdapter(tuple[SrdTemplate, ...])


def load_catalog() -> SrdCatalog:
    """Read and validate the bundled catalog. Importing this module reads no data."""
    package = files(__package__)
    manifest = SourceManifest.model_validate_json(package.joinpath("manifest.json").read_bytes())
    templates = _TEMPLATES.validate_json(package.joinpath("srd51.json").read_bytes())
    return SrdCatalog(manifest=manifest, templates=templates)
