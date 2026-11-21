from datetime import datetime


def now():
    return datetime.now().astimezone()


def start_of_local_day(dt=None):
    d = dt or now()
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def as_local(dt):
    return dt.astimezone()
