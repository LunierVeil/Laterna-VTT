import base64
import json
import subprocess
import sys
from pathlib import Path
from io import BytesIO

from PIL import Image

import pytest

from app import uvtt
from app.uvtt import Point, UvttParseError, parse_uvtt


FIXTURES = Path(__file__).parent / "fixtures" / "uvtt"


def raster(size=(16, 12), format="PNG"):
    output = BytesIO()
    Image.new("RGB", size).save(output, format)
    return base64.b64encode(output.getvalue()).decode("ascii")


def point(x, y):
    return {"x": x, "y": y}


def document(version=0.2):
    return {
        "format": version,
        "resolution": {
            "map_origin": point(0, 0),
            "map_size": point(4, 3),
            "pixels_per_grid": 4,
        },
        "image": raster(),
    }


def encode(data):
    return json.dumps(data).encode("utf-8")


def test_uvt_g501_minimal_02():
    result = parse_uvtt((FIXTURES / "UVT-G501.dd2vtt").read_bytes())
    assert result is not None, "A minimal valid UVTT 0.2 file must produce an import result"
    assert result.metadata.version == "0.2"
    assert result.grid.pixels_per_grid == 4
    assert (result.image.width, result.image.height) == (16, 12)
    assert result.walls == result.portals == result.lights == result.warnings == ()


def test_uvt_g502_full_03():
    result = parse_uvtt((FIXTURES / "UVT-G502.uvtt").read_bytes())
    assert result.metadata == uvtt.Metadata("0.3", "Synthetic Fixture", "Laterna VTT", False)
    assert result.grid == uvtt.Grid(20, Point(2.5, -1.25), Point(4.5, 3))
    assert result.size_px == (90, 60)
    assert result.image.format == "WEBP"
    assert result.image.data[8:12] == b"WEBP"
    assert result.walls == (
        uvtt.Wall("line_of_sight", (Point(-5, 0), Point(10, 0), Point(10, 25), Point(-5, 0))),
        uvtt.Wall("objects_line_of_sight", (Point(20, 5), Point(30, 5), Point(30, 15))),
    )
    assert result.portals == (
        uvtt.Portal(Point(20, 25), (Point(10, 25), Point(30, 25)), False, 0, True),
        uvtt.Portal(Point(50, -10), (Point(50, -15), Point(50, -5)), True, None, None),
    )
    assert result.lights == (uvtt.Light(Point(-20, -15), 50, 0.55, (255, 64, 32, 128), False),)
    assert [(d.disposition, d.path) for d in result.warnings] == [
        ("unsupported", "/environment/ambient_light"),
    ]
    assert {d.disposition for d in result.loss_report} == {"supported", "converted", "unsupported"}


def test_uvt_g503_losses_are_located_without_discarding_other_objects():
    data = document(0.3)
    data["ext~/"] = {"arbitrary": True}
    data["resolution"]["map_origin"]["z"] = 0
    data["line_of_sight"] = [
        [point(0, 0), point(0, 0)],
        [point(0, 0), {"x": 1, "y": 2, "elevation": 10}],
    ]
    data["objects_line_of_sight"] = []
    data["portals"] = [{"bounds": [point(0, 0)]}]
    data["lights"] = [{"range": -1}]
    data["creator"] = False
    result = parse_uvtt(encode(data))
    assert result.walls == (uvtt.Wall("line_of_sight", (Point(0, 0), Point(4, 8))),)
    assert result.portals == result.lights == ()
    assert [(d.disposition, d.path) for d in result.warnings] == [
        ("unknown", "/ext~0~1"),
        ("unknown", "/resolution/map_origin/z"),
        ("dropped_invalid", "/line_of_sight/0/1"),
        ("unknown", "/line_of_sight/1/1/elevation"),
        ("dropped_invalid", "/portals/0/bounds"),
        ("dropped_invalid", "/lights/0/range"),
        ("dropped_invalid", "/creator"),
    ]
    assert all(d.reason for d in result.warnings)
    assert any(d.code == "empty_geometry" and d.path == "/objects_line_of_sight"
               for d in result.loss_report)


def test_rounded_fractional_map_size_has_report_entry():
    data = document()
    data["resolution"]["pixels_per_grid"] = 70
    data["resolution"]["map_size"] = point(0.228571, 0.171429)
    result = parse_uvtt(encode(data))
    assert result.size_px == (16, 12)
    assert not result.warnings
    assert any(d.code == "raster_rounding" for d in result.loss_report)


def rejected(raw, code, path=None):
    with pytest.raises(UvttParseError) as failure:
        parse_uvtt(raw)
    diagnostic = failure.value.diagnostic
    assert diagnostic.disposition == "blocking"
    assert diagnostic.code == code
    assert diagnostic.reason
    if path is not None:
        assert diagnostic.path == path


@pytest.mark.parametrize("version", [0.1, 0.4, 1.0, 2, "0.3", True, None])
def test_uvt_g504_unsupported_versions(version):
    rejected(encode(document(version)), "unsupported_version", "/format")


