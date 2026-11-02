"""Run the original smoke test using the archive's embedded Python, not the host."""
import asyncio
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
import smoke_test

smoke_test.BASE = os.environ['SMOKE_BASE']
smoke_test.WS = smoke_test.BASE.replace('http://', 'ws://', 1)
raise SystemExit(asyncio.run(smoke_test.main()))
