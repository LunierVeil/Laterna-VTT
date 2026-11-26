"""Exercise the verification CLI with synthetic PDF extraction fixtures."""

import contextlib
from copy import deepcopy
from hashlib import sha256
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "verify-srd-bestiary.py"
SPEC = importlib.util.spec_from_file_location("verify_srd_bestiary", SCRIPT)
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)

CORE = (
    "Small humanoid, neutral",
    "Armor Class 12",
    "Hit Points 5 (2d4)",
    "Speed 30 ft.",
    "STR DEX CON INT WIS CHA",
    "10 (+0) 10 (+0) 10 (+0) 10 (+0) 10 (+0) 10 (+0)",
    "Senses passive Perception 10",
    "Languages Common",
    "Challenge 0 (10 XP)",
)
ATTRIBUTION = "Synthetic test attribution"


def record(name, first, last, last_line, actions, reactions=()):
    return {
        "id": "srd51:" + name.lower().replace(" ", "-"),
        "source": "srd51-en",
        "provenance": {"first_page": first, "last_page": last, "last_line": last_line},
        "statblock": {
            "name": name,
            "size": "Small",
            "creature_type": "humanoid",
            "alignment": "neutral",
            "armor_class": 12,
            "hit_points": 5,
            "hit_dice": "2d4",
            "movement": "30 ft.",
            "abilities": {name: {"score": 10, "modifier": 0} for name in ("str", "dex", "con", "int", "wis", "cha")},
            "senses": "passive Perception 10",
            "languages": "Common",
            "challenge_rating": "0",
            "xp": 10,
            "actions": [{"label": label, "text": text} for label, text in actions],
            **({"reactions": [{"label": label, "text": text} for label, text in reactions]} if reactions else {}),
        },
    }


class VerifySrdBestiaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name)
        self.pdf = self.path / "source.pdf"
        self.pdf.write_bytes(b"synthetic PDF extraction fixture")
        (self.path / "manifest.json").write_text(json.dumps({
            "id": "srd51-en",
            "document_sha256": sha256(self.pdf.read_bytes()).hexdigest(),
            "attribution": ATTRIBUTION,
        }), encoding="utf-8")
        self.index = self.path / "srd51-boundaries.tsv"
        self.index.write_text(
            "id\tname\tfirst_page\tlast_page\tlast_line\tnext_page\tnext_line\n"
            "srd51:goblin\tGoblin\t261\t261\tSecond attack.\t261\tKnight\n"
            "srd51:knight\tKnight\t261\t261\tA defensive reaction.\t261\tZombie\n"
            "srd51:zombie\tZombie\t261\t262\tAn attack across pages.\t262\tOther Goblin\n",
            encoding="utf-8",
        )
        self.pages = [[] for _ in range(262)]
        self.pages[0] = [ATTRIBUTION]
        self.pages[260] = [
            "Page 261",
            "Goblin", *CORE, "Actions", "Scimitar. First attack.", "Shortbow.", "Second attack.",
            "Knight", *CORE, "Actions", "Sword. A sword attack.", "Reactions", "Parry.", "A defensive reaction.",
            "Zombie", *CORE, "Actions", "Claw. A claw attack.",
        ]
        self.pages[261] = [
            "Page 262", "Slam.", "An attack across pages.",
            "Other Goblin", *CORE, "Actions", "Scimitar. First attack.", "Shortbow.", "Second attack.",
        ]
        self.headings = {
            261: ["Scimitar.", "Shortbow.", "Sword.", "Parry.", "Claw."],
            262: ["Slam.", "Scimitar.", "Shortbow."],
        }
        self.templates = [
            record("Goblin", 261, 261, "Second attack.", [("Scimitar", "First attack."), ("Shortbow", "Second attack.")]),
            record("Knight", 261, 261, "A defensive reaction.", [("Sword", "A sword attack.")], [("Parry", "A defensive reaction.")]),
            record("Zombie", 261, 262, "An attack across pages.", [("Claw", "A claw attack."), ("Slam", "An attack across pages.")]),
        ]

    def run_verifier(self, templates):
        (self.path / "srd51.json").write_text(json.dumps(templates), encoding="utf-8")
        output = io.StringIO()
        with (
            patch.object(VERIFIER, "DATA", self.path),
            patch.object(VERIFIER, "BOUNDARIES", self.index, create=True),
            patch.object(VERIFIER, "read_pdf", return_value=(self.pages, self.headings)),
            patch("sys.argv", [str(SCRIPT), str(self.pdf)]),
            contextlib.redirect_stdout(output),
            contextlib.redirect_stderr(output),
        ):
            try:
                VERIFIER.main()
            except SystemExit as exc:
                return exc.code, output.getvalue()
        return 0, output.getvalue()

    def assert_rejected(self, templates):
        code, output = self.run_verifier(templates)
        self.assertEqual(code, 1, output)

    def test_complete_catalog(self):
        code, output = self.run_verifier(self.templates)
        self.assertEqual(code, 0, output)
        self.assertIn("3 statblocks match", output)

    def test_next_marker_must_immediately_follow_end_in_pdf(self):
        self.pages[260].insert(self.pages[260].index("Knight"), "Extra source text.")
        code, output = self.run_verifier(self.templates)
        self.assertEqual(code, 1, output)
        self.assertIn("adjacent PDF end markers for srd51:goblin", output)

    def test_missing_last_full_action(self):
        self.templates[0]["statblock"]["actions"].pop()
        self.assert_rejected(self.templates)

    def test_missing_last_action_with_forged_last_line(self):
        goblin = self.templates[0]
        goblin["statblock"]["actions"].pop()
        goblin["provenance"]["last_line"] = "Scimitar. First attack."
        self.assert_rejected(self.templates)

    def test_missing_reaction_with_forged_last_line(self):
        knight = self.templates[1]
        del knight["statblock"]["reactions"]
        knight["provenance"]["last_line"] = "Sword. A sword attack."
        self.assert_rejected(self.templates)

    def test_truncated_cross_page_block_with_forged_last_page(self):
        zombie = self.templates[2]
        zombie["statblock"]["actions"].pop()
        zombie["provenance"].update(last_page=261, last_line="Claw. A claw attack.")
        self.assert_rejected(self.templates)

    def test_replaced_stable_id(self):
        self.templates[0]["id"] = "srd51:renamed"
        self.assert_rejected(self.templates)

    def test_replaced_name_and_provenance_with_other_real_source_heading(self):
        goblin = self.templates[0]
        goblin["statblock"]["name"] = "Other Goblin"
        goblin["provenance"].update(first_page=262, last_page=262)
        self.assert_rejected(self.templates)

    def test_missing_or_duplicate_indexed_record(self):
        with self.subTest("missing"):
            self.assert_rejected(self.templates[1:])
        with self.subTest("duplicate"):
            self.assert_rejected([*self.templates, deepcopy(self.templates[0])])
