class _Entry:
    def __init__(self, platform):
        self.platform = platform


class _Registry:
    def __init__(self, hass):
        self.hass = hass

    def async_get(self, entity_id):
        p = self.hass.platforms.get(entity_id)
        return _Entry(p) if p else None


def async_get(hass):
    return _Registry(hass)
