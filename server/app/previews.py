"""Authenticated, bounded thumbnails of immutable local uploads (never URLs)."""
from pathlib import Path
import re
import threading
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from .config import UPLOAD_DIR

# Outside the publicly mounted uploads directory. All reads go through GM auth.
PREVIEW_DIR = UPLOAD_DIR.parent / (UPLOAD_DIR.name + "-previews")
MAX_PIXELS = 40_000_000
_lock = threading.Lock()


def preview_file(url: str) -> Path | None:
    if not re.fullmatch(r"/uploads/[a-f0-9]{32}\.(png|jpg|webp)", url):
        return None
    source = UPLOAD_DIR / url.rsplit("/", 1)[-1]
    target = PREVIEW_DIR / (source.stem + ".webp")
    with _lock:
        if target.is_file():
            return target
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(source) as image:
                    if image.width * image.height > MAX_PIXELS:
                        return None
                    image.thumbnail((480, 300), Image.Resampling.LANCZOS)
                    thumb = ImageOps.exif_transpose(image).convert("RGB")
                    thumb.thumbnail((480, 300), Image.Resampling.LANCZOS)
                    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
                    temporary = target.with_suffix(".tmp")
                    thumb.save(temporary, format="WEBP", quality=72)
                    temporary.replace(target)
            return target
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            return None
