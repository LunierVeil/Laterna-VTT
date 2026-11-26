"""Read-only PB-08C probe for synthetic fixtures. Never called by runtime."""

from contextlib import ExitStack, closing, contextmanager
import hashlib
import json
import os
import stat

ROLES = ("source", "target")
FENCE = ".laterna-upgrade-in-progress"
MAX_RECORD = 16_384


class InvalidEvidence(ValueError):
    pass


def unique_object(items):
    result = dict(items)
    if len(items) != len(result):
        raise InvalidEvidence("duplicate keys")
    return result


@contextmanager
def directory(path, parent=None):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        yield fd
        if not os.path.samestat(os.fstat(fd), os.stat(path, dir_fd=parent, follow_symlinks=False)):
            raise InvalidEvidence("replaced directory")
    finally:
        os.close(fd)


def identity(fd):
    info = os.fstat(fd)
    return [info.st_dev, info.st_ino]


def exists(parent, name):
    try:
        os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return False
    return True


def stamp(info):
    return info.st_dev, info.st_ino, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def read_record(parent, name, fields=None, *, optional=False):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    except FileNotFoundError:
        if optional:
            return None, None
        raise
    with closing(os.fdopen(fd, "rb")) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise InvalidEvidence("unsafe evidence file")
        raw = stream.read(MAX_RECORD + 1)
        if (len(raw) > MAX_RECORD or stamp(info) != stamp(os.fstat(stream.fileno()))
                or stamp(info) != stamp(os.stat(name, dir_fd=parent, follow_symlinks=False))):
            raise InvalidEvidence("oversized or unstable evidence")
    digest = hashlib.sha256(raw).hexdigest()
    if fields is None:
        return None, digest
    record = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    if type(record) is not dict or record.keys() != fields:
        raise InvalidEvidence("unexpected fields")
    return record, digest


def database_identity(parent):
    name = "lanterna.db"
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or not os.path.samestat(info, os.stat(name, dir_fd=parent, follow_symlinks=False))):
            raise InvalidEvidence("unrecognized SQLite file")
        return [info.st_dev, info.st_ino]
    finally:
        os.close(fd)


def _read_state(root, installation_id):
    with ExitStack() as stack:
        root_fd = stack.enter_context(directory(root))
        registry_fd = stack.enter_context(directory("registry", root_fd))
        homes = {role: stack.enter_context(directory(role, root_fd)) for role in ROLES}
        anchors = {role: stack.enter_context(directory(role + "-anchor", root_fd)) for role in ROLES}
        # The caller chooses an explicit trusted fixture root. These device/inode
        # comparisons detect replacement within one boot; they are not volume IDs.
        registration, registry_hash = read_record(
            registry_fd, "registration.json", {"version", "installation", "attempt", "homes", "databases", "anchors", "journal"},
        )
        expected = {
            "version": 1,
            "installation": installation_id,
            "attempt": registration["attempt"],
            "homes": {role: identity(fd) for role, fd in homes.items()},
            "databases": {role: database_identity(fd) for role, fd in homes.items()},
            "anchors": {role: identity(fd) for role, fd in anchors.items()},
            "journal": identity(registry_fd),
        }
        if (not isinstance(registration["attempt"], str) or not registration["attempt"]
                or len({tuple(identity(fd)) for fd in (*homes.values(), *anchors.values(), registry_fd)}) != 5
                or json.dumps(registration, sort_keys=True) != json.dumps(expected, sort_keys=True)):
            raise InvalidEvidence("registration mismatch")
        if exists(registry_fd, "retired.json"):
            raise InvalidEvidence("generation retired or retirement is ambiguous")

        intent, intent_hash = read_record(registry_fd, "intent.json", {"registration", "markers"})
        markers = {role: read_record(fd, FENCE)[1] for role, fd in homes.items()}
        if intent != {"registration": registry_hash, "markers": markers}:
            raise InvalidEvidence("intent mismatch")
        decision, decision_hash = read_record(registry_fd, "decision.json", {"intent", "decision"}, optional=True)
        evidence = {
            role: read_record(fd, "activation.json", {"decision", "role"}, optional=True)[0]
            for role, fd in anchors.items()
        }
        if decision is None:
            if any(value is not None for value in evidence.values()):
                raise InvalidEvidence("confirmation without decision")
            roles = ROLES
            state = "pending"
        else:
            if decision["intent"] != intent_hash or decision["decision"] not in ("COMMIT_TARGET", "ABORT_TO_SOURCE"):
                raise InvalidEvidence("unknown or foreign decision")
            role = "target" if decision["decision"] == "COMMIT_TARGET" else "source"
            other = "source" if role == "target" else "target"
            if evidence[other] is not None:
                raise InvalidEvidence("other role has activation evidence")
            if evidence[role] is None:
                state = role + "-decision"
            elif evidence[role] == {"decision": decision_hash, "role": role}:
                state = role + "-confirmed"
            else:
                raise InvalidEvidence("activation mismatch")
            roles = (role,)
        for role in roles:
            if any(exists(homes[role], "lanterna.db" + suffix) for suffix in ("-journal", "-wal", "-shm")):
                raise InvalidEvidence("SQLite sidecar requires recovery")
        return state


def classify(root, installation_id, requested=None):
    """Describe evidence without granting a role, syncing storage, or opening SQLite."""
    try:
        state = _read_state(root, installation_id)
        return state if requested is None or state == requested + "-confirmed" else "hold"
    except (OSError, ValueError, RecursionError):
        return "hold"
