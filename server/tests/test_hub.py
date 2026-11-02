import asyncio
from types import SimpleNamespace
from app.hub import Hub


def test_failed_send_closes_socket_without_losing_other_clients():
    class Peer:
        def __init__(self, fail=False):
            self.fail, self.received, self.closed = fail, [], None
        async def send_json(self, message):
            if self.fail:
                raise OSError("broken transport")
            self.received.append(message)
        async def close(self, code):
            self.closed = code
    async def scenario():
        hub = Hub()
        dead, live = Peer(True), Peer()
        actor = SimpleNamespace(name="Tester")
        await hub.join("scene", dead, actor)
        await hub.join("scene", live, actor)
        event = {"type": "event", "seq": 4, "name": "fog.updated", "payload": {"fog": []}}
        await hub.broadcast("scene", event)
        assert dead.closed == 1011
        assert live.received == [event]
        assert [ws for _, ws, _ in hub.connections()] == [live]
    asyncio.run(scenario())
