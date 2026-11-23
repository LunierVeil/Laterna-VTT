"""Publication and reference names shared by uploads and instance backup."""

from pathlib import Path
import re
from tempfile import NamedTemporaryFile

UPLOAD_NAME = re.compile(r'[0-9a-f]{32}\.(?:png|jpg|webp)')
UPLOAD_TEMP = ".laterna-upload-"


def publish_upload(directory: Path, name: str, data: bytes | bytearray) -> None:
    """Publish a complete immutable upload before returning its URL."""
    with NamedTemporaryFile(dir=directory, prefix=UPLOAD_TEMP, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(data)
            output.close()
            # The caller runs synchronously on the event loop and owns uploads.
            if (directory / name).exists():
                raise FileExistsError("Upload name collision")
            temporary.replace(directory / name)
        finally:
            output.close()
            temporary.unlink(missing_ok=True)


def upload_references(value):
    names, stack = set(), [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str) and item.startswith('/uploads/'):
            name = item.removeprefix('/uploads/')
            if UPLOAD_NAME.fullmatch(name):
                names.add(name)
        elif isinstance(item, dict):
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return names
