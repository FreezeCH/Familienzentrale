import copy

_MEM: dict = {}


class Store:
    def __init__(self, hass, version, key):
        self.key = key

    async def async_load(self):
        return copy.deepcopy(_MEM.get(self.key))

    def async_delay_save(self, data_func, delay=0):
        _MEM[self.key] = copy.deepcopy(data_func())

    async def async_remove(self):
        _MEM.pop(self.key, None)
