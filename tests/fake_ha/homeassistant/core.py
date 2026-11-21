from typing import Any


def callback(func):
    return func


class HomeAssistant:  # wird im Testserver durch FakeHass ersetzt
    data: dict[str, Any]
