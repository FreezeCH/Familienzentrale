"""Benachrichtigungen: Ruhezeit und Ansage-Adresse. Start: python tests/test_notifier.py"""

import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "fake_ha"))
sys.path.insert(0, os.path.join(HERE, "..", "custom_components", "familienzentrale"))

import notifier  # noqa: E402


def test_quiet():
    q = notifier.in_quiet
    assert q("22:00", "21:00", "07:00") and q("06:59", "21:00", "07:00")
    assert not q("07:00", "21:00", "07:00") and not q("12:00", "21:00", "07:00")
    assert q("13:00", "12:00", "14:00") and not q("14:00", "12:00", "14:00")
    assert not q("12:00", "", "07:00") and not q("12:00", "08:00", "08:00")


def test_tts_url():
    u = notifier.tts_url("tts.google", "Morgen: Grüntonne & Papier", "de")
    assert u.startswith("media-source://tts/tts.google?message=Morgen%3A%20Gr%C3%BCntonne%20%26%20Papier")
    assert u.endswith("&language=de")


if __name__ == "__main__":
    test_quiet()
    test_tts_url()
    print("ok   notifier")
