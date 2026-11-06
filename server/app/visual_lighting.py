"""PB-03 ephemeral PUBLIC visual sources. Not lighting authorization or persistence."""
from copy import deepcopy
from math import isfinite

from .handlers import CommandError

_settings: dict[str, dict] = {}
MAX_SCENES = 64
MAX_SOURCES = 15


def configure(scene, settings):
    if settings is None:
        _settings.pop(scene.id, None)
        return
    if not isinstance(settings, dict) or settings.get('ambient') not in ('none', 'full'):
        raise CommandError('окружающий свет: none или full')
    sources = settings.get('sources')
    if not isinstance(sources, list) or len(sources) > MAX_SOURCES:
        raise CommandError('не более 15 временных источников')
    normalized = []
    for source in sources:
        if not isinstance(source, dict):
            raise CommandError('неверный источник света')
        values = []
        for key in ('x', 'y', 'radius'):
            value = source.get(key)
            try:
                valid = not isinstance(value, bool) and isinstance(value, (int, float)) and isfinite(float(value))
            except (OverflowError, ValueError):
                valid = False
            if not valid:
                raise CommandError('координаты и радиус: конечные числа')
            values.append(float(value))
        x, y, radius = values
        if not (0 <= x <= scene.width and 0 <= y <= scene.height and radius > 0):
            raise CommandError('источник внутри сцены, радиус больше нуля')
        normalized.append(dict(x=x,y=y,radius=radius))
    if scene.id not in _settings and len(_settings) >= MAX_SCENES:
        raise CommandError('лимит экспериментальных сцен со светом')
    _settings[scene.id] = dict(ambient=settings['ambient'],sources=normalized)


def projection(frame, actor):
    settings = deepcopy(_settings.get(frame.id))
    observers = [t for t in frame.tokens if t.owner_id == actor.id and t.layer != 'gm'
                 and t.system == 'dnd5e' and t.character_owner == actor.id]
    observer = observers[0].id if len(observers) == 1 and not frame.over_budget else None
    return dict(settings=settings,observer_id=observer)


def forget(scene_id):
    _settings.pop(scene_id, None)


def clear():
    _settings.clear()