@pytest.mark.parametrize(("key", "code"), [
    ("format", "missing_version"), ("resolution", "invalid_field"), ("image", "missing_image"),
])
def test_uvt_g504_required_root_fields(key, code):
    data = document()
    del data[key]
    rejected(encode(data), code, f"/{key}")


@pytest.mark.parametrize("key", ["map_origin", "map_size", "pixels_per_grid"])
def test_uvt_g504_required_resolution_fields(key):
    data = document()
    del data["resolution"][key]
    rejected(encode(data), "invalid_field", f"/resolution/{key}")


@pytest.mark.parametrize(("field", "value"), [
    ("map_size", {"x": 0, "y": 1}),
    ("map_size", {"x": 1, "y": -1}),
    ("map_size", {"x": 1, "y": True}),
    ("map_origin", {"x": 65_537, "y": 0}),
    ("pixels_per_grid", -1),
    ("pixels_per_grid", 0),
    ("pixels_per_grid", True),
    ("pixels_per_grid", 1.5),
    ("pixels_per_grid", 1025),
])
def test_uvt_g504_invalid_resolution(field, value):
    data = document()
    data["resolution"][field] = value
    rejected(encode(data), "invalid_field")


@pytest.mark.parametrize(("wire", "code"), [
    (b'{"format": 0.2,}', "invalid_json"),
    (b'{"x": ]', "invalid_json"),
    (b'{"x":"before \\"}', "invalid_json"),
    (b'{"x":"\xff"}', "invalid_json"),
    (b'{"x":NaN}', "invalid_number"),
    (b'{"x":Infinity}', "invalid_number"),
    (b'{"x":-Infinity}', "invalid_number"),
    (b'{"x":1e309}', "invalid_number"),
    (b'{"x":1e-330}', "invalid_number"),
    (b'{"x":0,"x":1}', "duplicate_key"),
    (b'{"x":"\\ud800"}', "invalid_string"),
    (b'{"\\udfff":0}', "invalid_key"),
    (b'[]', "invalid_field"),
    (b'{"format":0.200000000000000001}', "unsupported_version"),
])
def test_uvt_g505_malformed_json(wire, code):
    rejected(wire, code)


def test_utf8_bom_and_escaped_field_name():
    wire = encode(document()).replace(b'"image"', b'"im\\u0061ge"')
    assert parse_uvtt(b"\xef\xbb\xbf" + wire).size_px == (16, 12)


@pytest.mark.parametrize("value", ["", "!!!!", "AQ", "AQ==AQ==", "AAAA====", "AB==", "AAB=", "data:image/png;base64,AA==",
                                  "https://example.invalid/map.png", "../../map.png", "💡", None])
def test_uvt_g506_invalid_base64(value):
    data = document()
    data["image"] = value
    rejected(encode(data), "invalid_base64", "/image")


@pytest.mark.parametrize("format", ["GIF", "JPEG"])
def test_uvt_g506_unsupported_raster(format):
    data = document()
    data["image"] = raster(format=format)
    rejected(encode(data), "image_format", "/image")


@pytest.mark.parametrize("options", [{}, {"lossless": True}])
def test_uvt_g506_webp_profiles(options):
    data = document()
    output = BytesIO()
    Image.new("RGBA", (16, 12), (0, 100, 0, 100)).save(output, "WEBP", **options)
    data["image"] = base64.b64encode(output.getvalue()).decode("ascii")
    assert parse_uvtt(encode(data)).image.format == "WEBP"


@pytest.mark.parametrize("format", ["PNG", "WEBP"])
def test_uvt_g506_animated_raster(format):
    output = BytesIO()
    image = Image.new("RGB", (16, 12), "black")
    image.save(output, format, save_all=True, append_images=[Image.new("RGB", image.size, "white")],
               duration=100)
    data = document()
    data["image"] = base64.b64encode(output.getvalue()).decode("ascii")
    rejected(encode(data), "invalid_field", "/image")


def test_uvt_g506_bad_image_data_and_mismatch():
    data = document()
    data["image"] = raster((15, 12))
    rejected(encode(data), "image_size_mismatch", "/image")
    corrupted = bytearray(base64.b64decode(raster()))
    corrupted[45] ^= 1  # IDAT payload, leaving dimensions and chunk framing intact.
    data["image"] = base64.b64encode(corrupted).decode("ascii")
    rejected(encode(data), "invalid_image", "/image")
    bad_iend = bytearray(base64.b64decode(raster()))
    bad_iend[-1] ^= 1
    data["image"] = base64.b64encode(bad_iend).decode("ascii")
    rejected(encode(data), "invalid_image", "/image")
    data["image"] = base64.b64encode(base64.b64decode(raster())[:-5]).decode("ascii")
    rejected(encode(data), "invalid_field", "/image")


def test_uvt_g507_file_budget_exact_boundary(monkeypatch):
    wire = encode(document())
    monkeypatch.setattr(uvtt, "MAX_FILE_BYTES", len(wire))
    assert parse_uvtt(wire).size_px == (16, 12)
    rejected(wire + b" ", "file_size", "")


