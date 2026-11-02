"""Ограничение попыток входа - в памяти процесса, без зависимостей.

Через туннель стол открыт всему интернету, а argon2 замедляет перебор,
но не останавливает его. Поэтому: после N неудач за окно - 429 с
Retry-After. Перезапуск сервера счётчики обнуляет - для одного процесса
мастера это приемлемо, Redis ради этого не нужен.
"""

from __future__ import annotations

import time
from collections import deque


class LoginLimiter:
    def __init__(self, max_failures: int, window: float, clock=time.monotonic):
        self.max_failures = max_failures
        self.window = window
        self._clock = clock
        self._failures: dict[str, deque[float]] = {}

    def _recent(self, key: str, now: float) -> deque[float]:
        times = self._failures.get(key)
        if times is None:
            return deque()
        while times and times[0] <= now - self.window:
            times.popleft()
        if not times:
            del self._failures[key]
        return times

    def retry_after(self, *keys: str) -> int | None:
        """Сколько секунд ждать, если хоть один ключ исчерпал попытки."""
        now = self._clock()
        wait = 0.0
        for key in keys:
            times = self._recent(key, now)
            if len(times) >= self.max_failures:
                wait = max(wait, times[0] + self.window - now)
        return int(wait) + 1 if wait > 0 else None

    def fail(self, *keys: str) -> None:
        now = self._clock()
        # Ключи с истёкшими неудачами чистим изредка, а не на каждый запрос:
        # иначе перебор по разным именам раздувал бы словарь бесконечно.
        if len(self._failures) > 10_000:
            for key in list(self._failures):
                self._recent(key, now)
        for key in keys:
            self._failures.setdefault(key, deque()).append(now)

    def reset(self, *keys: str) -> None:
        for key in keys:
            self._failures.pop(key, None)
