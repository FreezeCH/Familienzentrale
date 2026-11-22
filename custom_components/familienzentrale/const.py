"""Konstanten der Familienzentrale."""

DOMAIN = "familienzentrale"
VERSION = "0.5.1"

STORAGE_KEY = "familienzentrale.daten"
STORAGE_VERSION = 1

PANEL_URL = "familienzentrale"
PANEL_TITLE = "Familienzentrale"
PANEL_ICON = "mdi:home-heart"
PANEL_ELEMENT = "familienzentrale-panel"
STATIC_URL = "/familienzentrale_static"

EVENT_TASK_DONE = "familienzentrale_aufgabe_erledigt"
EVENT_REWARD_REDEEMED = "familienzentrale_belohnung_eingeloest"
EVENT_MAINT_DONE = "familienzentrale_wartung_erledigt"

# Sammlungen, die das Panel über save_item / delete_item bearbeiten darf
COLLECTIONS = ("persons", "tasks", "routines", "rewards", "maintenance", "waste", "timetable", "activities", "holidays")

# Wie lange eine Entsperrung mit der Eltern-PIN gilt (Sekunden)
PIN_UNLOCK_SECONDS = 300

# Kalender: so viele Tage zurück und voraus werden Termine geladen
CAL_DAYS_BACK = 7
CAL_DAYS_AHEAD = 60
