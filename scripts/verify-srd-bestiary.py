"""Rebuild PB-20A JSON in memory from a user-supplied official SRD PDF."""

import argparse
import difflib
from hashlib import sha256
from itertools import groupby
import json
from pathlib import Path
import re
import subprocess
from xml.etree import ElementTree

DATA = Path(__file__).resolve().parents[1] / "server/app/bestiary"
ABILITY_KEYS = ("str", "dex", "con", "int", "wis", "cha")
SECTIONS = {
    "Actions": "actions",
    "Bonus Actions": "bonus_actions",
    "Reactions": "reactions",
    "Legendary Actions": "legendary_actions",
}
FIELDS = {
    "Saving Throws": "saving_throws",
    "Skills": "skills",
    "Damage Vulnerabilities": "damage_vulnerabilities",
    "Damage Resistances": "damage_resistances",
    "Damage Resistance": "damage_resistances",
    "Damage Immunities": "damage_immunities",
    "Condition Immunities": "condition_immunities",
    "Senses": "senses",
    "Languages": "languages",
    "Challenge": "challenge",
}


def normalize(text):
    # Poppler exposes the PDF's nonbreaking spaces as tab/CR/NBSP sequences.
    # A soft hyphen followed by U+2010 denotes a printed word-internal hyphen.
    return " ".join(text.replace("-\u00ad\u2010\u2011", "-").replace("-\u00ad\u2010", "-").split())


def read_pdf(pdf):
    raw = subprocess.check_output(["pdftotext", "-raw", "-enc", "UTF-8", str(pdf), "-"]).decode()
    pages = [page.replace("\t\r \xa0", " ").splitlines() for page in raw.split("\f")]
    xml = subprocess.check_output([
        "pdftohtml", "-xml", "-i", "-hidden", "-stdout", "-f", "261", "-l", "401", str(pdf),
    ])
    headings = {}
    for page in ElementTree.fromstring(xml).findall("page"):
        headings[int(page.attrib["number"])] = page_headings(page)
    return pages, headings


def heading_style(segment):
    if segment.find("i/b") is not None:
        return "italic_bold"
    if segment.find("b") is not None:
        return "bold"
    return None


def page_headings(page):
    labels = set()
    for _, row in groupby(page.findall("text"), key=lambda segment: segment.attrib["top"]):
        visible = [segment for segment in row if normalize("".join(segment.itertext()))]
        for style, run in groupby(visible, key=heading_style):
            label = normalize(" ".join("".join(segment.itertext()) for segment in run))
            if style and label.endswith("."):
                labels.add(label)
    return sorted(labels, key=lambda label: (-len(label), label))


def statblock_lines(pages, template):
    source = template["provenance"]
    first_page, last_page = source["first_page"], source["last_page"]
    lines = [
        (page, normalize(line))
        for page in range(first_page, last_page + 1)
        for line in pages[page - 1][1:] if line.strip()
    ]
    starts = [
        index for index, (page, text) in enumerate(lines[:-2])
        if (page, text) == (first_page, template["statblock"]["name"])
        and lines[index + 2][1].startswith("Armor Class ")
    ]
    if len(starts) != 1:
        raise ValueError(f"Ambiguous title for {template['id']}: {starts}")
    following = next(
        (index - 2 for index in range(starts[0] + 3, len(lines))
         if lines[index][1].startswith("Armor Class ")),
        len(lines),
    )
    ends = [
        index for index in range(starts[0] + 1, following)
        if lines[index] == (last_page, normalize(source["last_line"]))
    ]
    if len(ends) != 1:
        raise ValueError(f"Ambiguous end for {template['id']}: {ends}")
    return lines[starts[0] : ends[0] + 1]


def join_lines(lines):
    text = "\n".join(lines)
    # Join a compound split at the PDF's line edge. Keep the printed hyphen.
    return re.sub(r"(?<=\w)-\n(?=[a-z])", "-", text).replace("\n", " ")


def ability_text(lines):
    # Preserve the start of spell lists, notes and breath options for reading.
    breaks = re.compile(
        r"^(?:At will:|\d+/day(?: each)?:|Cantrips \(at will\):|"
        r"\d+(?:st|nd|rd|th) level \(|\*|Fire Breath\.|Weakening Breath\.|"
        r"Forbiddance\.|Harmed by Running Water\.|Stake to the Heart\.|Sunlight Hypersensitivity\.)"
    )
    groups = [[]]
    for line in lines:
        if groups[-1] and breaks.match(line):
            groups.append([])
        groups[-1].append(line)
    return "\n".join(join_lines(group) for group in groups)


def parse_abilities(lines, headings):
    sections = {"traits": []}
    section = "traits"
    entry = None
    lead = []
    note = []
    for page, line in lines:
        if line in SECTIONS:
            section = SECTIONS[line]
            if section in sections:
                raise ValueError(f"Repeated {line} on p. {page}")
            sections[section] = []
            entry = None
            continue
        # Frog's statement on attacks and its alternate use are printed as a
        # separate paragraph below the block. Keep them as a note.
        if line.startswith("A frog has no effective attacks.") or note:
            note.append(line)
            continue
        label = next((candidate for candidate in headings[page]
                      if line == candidate or line.startswith(candidate + " ")), None)
        if entry and entry["label"].startswith("Breath Weapons ("):
            # The bold names here are options of one action with one recharge.
            label = None
        if label is not None:
            entry = {"label": label[:-1], "text": [line[len(label):].lstrip()]}
            sections[section].append(entry)
        elif entry is not None:
            entry["text"].append(line)
        elif section == "legendary_actions":
            lead.append(line)
        else:
            raise ValueError(f"Unexpected text in {section} on p. {page}: {line}")
    for entries in sections.values():
        for ability in entries:
            ability["text"] = ability_text(list(filter(None, ability["text"])))
    content = {key: value for key, value in sections.items() if value}
    if lead:
        content["legendary_intro"] = join_lines(lead)
    if note:
        content["source_note"] = join_lines(note)
    return content


