"""Read the tested UVTT 0.2/0.3 interchange profile into image-local pixels."""

from __future__ import annotations

import base64
import binascii
import json
import math
import re
import struct
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Literal, TypeVar

from PIL import Image

MAX_FILE_BYTES = 36 * 1024 * 1024
MAX_IMAGE_BYTES = 24 * 1024 * 1024
MAX_BASE64_CHARS = 4 * ((MAX_IMAGE_BYTES + 2) // 3)
MAX_JSON_DEPTH = 16
MAX_JSON_TOKENS = 350_000
MAX_NUMBER_CHARS = 64
MAX_STRING_CHARS = 4096
MAX_KEY_CHARS = 128
MAX_OBJECTS = 10_000
MAX_POINTS = 25_000
MAX_REPORT_ENTRIES = 512
MAX_IMAGE_SIDE = 8192
MAX_IMAGE_PIXELS = 32 * 1024 * 1024
MAX_IMAGE_CHUNKS = 4096
MAX_PNG_METADATA_BYTES = 2 * 1024 * 1024
MAX_PNG_METADATA_STREAM = 1024 * 1024
MAX_PNG_METADATA_INFLATED = 4 * 1024 * 1024
MAX_PIXELS_PER_GRID = 1024
MAX_COORDINATE = 65_536
PIXEL_ROUNDING_TOLERANCE = 0.01

Version = Literal["0.2", "0.3"]
ImageFormat = Literal["PNG", "WEBP"]
Disposition = Literal["supported", "converted", "unsupported", "unknown", "dropped_invalid", "blocking"]


@dataclass(frozen=True, slots=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True, slots=True)
class Metadata:
    version: Version
    software: str | None
    creator: str | None
    baked_lighting: bool | None


@dataclass(frozen=True, slots=True)
class Grid:
    pixels_per_grid: int
    origin_cells: Point
    size_cells: Point


@dataclass(frozen=True, slots=True)
class Raster:
    format: ImageFormat
    width: int
    height: int
    data: bytes = field(repr=False)


@dataclass(frozen=True, slots=True)
class Wall:
    source: Literal["line_of_sight", "objects_line_of_sight"]
    points_px: tuple[Point, ...]


@dataclass(frozen=True, slots=True)
class Portal:
    position_px: Point
    bounds_px: tuple[Point, Point]
    closed: bool
    rotation_rad: float | None
    freestanding: bool | None


@dataclass(frozen=True, slots=True)
class Light:
    position_px: Point
    range_px: float
    intensity: float
    rgba: tuple[int, int, int, int]
    shadows: bool | None


@dataclass(frozen=True, slots=True)
class Diagnostic:
    disposition: Disposition
    path: str
    code: str
    reason: str


@dataclass(frozen=True, slots=True)
class UvttImport:
    metadata: Metadata
    grid: Grid
    image: Raster
    walls: tuple[Wall, ...]
    portals: tuple[Portal, ...]
    lights: tuple[Light, ...]
    warnings: tuple[Diagnostic, ...]
    loss_report: tuple[Diagnostic, ...]

    @property
    def size_px(self) -> tuple[int, int]:
        return self.image.width, self.image.height


class UvttParseError(ValueError):
    """The document is unusable. No partial import is returned."""

    def __init__(self, path: str, code: str, reason: str):
        self.diagnostic = Diagnostic("blocking", path, code, reason)
        super().__init__(f"{path or '/'}: {reason}")


def _path(parent: str, key: str | int) -> str:
    return parent + "/" + str(key).replace("~", "~0").replace("/", "~1")


# Scan structure before json.loads allocates Python containers. The JSON decoder
# still owns syntax checking. A second scan enforces decoded string/key limits.
_TOKEN = re.compile(r'[ \t\r\n]*("|[{}\[\],:]|[^ \t\r\n"{}\[\],:]+|\Z)')
_STRING_MARK = re.compile(r'["\\]')


def _check_json_structure(text: str) -> None:
    depth = tokens = position = 0
    while position < len(text):
        match = _TOKEN.match(text, position)
        assert match is not None  # The lexer covers every character and EOF.
        start, position = match.span(1)
        if start == position:
            break
        tokens += 1
        char = text[start]
        if char in "{[":
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise UvttParseError("", "json_depth", "JSON nesting exceeds the limit")
        elif char in "}]":
            depth -= 1
            if depth < 0:
                raise UvttParseError("", "invalid_json", "Invalid JSON structure")
        elif char == '"':
            while True:
                marker = _STRING_MARK.search(text, position)
                if marker is None:
                    raise UvttParseError("", "invalid_json", "Unterminated JSON string")
                position = marker.end()
                if marker[0] == '"':
                    break
                position += 1
                tokens += 1
                if tokens > MAX_JSON_TOKENS:
                    raise UvttParseError("", "json_complexity", "JSON token budget exceeded")
        elif position - start > MAX_NUMBER_CHARS:
            raise UvttParseError("", "json_token_length", "JSON scalar token is too long")
        if tokens > MAX_JSON_TOKENS:
            raise UvttParseError("", "json_complexity", "JSON token budget exceeded")


def _json_number(token: str) -> Decimal:
    try:
        value = Decimal(token)
        as_float = float(value)
    except (InvalidOperation, ValueError, OverflowError) as exc:
        raise UvttParseError("", "invalid_number", "Invalid JSON number") from exc
    if not math.isfinite(as_float) or (as_float == 0 and value != 0):
        raise UvttParseError("", "invalid_number", "Number outside finite binary64 range")
    return value


def _json_object(items: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in items:
        if key in result:
            raise UvttParseError("", "duplicate_key", "Duplicate JSON object member")
        result[key] = value
    return result


def _check_strings(value: object, path: str = "") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if len(key) > MAX_KEY_CHARS or _has_surrogate(key):
                raise UvttParseError(path, "invalid_key", "Invalid or overlong JSON object key")
            _check_strings(child, _path(path, key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _check_strings(child, _path(path, index))
    elif isinstance(value, str):
        if path == "/image":
            if len(value) > MAX_BASE64_CHARS:
                raise UvttParseError(path, "base64_size", "Base64 image exceeds the encoded size limit")
        elif len(value) > MAX_STRING_CHARS or _has_surrogate(value):
            raise UvttParseError(path, "invalid_string", "Invalid or overlong JSON string")


_SURROGATE = re.compile(r"[\ud800-\udfff]")


def _has_surrogate(value: str) -> bool:
    return _SURROGATE.search(value) is not None


def _read_json(data: bytes) -> object:
    if len(data) > MAX_FILE_BYTES:
        raise UvttParseError("", "file_size", "UVTT file exceeds the byte limit")
    try:
        text = data.decode("utf-8-sig")
        _check_json_structure(text)
        value = json.loads(text, parse_int=_json_number, parse_float=_json_number,
                           parse_constant=_json_number, object_pairs_hook=_json_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UvttParseError("", "invalid_json", "Expected a valid UTF-8 JSON document") from exc
    _check_strings(value)
    return value


class _Invalid(ValueError):
    def __init__(self, path: str, reason: str):
        self.path = path
        self.reason = reason


def _object(value: object, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise _Invalid(path, "Expected an object")
    return value


def _array(value: object, path: str) -> list[object]:
    if not isinstance(value, list):
        raise _Invalid(path, "Expected an array")
    return value


def _number(value: object, path: str, lower: float = -MAX_COORDINATE,
            upper: float = MAX_COORDINATE) -> float:
    if not isinstance(value, Decimal) or not lower <= value <= upper:
        raise _Invalid(path, f"Expected a number from {lower} to {upper}")
    return float(value)


def _boolean(value: object, path: str) -> bool:
    if type(value) is not bool:
        raise _Invalid(path, "Expected a boolean")
    return value


def _string(value: object, path: str) -> str:
    if not isinstance(value, str):
        raise _Invalid(path, "Expected a string")
    return value


def _color(value: object, path: str) -> tuple[int, int, int, int]:
    if not isinstance(value, str) or not re.fullmatch("[0-9a-fA-F]{8}", value):
        raise _Invalid(path, "Expected an eight-digit AARRGGBB color")
    argb = int(value, 16)
    return (argb >> 16 & 255, argb >> 8 & 255, argb & 255, argb >> 24)


T = TypeVar("T")


def _optional(obj: dict[str, object], key: str, path: str,
              parse: Callable[[object, str], T]) -> T | None:
    return parse(obj[key], _path(path, key)) if key in obj else None


_WALL_FIELDS = ("line_of_sight", "objects_line_of_sight")
_GEOMETRY_FIELDS = (*_WALL_FIELDS, "portals", "lights")


def _geometry_arrays(root: dict[str, object]) -> dict[str, list[object]]:
    arrays = {key: _array(root[key], _path("", key)) for key in _GEOMETRY_FIELDS if key in root}
    if sum(map(len, arrays.values())) > MAX_OBJECTS:
        raise UvttParseError("", "geometry_objects", "Geometry object budget exceeded")
    points = 0
    for key, objects in arrays.items():
        for index, value in enumerate(objects):
            if key in _WALL_FIELDS and isinstance(value, list):
                points += len(value)
            elif isinstance(value, dict):
                points += int("position" in value)
                if key == "portals" and isinstance(bounds := value.get("bounds"), list):
                    points += len(bounds)
            if points > MAX_POINTS:
                raise UvttParseError(_path(_path("", key), index), "geometry_points",
                                     "Geometry point budget exceeded")
    return arrays


def _bounded_raster_size(width: int, height: int) -> tuple[int, int]:
    if not (1 <= width <= MAX_IMAGE_SIDE and 1 <= height <= MAX_IMAGE_SIDE
            and width * height <= MAX_IMAGE_PIXELS):
        raise UvttParseError("/image", "image_dimensions", "Image dimensions exceed the raster budget")
    return width, height


def _webp_size(data: bytes) -> tuple[int, int]:
    def uint(start: int, size: int) -> int:
        return int.from_bytes(data[start:start + size], "little")

    if uint(4, 4) + 8 != len(data):
        raise _Invalid("/image", "Invalid WebP container length")
    offset, chunks = 12, 0
    canvas = frame = None
    while offset + 8 <= len(data):
        kind, length = data[offset:offset + 4], uint(offset + 4, 4)
        start = offset + 8
        offset = start + length + length % 2
        chunks += 1
        if chunks > MAX_IMAGE_CHUNKS:
            raise UvttParseError("/image", "image_chunks", "Image chunk budget exceeded")
        if offset > len(data):
            raise _Invalid("/image", "Truncated WebP chunk")
        if length % 2 and data[offset - 1] != 0:
            raise _Invalid("/image", "Invalid WebP chunk padding")
        if kind in (b"ANIM", b"ANMF"):
            raise _Invalid("/image", "Animated images are unsupported")
        if kind == b"VP8X":
            if chunks != 1 or length != 10:
                raise _Invalid("/image", "Invalid WebP canvas header")
            if data[start] & 0x02:
                raise _Invalid("/image", "Animated images are unsupported")
            canvas = _bounded_raster_size(1 + uint(start + 4, 3), 1 + uint(start + 7, 3))
        if kind in (b"VP8 ", b"VP8L"):
            if frame is not None:
                raise _Invalid("/image", "Multiple WebP raster chunks")
            if kind == b"VP8 " and length >= 10 and data[start + 3:start + 6] == b"\x9d\x01\x2a":
                frame = _bounded_raster_size(uint(start + 6, 2) & 0x3fff, uint(start + 8, 2) & 0x3fff)
            elif kind == b"VP8L" and length >= 5 and data[start] == 0x2f:
                dimensions = uint(start + 1, 4)
                frame = _bounded_raster_size(1 + (dimensions & 0x3fff), 1 + (dimensions >> 14 & 0x3fff))
            else:
                raise _Invalid("/image", "Invalid WebP raster header")
    if offset != len(data) or frame is None or (canvas is not None and canvas != frame):
        raise _Invalid("/image", "Inconsistent WebP dimensions or chunks")
    return frame


# W3C PNG 3, sections 5.6, 8, 10 and 11.2. Pillow still owns pixel decoding.
_PNG_DEPTHS = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
_PNG_CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
_PNG_ADAM7 = ((0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
              (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2))
_PNG_CRITICAL = {b"IHDR", b"PLTE", b"IDAT", b"IEND"}
_PNG_ANIMATION = {b"acTL", b"fcTL", b"fdAT"}
_PNG_BEFORE_PLTE = {b"cHRM", b"cICP", b"gAMA", b"iCCP", b"mDCV", b"cLLI", b"sBIT", b"sRGB"}
_PNG_AFTER_PLTE = {b"bKGD", b"hIST", b"tRNS"}
_PNG_BEFORE_IDAT = _PNG_BEFORE_PLTE | _PNG_AFTER_PLTE | {b"eXIf", b"pHYs", b"sPLT"}
_PNG_SINGLETONS = (_PNG_BEFORE_IDAT - {b"sPLT"}) | {b"tIME", b"IHDR", b"PLTE"}
_PNG_CHUNK_NAME = re.compile(rb"[A-Za-z]{2}[A-Z][A-Za-z]")
_PNG_INFLATE_BLOCK = 64 * 1024


def _png_scanline_bytes(width: int, height: int, bits_per_pixel: int, interlace: int) -> int:
    passes = _PNG_ADAM7 if interlace else ((0, 0, 1, 1),)
    total = 0
    for x, y, step_x, step_y in passes:
        columns = (width - x + step_x - 1) // step_x
        rows = (height - y + step_y - 1) // step_y
        if columns > 0 and rows > 0:
            total += rows * (1 + (columns * bits_per_pixel + 7) // 8)
    return total


class _PngZlib:
    """Count bounded zlib output and require the end marker and Adler-32."""

    def __init__(self, limit: int, label: str, limit_code: str):
        self.limit = limit
        self.label = label
        self.limit_code = limit_code
        self.count = 0
        self.stream = zlib.decompressobj()

    def _invalid(self, reason: str) -> UvttParseError:
        return UvttParseError("/image", "invalid_image", f"PNG {self.label}: {reason}")

    def _consume(self, data: bytes | memoryview) -> None:
        if self.stream.eof and data:
            raise self._invalid("data after the zlib stream")
        while True:
            try:
                # Keep memory bounded even for a very compressible row stream.
                output = self.stream.decompress(data, min(_PNG_INFLATE_BLOCK, self.limit - self.count + 1))
            except zlib.error as exc:
                raise self._invalid("invalid zlib stream or Adler-32 checksum") from exc
            self.count += len(output)
            if self.count > self.limit:
                raise UvttParseError("/image", self.limit_code, f"PNG {self.label}: inflated size exceeds its limit")
            if self.stream.unused_data:
                raise self._invalid("data after the zlib stream")
            data = self.stream.unconsumed_tail
            if not data:
                return

    def feed(self, data: memoryview) -> None:
        for start in range(0, len(data), _PNG_INFLATE_BLOCK):
            self._consume(data[start:start + _PNG_INFLATE_BLOCK])

    def finish(self) -> int:
        # A capped inflate call can leave pending output in zlib without input.
        while not self.stream.eof:
            previous = self.count
            self._consume(b"")
            if self.count == previous and not self.stream.eof:
                raise self._invalid("incomplete zlib stream")
        return self.count


def _png_metadata_stream(kind: bytes, payload: memoryview) -> memoryview | None:
    if kind not in (b"iCCP", b"zTXt", b"iTXt"):
        return None
    # Locate the metadata prefix without copying the compressed payload.
    separator = next((i for i, byte in enumerate(payload[:80]) if byte == 0), -1)
    if separator < 1 or separator + 1 >= len(payload):
        raise UvttParseError("/image", "invalid_image", "Invalid PNG metadata header")
    start = separator + 2
    method = payload[separator + 1]
    if kind == b"iTXt":
        compression_flag = method
        if start >= len(payload) or compression_flag not in (0, 1):
            raise UvttParseError("/image", "invalid_image", "Invalid PNG iTXt compression flag")
        method = payload[start]
        start += 1
        for _ in range(2):  # language tag and translated keyword
            while start < len(payload) and payload[start] != 0:
                start += 1
            if start == len(payload):
                raise UvttParseError("/image", "invalid_image", "Invalid PNG iTXt text header")
            start += 1
        if compression_flag == 0:
            return None  # Uncompressed text is covered by the ancillary byte budget.
    if method != 0:
        raise UvttParseError("/image", "invalid_image", "Unsupported PNG metadata compression method")
    return payload[start:]


def _png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 33 or data[8:16] != b"\x00\x00\x00\x0dIHDR":
        raise _Invalid("/image", "Invalid PNG header")
    width, height, depth, color, compression, filter_method, interlace = struct.unpack_from(">IIBBBBB", data, 16)
    size = _bounded_raster_size(width, height)
    if (depth not in _PNG_DEPTHS.get(color, ()) or compression != 0 or filter_method != 0
            or interlace not in (0, 1)):
        raise UvttParseError("/image", "invalid_image", "Unsupported PNG image header")
    expected_size = _png_scanline_bytes(width, height, depth * _PNG_CHANNELS[color], interlace)
    image_stream = _PngZlib(expected_size, "IDAT", "invalid_image")

    view = memoryview(data)
    offset, chunks = 8, 0
    ancillary_bytes = inflated_metadata = 0
    seen: set[bytes] = set()
    previous_kind = b""
    while offset + 12 <= len(data):
        length = int.from_bytes(view[offset:offset + 4], "big")
        kind = data[offset + 4:offset + 8]
        crc_start = offset + 8 + length
        end = crc_start + 4
        chunks += 1
        if chunks > MAX_IMAGE_CHUNKS:
            raise UvttParseError("/image", "image_chunks", "Image chunk budget exceeded")
        if end > len(data):
            break
        if not _PNG_CHUNK_NAME.fullmatch(kind):
            raise UvttParseError("/image", "invalid_image", "Invalid PNG chunk name")
        if kind in _PNG_ANIMATION:
            raise _Invalid("/image", "Animated images are unsupported")
        if kind[:1].isupper() and kind not in _PNG_CRITICAL:
            raise UvttParseError("/image", "invalid_image", "Unknown critical PNG chunk")
        expected_crc = int.from_bytes(view[crc_start:end], "big")
        if binascii.crc32(view[offset + 4:crc_start]) != expected_crc:
            raise UvttParseError("/image", "invalid_image", "Invalid PNG chunk checksum")
        if kind in _PNG_SINGLETONS and kind in seen:
            raise UvttParseError("/image", "invalid_image", "Duplicate PNG chunk")
        payload = view[offset + 8:crc_start]

        if kind == b"IEND":
            if length or end != len(data):
                raise _Invalid("/image", "Invalid PNG trailer or unexpected trailing data")
            if b"IDAT" not in seen or image_stream.finish() != expected_size:
                raise UvttParseError("/image", "invalid_image", "PNG IDAT does not match the expected scanline size")
            return size
        if kind == b"PLTE":
            max_entries = 1 << depth if color == 3 else 256
            if (b"IDAT" in seen or seen & _PNG_AFTER_PLTE or color in (0, 4)
                    or length % 3 or not 1 <= length // 3 <= max_entries):
                raise UvttParseError("/image", "invalid_image", "Invalid or misplaced PNG palette")
        elif kind == b"IDAT":
            if b"IDAT" in seen and previous_kind != b"IDAT":
                raise UvttParseError("/image", "invalid_image", "PNG IDAT chunks must be consecutive")
            if color == 3 and b"PLTE" not in seen:
                raise UvttParseError("/image", "invalid_image", "Indexed PNG requires a palette before IDAT")
            image_stream.feed(payload)
        elif kind != b"IHDR":
            if ((kind in _PNG_BEFORE_IDAT and b"IDAT" in seen)
                    or (kind in _PNG_BEFORE_PLTE and b"PLTE" in seen)
                    or (kind == b"hIST" and b"PLTE" not in seen)):
                raise UvttParseError("/image", "invalid_image", "Misplaced PNG metadata chunk")
            ancillary_bytes += length
            if ancillary_bytes > MAX_PNG_METADATA_BYTES:
                raise UvttParseError("/image", "png_metadata", "PNG ancillary byte budget exceeded")
            compressed = _png_metadata_stream(kind, payload)
            if compressed is not None:
                remaining = min(MAX_PNG_METADATA_STREAM, MAX_PNG_METADATA_INFLATED - inflated_metadata)
                stream = _PngZlib(remaining, "metadata", "png_metadata")
                stream.feed(compressed)
                inflated_metadata += stream.finish()
        seen.add(kind)
        previous_kind = kind
        offset = end
    raise _Invalid("/image", "Truncated PNG or missing IEND")



def _raster(encoded: object, map_size_px: Point) -> Raster:
    if not isinstance(encoded, str) or not encoded or len(encoded) % 4 or not encoded.isascii():
        raise UvttParseError("/image", "invalid_base64", "Expected a nonempty standard base64 image")
    padding = 2 if encoded.endswith("==") else int(encoded.endswith("="))
    expected_size = len(encoded) // 4 * 3 - padding
    if expected_size > MAX_IMAGE_BYTES:
        raise UvttParseError("/image", "image_bytes", "Decoded image exceeds the byte limit")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise UvttParseError("/image", "invalid_base64", "Invalid standard base64 image") from exc
    if len(data) != expected_size or (padding and
            base64.b64encode(data[-(3 - padding):]).decode("ascii") != encoded[-4:]):
        raise UvttParseError("/image", "invalid_base64", "Invalid base64 padding")

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        image_format: ImageFormat = "PNG"
        size = _png_size(data)
    elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        image_format = "WEBP"
        size = _webp_size(data)
    else:
        raise UvttParseError("/image", "image_format", "Only embedded PNG or WebP is supported")
    if (abs(size[0] - map_size_px.x) > PIXEL_ROUNDING_TOLERANCE
            or abs(size[1] - map_size_px.y) > PIXEL_ROUNDING_TOLERANCE):
        raise UvttParseError("/image", "image_size_mismatch", "Raster size disagrees with map size and grid scale")

    try:
        with Image.open(BytesIO(data), formats=[image_format]) as image:
            if image.size != size or getattr(image, "is_animated", False):
                raise _Invalid("/image", "Unexpected raster dimensions or animation")
            image.load()
    except (OSError, ValueError, SyntaxError, EOFError, struct.error,
            Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise UvttParseError("/image", "invalid_image", "The embedded raster is corrupt") from exc
    return Raster(image_format, *size, data)


class _Normalize:
    def __init__(self):
        self.report: list[Diagnostic] = []

    def record(self, disposition: Disposition, path: str, code: str, reason: str) -> None:
        if len(self.report) >= MAX_REPORT_ENTRIES:
            raise UvttParseError(path, "report_budget", "Diagnostic budget exceeded")
        self.report.append(Diagnostic(disposition, path, code, reason))

    def fields(self, value: dict[str, object], path: str, *known: str) -> None:
        for key in value:
            if key not in known:
                self.record("unknown", _path(path, key), "unknown_field", "No mapping for this extension field")

    def point(self, value: object, path: str, lower: float = -MAX_COORDINATE) -> Point:
        obj = _object(value, path)
        self.fields(obj, path, "x", "y")
        return Point(_number(obj.get("x"), _path(path, "x"), lower),
                     _number(obj.get("y"), _path(path, "y"), lower))

    def resolution(self, value: object) -> Grid:
        path = "/resolution"
        obj = _object(value, path)
        self.fields(obj, path, "map_origin", "map_size", "pixels_per_grid")
        scale_path = _path(path, "pixels_per_grid")
        scale = _number(obj.get("pixels_per_grid"), scale_path, 1, MAX_PIXELS_PER_GRID)
        if obj.get("pixels_per_grid") != int(scale):
            raise _Invalid(scale_path, "Expected a whole number of pixels per grid square")
        origin = self.point(obj.get("map_origin"), _path(path, "map_origin"))
        size = self.point(obj.get("map_size"), _path(path, "map_size"), 0)
        if size.x <= 0 or size.y <= 0:
            raise _Invalid(_path(path, "map_size"), "Map dimensions must be positive")
        return Grid(int(scale), origin, size)

    def pixels(self, value: object, path: str, grid: Grid) -> Point:
        cells = self.point(value, path)
        x = (cells.x - grid.origin_cells.x) * grid.pixels_per_grid
        y = (cells.y - grid.origin_cells.y) * grid.pixels_per_grid
        if max(abs(x), abs(y)) > MAX_COORDINATE:
            raise _Invalid(path, "Image-local coordinate exceeds the pixel range")
        return Point(x, y)

    def wall(self, value: object, path: str, grid: Grid,
             source: Literal["line_of_sight", "objects_line_of_sight"]) -> Wall:
        points = tuple(self.pixels(point, _path(path, i), grid)
                       for i, point in enumerate(_array(value, path)))
        if len(points) < 2:
            raise _Invalid(path, "A wall polyline needs at least two points")
        for index, (start, end) in enumerate(zip(points, points[1:]), 1):
            if start == end:
                raise _Invalid(_path(path, index), "Wall contains a zero-length segment")
        return Wall(source, points)

    def portal(self, value: object, path: str, grid: Grid) -> Portal:
        obj = _object(value, path)
        self.fields(obj, path, "position", "bounds", "closed", "rotation", "freestanding")
        bounds_path = _path(path, "bounds")
        bounds = _array(obj.get("bounds"), bounds_path)
        if len(bounds) != 2:
            raise _Invalid(bounds_path, "Expected two portal endpoints")
        start = self.pixels(bounds[0], _path(bounds_path, 0), grid)
        end = self.pixels(bounds[1], _path(bounds_path, 1), grid)
        if start == end:
            raise _Invalid(bounds_path, "Portal endpoints coincide")
        return Portal(self.pixels(obj.get("position"), _path(path, "position"), grid),
                      (start, end), _boolean(obj.get("closed"), _path(path, "closed")),
                      _optional(obj, "rotation", path, _number),
                      _optional(obj, "freestanding", path, _boolean))

    def light(self, value: object, path: str, grid: Grid) -> Light:
        obj = _object(value, path)
        self.fields(obj, path, "position", "range", "intensity", "color", "shadows")
        range_path = _path(path, "range")
        radius = _number(obj.get("range"), range_path, 0) * grid.pixels_per_grid
        if not 0 < radius <= MAX_COORDINATE:
            raise _Invalid(range_path, "Expected a positive light range within the pixel budget")
        return Light(self.pixels(obj.get("position"), _path(path, "position"), grid), radius,
                     _number(obj.get("intensity"), _path(path, "intensity"), 0),
                     _color(obj.get("color"), _path(path, "color")),
                     _optional(obj, "shadows", path, _boolean))

    def objects(self, values: list[object], path: str,
                parse: Callable[[object, str], T]) -> tuple[T, ...]:
        output = []
        for index, value in enumerate(values):
            item = _path(path, index)
            try:
                output.append(parse(value, item))
            except _Invalid as exc:
                self.record("dropped_invalid", exc.path, "invalid_geometry",
                            f"{exc.reason}. Geometry object {item} was dropped")
        if output:
            self.record("converted", path, "geometry_pixels",
                        "Geometry normalized to image-local pixels")
        elif not values:
            self.record("supported", path, "empty_geometry", "Empty geometry list preserved")
        return tuple(output)

    def metadata_field(self, obj: dict[str, object], key: str, path: str,
                       parse: Callable[[object, str], T]) -> T | None:
        try:
            result = _optional(obj, key, path, parse)
        except _Invalid as exc:
            self.record("dropped_invalid", exc.path, "invalid_metadata", exc.reason)
            return None
        if key in obj:
            self.record("supported", _path(path, key), "metadata_preserved", "Source metadata preserved")
        return result

    def metadata(self, root: dict[str, object], version: Version) -> Metadata:
        software = self.metadata_field(root, "software", "", _string)
        creator = self.metadata_field(root, "creator", "", _string)
        baked = None
        if "environment" in root:
            try:
                environment = _object(root["environment"], "/environment")
            except _Invalid as exc:
                self.record("dropped_invalid", exc.path, "invalid_metadata", exc.reason)
            else:
                self.fields(environment, "/environment", "ambient_light", "baked_lighting")
                baked = self.metadata_field(environment, "baked_lighting", "/environment", _boolean)
                if "ambient_light" in environment:
                    self.record("unsupported", "/environment/ambient_light", "ambient_light",
                                "Scene-wide ambient lighting has no mapping in this import profile")
        return Metadata(version, software, creator, baked)


def parse_uvtt(data: bytes) -> UvttImport:
    """Parse bounded UTF-8 JSON bytes, reporting any partial losses or raising UvttParseError."""
    normalize = _Normalize()
    try:
        root = _object(_read_json(data), "")
        if "format" not in root:
            raise UvttParseError("/format", "missing_version", "The numeric UVTT version is required")
        source_version = root["format"]
        if source_version == Decimal("0.2"):
            version: Version = "0.2"
        elif source_version == Decimal("0.3"):
            version = "0.3"
        else:
            raise UvttParseError("/format", "unsupported_version", "Expected numeric UVTT version 0.2 or 0.3")
        normalize.fields(root, "", "format", "resolution", "image", "software", "creator",
                         "environment", *_GEOMETRY_FIELDS)
        normalize.record("supported", "/format", "version_supported", "UVTT version accepted")
        grid = normalize.resolution(root.get("resolution"))
        normalize.record("supported", "/resolution", "grid_preserved", "Source grid and origin preserved")
        arrays = _geometry_arrays(root)
        walls = tuple(
            wall
            for source in _WALL_FIELDS if source in arrays
            for wall in normalize.objects(
                arrays[source], _path("", source),
                lambda value, path: normalize.wall(value, path, grid, source),
            )
        )
        portals = normalize.objects(
            arrays["portals"], "/portals", lambda value, path: normalize.portal(value, path, grid),
        ) if "portals" in arrays else ()
        lights = normalize.objects(
            arrays["lights"], "/lights", lambda value, path: normalize.light(value, path, grid),
        ) if "lights" in arrays else ()
        metadata = normalize.metadata(root, version)
        declared_px = Point(grid.size_cells.x * grid.pixels_per_grid,
                            grid.size_cells.y * grid.pixels_per_grid)
        if (max(declared_px.x, declared_px.y) > MAX_IMAGE_SIDE + PIXEL_ROUNDING_TOLERANCE
                or round(declared_px.x) * round(declared_px.y) > MAX_IMAGE_PIXELS):
            raise UvttParseError("/resolution/map_size", "image_dimensions", "Declared map exceeds the raster budget")
        if "image" not in root:
            raise UvttParseError("/image", "missing_image", "An embedded image is required")
        image = _raster(root["image"], declared_px)
        normalize.record("converted", "/image", "raster_decoded", "Base64 decoded and static raster verified")
        if declared_px != Point(image.width, image.height):
            normalize.record("converted", "/resolution/map_size", "raster_rounding",
                             "Raster dimensions reconciled with fractional grid dimensions")
    except _Invalid as exc:
        raise UvttParseError(exc.path, "invalid_field", exc.reason) from exc
    report = tuple(normalize.report)
    warnings = tuple(entry for entry in report
                     if entry.disposition in ("unknown", "unsupported", "dropped_invalid"))
    return UvttImport(metadata, grid, image, walls, portals, lights, warnings, report)