@pytest.mark.parametrize(("wire", "code"), [
    (b"[" * 17 + b"0" + b"]" * 17, "json_depth"),
    (b"[" + b"0," * 175_000 + b"0]", "json_complexity"),
    (b"9" * 65, "json_token_length"),
    (encode({"k" * 129: 0}), "invalid_key"),
    (encode({"custom": "a" * 4097}), "invalid_string"),
])
def test_uvt_g507_json_budgets(wire, code):
    rejected(wire, code)


def test_uvt_g507_json_limits_allow_exact_boundary():
    data = document()
    data["x" * 128] = "y" * 4096
    value = 0
    for _ in range(15):
        value = [value]
    data["depth"] = value
    result = parse_uvtt(encode(data))
    assert len(result.warnings) == 2


def forbidden(*args, **kwargs):
    pytest.fail("Budget checks must run before decode")


def test_uvt_g507_encoded_and_decoded_budgets_before_decode(monkeypatch):
    data = document()
    data["image"] = "A" * 16
    monkeypatch.setattr(uvtt.base64, "b64decode", forbidden)
    monkeypatch.setattr(uvtt, "MAX_BASE64_CHARS", 12)
    rejected(encode(data), "base64_size", "/image")
    monkeypatch.setattr(uvtt, "MAX_BASE64_CHARS", 16)
    monkeypatch.setattr(uvtt, "MAX_IMAGE_BYTES", 11)
    rejected(encode(data), "image_bytes", "/image")


def test_uvt_g507_geometry_budgets_before_image_decode(monkeypatch):
    data = document()
    data["line_of_sight"] = [[point(0, 0), point(1, 1)]]
    data["portals"] = [{"bounds": [None, None, None]}]
    monkeypatch.setattr(uvtt.base64, "b64decode", forbidden)
    monkeypatch.setattr(uvtt, "MAX_OBJECTS", 1)
    rejected(encode(data), "geometry_objects", "")
    monkeypatch.setattr(uvtt, "MAX_OBJECTS", 2)
    monkeypatch.setattr(uvtt, "MAX_POINTS", 4)
    rejected(encode(data), "geometry_points", "/portals/0")


@pytest.mark.parametrize("format", ["PNG", "WEBP"])
def test_uvt_g507_image_header_limits_before_native_decode(monkeypatch, format):
    data = document()
    data["image"] = raster((17, 12), format)
    monkeypatch.setattr(uvtt.Image, "open", forbidden)
    monkeypatch.setattr(uvtt, "MAX_IMAGE_SIDE", 16)
    rejected(encode(data), "image_dimensions", "/image")
    monkeypatch.setattr(uvtt, "MAX_IMAGE_SIDE", 32)
    monkeypatch.setattr(uvtt, "MAX_IMAGE_PIXELS", 200)
    rejected(encode(data), "image_dimensions", "/image")
    monkeypatch.setattr(uvtt, "MAX_IMAGE_PIXELS", 500)
    monkeypatch.setattr(uvtt, "MAX_IMAGE_CHUNKS", 0)
    rejected(encode(data), "image_chunks", "/image")


def test_uvt_g507_diagnostic_budget_is_explicit(monkeypatch):
    data = document()
    data.update({"custom1": 0, "custom2": 0})
    monkeypatch.setattr(uvtt, "MAX_REPORT_ENTRIES", 1)
    rejected(encode(data), "report_budget", "/custom2")


def test_uvt_g507_local_coordinate_range_and_bad_container():
    data = document()
    data["line_of_sight"] = [
        [point(-16384, 0), point(0, 0)],
        [point(-16385, 0), point(0, 0)],
    ]
    result = parse_uvtt(encode(data))
    assert result.walls == (uvtt.Wall("line_of_sight", (Point(-65536, 0), Point(0, 0))),)
    assert result.warnings[0].path == "/line_of_sight/1/0"
    data["line_of_sight"] = {}
    rejected(encode(data), "invalid_field", "/line_of_sight")


def test_uvt_g508_no_storage_network_or_runtime_dependencies(tmp_path):
    source = (FIXTURES / "UVT-G502.uvtt").read_bytes()
    script = """
import os
import sys

def check(event, arguments):
    if event == 'open':
        flags = arguments[2]
        assert not flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND), event
    assert event not in ('os.mkdir', 'os.remove', 'os.rename', 'sqlite3.connect',
                         'socket.connect', 'socket.getaddrinfo', 'urllib.Request'), event

sys.addaudithook(check)
sys.path.insert(0, sys.argv[1])
from app.uvtt import UvttParseError, parse_uvtt

data = sys.stdin.buffer.read()
assert parse_uvtt(data).metadata.version == '0.3'
try:
    parse_uvtt(data[:-8])
except UvttParseError:
    pass
else:
    raise AssertionError('truncated document accepted')
assert 'app.main' not in sys.modules
assert 'app.config' not in sys.modules
assert 'fastapi' not in sys.modules
assert 'sqlalchemy' not in sys.modules
"""
    run = subprocess.run(
        [sys.executable, "-B", "-c", script, str(Path(__file__).resolve().parents[1])],
        cwd=tmp_path, input=source, capture_output=True, timeout=10,
    )
    assert run.returncode == 0, run.stderr.decode()
    assert list(tmp_path.iterdir()) == []