def signed_pairs(text):
    pairs = [re.fullmatch(r"([A-Za-z ]+) ([+−-]\d+)", value) for value in text.split(", ")]
    if any(pair is None for pair in pairs):
        raise ValueError(f"Invalid signed bonus list: {text}")
    return [{"name": pair[1], "bonus": int(pair[2].replace("−", "-"))} for pair in pairs]


def parse_statblock(lines, headings):
    body = [line for _, line in lines]
    name, classification, ac, hp, movement, score_header, scores = body[:7]
    size, creature = classification.split(" ", 1)
    creature_type, alignment = creature.rsplit(", ", 1)
    armor = re.fullmatch(r"Armor Class (\d+)(?: (.+))?", ac)
    hit = re.fullmatch(r"Hit Points (\d+) \(([^()]+)\)", hp)
    score_pairs = re.findall(r"(\d+) \(([+−-]\d+)\)", scores)
    if not armor or not hit or not movement.startswith("Speed ") or (
        score_header != "STR DEX CON INT WIS CHA" or len(score_pairs) != 6
    ):
        raise ValueError(f"Invalid core fields for {name}")
    result = {
        "name": name,
        "size": size,
        "creature_type": creature_type,
        "alignment": alignment,
        "armor_class": int(armor[1]),
        "hit_points": int(hit[1]),
        "hit_dice": hit[2],
        "movement": movement.removeprefix("Speed "),
        "abilities": {
            key: {"score": int(score), "modifier": int(modifier.replace("−", "-"))}
            for key, (score, modifier) in zip(ABILITY_KEYS, score_pairs, strict=True)
        },
    }
    if armor[2]:
        result["armor_class_details"] = armor[2]
    values = {}
    label = None
    for index, line in enumerate(body[7:], start=7):
        field = next((value for value in FIELDS if line.startswith(value + " ")), None)
        if field:
            label = field
            if field in values:
                raise ValueError(f"Repeated {field} in {name}")
            values[label] = [line.removeprefix(label + " ")]
        elif label is not None:
            values[label].append(line)
        else:
            raise ValueError(f"Missing heading in {name}: {line}")
        if label == "Challenge":
            break
    else:
        raise ValueError(f"Missing challenge in {name}")
    for label, pieces in values.items():
        text = join_lines(pieces)
        key = FIELDS[label]
        if key in ("saving_throws", "skills"):
            result[key] = signed_pairs(text)
        elif key == "challenge":
            challenge = re.fullmatch(r"(\S+) \(([\d,]+) XP\)", text)
            if not challenge:
                raise ValueError(f"Invalid challenge in {name}: {text}")
            result.update(challenge_rating=challenge[1], xp=int(challenge[2].replace(",", "")))
        else:
            result[key] = text
    rules_lines = lines[index + 1 :]
    rules = parse_abilities(rules_lines, headings)
    check_rules_coverage(rules_lines, rules, name)
    result.update(rules)
    return result


def check_rules_coverage(lines, rules, name):
    """Round-trip the rules portion to detect skipped source words and headings."""
    printed = []
    for heading, section in (("", "traits"), *SECTIONS.items()):
        if section not in rules:
            continue
        if heading:
            printed.append(heading)
        if section == "legendary_actions":
            printed.append(rules["legendary_intro"])
        printed.extend(f"{entry['label']}. {entry['text']}" for entry in rules[section])
    if "source_note" in rules:
        printed.append(rules["source_note"])
    if normalize(" ".join(printed)) != join_lines(line for _, line in lines):
        raise ValueError(f"Rules text failed round-trip for {name}")


def rebuild(pdf, manifest, templates):
    if sha256(pdf.read_bytes()).hexdigest() != manifest["document_sha256"]:
        raise ValueError("PDF does not match manifest SHA-256")
    pages, headings = read_pdf(pdf)
    legal_page = normalize(" ".join(pages[0]))
    if manifest["attribution"] not in legal_page:
        raise ValueError("Attribution does not match the official PDF")
    return [
        {
            "id": template["id"],
            "source": manifest["id"],
            "provenance": template["provenance"],
            "statblock": parse_statblock(statblock_lines(pages, template), headings),
        }
        for template in templates
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    templates = json.loads((DATA / "srd51.json").read_text(encoding="utf-8"))
    rebuilt = rebuild(args.pdf, manifest, templates)
    if rebuilt != templates:
        for old, new in zip(templates, rebuilt, strict=True):
            if old != new:
                print("\n".join(difflib.unified_diff(
                    json.dumps(old, ensure_ascii=False, indent=2).splitlines(),
                    json.dumps(new, ensure_ascii=False, indent=2).splitlines(),
                    fromfile=old["id"], tofile=f"{new['id']} (PDF)", lineterm="",
                )))
        parser.exit(1, "Catalog differs from the official PDF extraction\n")
    print(f"{len(rebuilt)} statblocks match the pinned SRD 5.1 PDF.")


if __name__ == "__main__":
    main()
