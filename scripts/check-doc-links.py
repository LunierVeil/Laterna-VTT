#!/usr/bin/env python3
"""Validate local Markdown links without requiring a Git repository or network."""
import re
from pathlib import Path
from urllib.parse import unquote

root = Path(__file__).resolve().parents[1]
count = 0
errors = []
for page in sorted(root.rglob('*.md')):
    if any(p in {'.git', 'node_modules', '.venv'} for p in page.relative_to(root).parts):
        continue
    text = page.read_text(encoding='utf-8-sig')
    targets = re.findall(r'!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)', text)
    targets += re.findall(r'^\[[^\]]+\]:\s*(\S+)', text, re.M)
    for target in targets:
        if re.match(r'^[A-Za-z][\w+.-]*:', target) or target.startswith('//'):
            continue
        filename, _, fragment = unquote(target).partition('#')
        destination = (page.parent / filename).resolve() if filename else page
        count += 1
        if not destination.is_file():
            errors.append(f'{page.relative_to(root)}: missing {target}')
        elif fragment and destination.suffix == '.md':
            content = destination.read_text(encoding='utf-8-sig')
            anchors = set(re.findall(r'(?:id|name)=["\x27]([^"\x27]+)', content))
            duplicates = {}
            for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', content, re.M):
                slug = re.sub(r'[^\w\-\s]', '', heading.lower()).replace(' ', '-')
                number = duplicates.get(slug, 0)
                anchors.add(slug + (f'-{number}' if number else ''))
                duplicates[slug] = number + 1
            if fragment not in anchors:
                errors.append(f'{page.relative_to(root)}: missing anchor {target}')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'PASS: {count} local Markdown links and fragments; external URLs not fetched')
