/* Kompletter Funktionstest im Browser gegen tests/dev_server.py.
 * In tests/e2e.html ausführen:  await (await import('/tests/e2e_run.js?' + Date.now())).run()
 * Ergebnis: { ok: [...], fehler: [...] }
 */
export async function run() {
  await fetch("/api/reset", { method: "POST", body: "{}" });
  const el = document.querySelector("familienzentrale-panel");
  await el.backend.load().then((s) => { el.state = s; el.unlockedUntil = 0; el._pinToken = null; el.view = "start"; el.sub = {}; el.render(); });

  const ok = [], fehler = [];
  const check = (name, cond, info) => (cond ? ok : fehler).push(name + (cond || info === undefined ? "" : " → " + JSON.stringify(info)));
  const sr = () => el.shadowRoot;
  const w = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => sr().querySelector(s);
  const qa = (s) => [...sr().querySelectorAll(s)];
  const txt = () => sr().getElementById("root").textContent.replace(/\s+/g, " ");
  const toasts = () => qa(".toast").map((x) => x.textContent);
  const dbg = async () => (await fetch("/api/debug")).json();
  const click = async (s, ms) => { const e = q(s); if (!e) throw new Error("nicht gefunden: " + s); e.click(); await w(ms); return e; };
  const set = (k, v) => { const e = q(`.dlg [data-k='${k}']`); if (!e) throw new Error("Feld fehlt " + k); if (e.type === "checkbox") e.checked = v; else e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); };
  const save = async () => { const b = qa(".dlg [data-b]"); b[b.length - 1].click(); await w(450); };
  const pin = async (p = "0123") => { for (const n of p) q(`[data-n='${n}']`).click(); await w(450); };
  const pinIf = async () => { if (q(".pinpad")) await pin(); };
  const nav = (v) => click(`[data-act=nav][data-v=${v}]`);
  const id = (d, name) => d.data.persons.find((p) => p.name === name).id;
  const todayIso = (() => { const t = new Date(); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); })();
  const wdToday = (new Date().getDay() + 6) % 7;
  const iso7 = (n) => { const t = new Date(Date.now() + n * 86400000); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); };
  const chg = async (sel, v) => { const e = q(sel); if (e.type === "checkbox") e.checked = v; else e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); await w(450); };

  // 1 Erststart
  check("Willkommen ohne Personen", txt().includes("Noch keine Personen"));
  await nav("einstellungen");
  check("Einstellungen ohne PIN offen", txt().includes("entsperrt"));

  // 2 PIN setzen (mit führender Null) -> bleibt entsperrt
  await click("[data-act=newpin]"); set("a", "0123"); set("b", "0123"); await save();
  let d = await dbg();
  check("PIN als Hash gespeichert", d.data.settings.pin && d.data.settings.pin.hash && !JSON.stringify(d.data.settings.pin).includes("0123"));
  check("Nach PIN-Setzen weiter entsperrt", txt().includes("entsperrt"));
  await click("[data-act=lock]");
  check("Sperren", txt().includes("Eltern-PIN geschützt"));
  await click("[data-act=unlock]"); await pin("9999");
  check("Falsche PIN abgelehnt", toasts().includes("Falsche PIN") && !!q(".pinpad"));
  await pin("0123");
  check("Richtige PIN (führende Null) entsperrt", txt().includes("entsperrt"));

  // 3 Personen, Kalender, Einkaufsliste
  const addP = async (name, role, pts, cal) => { await click("[data-act=edit][data-col=persons]:not([data-id])"); await pinIf(); set("name", name); set("role", role); set("points_enabled", pts); if (cal) set("calendar", cal); await save(); };
  await addP("Vater", "erwachsen", false, "calendar.vater");
  await addP("Mutter", "erwachsen", false, "");
  await addP("Kind A", "kind", true, "");
  await addP("Kind B", "kind", true, "");
  d = await dbg();
  check("4 Personen angelegt", d.data.persons.length === 4, d.data.persons.map((p) => p.name));
  await chg("select[data-chg=set][data-k=family_calendar]", "calendar.familie");
  await chg("select[data-chg=mealie][data-k=bring_list]", "todo.zuhause");
  d = await dbg();
  check("Familienkalender und Bring-Liste gespeichert", d.data.settings.family_calendar === "calendar.familie" && d.data.settings.mealie.bring_list === "todo.zuhause");
  const V = id(d, "Vater"), A = id(d, "Kind A"), B = id(d, "Kind B");

  // 4 Startseite + Hell/Dunkel ohne PIN
  await click("[data-act=lock]");
  await nav("start");
  check("Startseite zeigt 4 Personen", qa(".pcol .pname").length === 4);
  check("Termin aus Personenkalender (Vater)", qa(".pcol")[0].textContent.includes("Zahnarzt"));
  check("Familientermin unter 'Alle'", txt().includes("Elternabend"));
  await click("[data-act=theme]"); d = await dbg();
  check("Dunkel ohne PIN", d.data.settings.theme === "dunkel" && !q(".pinpad"));
  await click("[data-act=theme]");

  // 5 Routinen mit Bestätigung, ohne Schritte, an Wochentagen
  await nav("aufgaben");
  const mkR = async (name, persons, steps, approval, days, points) => {
    await click("[data-act=edit][data-col=routines]:not([data-id])"); await pinIf();
    set("name", name);
    qa(".dlg [data-t=persons]").forEach((c) => (c.checked = persons.includes(c.value)));
    for (const s of steps) { q(".dlg [data-addstep]").click(); const row = q(".dlg .steprow:last-child"); row.querySelector("[data-st=name]").value = s[0]; row.querySelector("[data-st=points]").value = s[1]; }
    q(".dlg [data-iconbtn]").click(); await w(50); q(".dlg [data-emoji]").click();
    set("needs_approval", approval); if (points != null) set("points", points);
    for (const x of days) q(`.dlg [data-wd='${x}']`).click();
    await save();
  };
  await mkR("Morgenroutine", [A, B], [["Zähne putzen", 2], ["Bett machen", 3]], true, [], null);
  await mkR("Entsorgen", [V, A], [], false, [wdToday], 5);
  await mkR("Nicht heute", [A], [["X", 1]], false, [(wdToday + 1) % 7], null);
  d = await dbg();
  check("3 Routinen gespeichert", d.data.routines.length === 3);
  check("Symbol aus Liste übernommen", d.data.routines[0].icon === "🦷", d.data.routines[0].icon);
  check("Nur Routinen von heute sichtbar", qa(".routines .card").length === 2, qa(".routines .card").length);
  const r1 = d.data.routines[0], r2 = d.data.routines[1];

  await click("[data-act=lock]").catch(() => {}); el.unlockedUntil = 0; el._pinToken = null; el.render();
  await click(`[data-act=rstep][data-r='${r1.id}'][data-p='${A}'][data-s='${r1.steps[0].id}']`);
  check("Kind hakt ohne PIN ab", !q(".pinpad"));
  d = await dbg();
  check("Schritt wartet auf Bestätigung", d.data.pending.length === 1 && d.data.pending[0].points === 2);
  await click(`[data-act=rstep][data-r='${r2.id}'][data-p='${A}'][data-s='*']`);
  await click(`[data-act=rstep][data-r='${r2.id}'][data-p='${V}'][data-s='*']`);
  d = await dbg();
  check("Routine ohne Schritte: 5 Punkte sofort", d.data.ledger.filter((l) => l.person === A).reduce((s, l) => s + l.delta, 0) === 5);
  check("Erwachsener ohne Punkte bekommt keine", !d.data.ledger.some((l) => l.person === V));

  await nav("start");
  const badge = q(".btn[data-act=nav][data-v=punkte]");
  check("Knopf '🔔 zu bestätigen' auf der Startseite", !!badge && badge.textContent.includes("1 zu bestätigen"), badge && badge.textContent);
  await click(".btn[data-act=nav][data-v=punkte]");
  check("Punkte-Seite zeigt Wartet auf Bestätigung", txt().includes("Wartet auf Bestätigung"));
  await click("[data-act=approve]");
  check("Bestätigen fragt PIN", !!q(".pinpad")); await pin("0123");
  d = await dbg();
  check("Nach Bestätigung 7 Punkte", d.data.ledger.filter((l) => l.person === A).reduce((s, l) => s + l.delta, 0) === 7 && d.data.pending.length === 0);

  // Ablehnen setzt Haken zurück
  await nav("aufgaben");
  await click(`[data-act=rstep][data-r='${r1.id}'][data-p='${B}'][data-s='${r1.steps[1].id}']`);
  await nav("punkte"); await click("[data-act=reject]"); await pinIf();
  d = await dbg();
  const recB = (d.data.routines[0].done || {})[B] || { steps: [] };
  check("Ablehnen entfernt Haken", d.data.pending.length === 0 && !recB.steps.includes(r1.steps[1].id), recB);

  // Rückgängig nach Bestätigung zieht Punkte ab und entfernt Verlauf
  await nav("aufgaben");
  const hBefore = d.data.history.length;
  await click(`[data-act=rstep][data-r='${r1.id}'][data-p='${A}'][data-s='${r1.steps[0].id}']`);
  d = await dbg();
  check("Rückgängig zieht Punkte ab", d.data.ledger.filter((l) => l.person === A).reduce((s, l) => s + l.delta, 0) === 5);
  check("Rückgängig entfernt Verlaufseintrag", d.data.history.length === hBefore - 1, [hBefore, d.data.history.length]);

  // 5b Punkte-Sicherheit: Rücknahme bucht nur echte Gutschriften zurück
  const saldo = async (pid) => (await dbg()).data.ledger.filter((l) => l.person === pid).reduce((s, l) => s + l.delta, 0);
  const sB0 = await saldo(B);
  const tileB = `[data-act=rstep][data-r='${r1.id}'][data-p='${B}'][data-s='${r1.steps[0].id}']`;
  await click(tileB); await click(tileB);
  check("Abhaken + Zurücknehmen vor Bestätigung: Stand unverändert", (await saldo(B)) === sB0 && (await dbg()).data.pending.length === 0);
  await click(tileB); await nav("punkte"); await click("[data-act=approve]"); await pinIf();
  check("Nach Bestätigung +2", (await saldo(B)) === sB0 + 2);
  await nav("aufgaben"); await click(tileB);
  check("Zurücknehmen nach Bestätigung: wieder Ausgangsstand", (await saldo(B)) === sB0);
  await click(tileB); await nav("punkte"); await click("[data-act=reject]"); await pinIf();
  await nav("aufgaben");
  check("Nach Ablehnen nicht abgehakt", !q(tileB).classList.contains("done"));
  check("Nie negativer Stand durch Ablehnen/Zurücknehmen", (await saldo(B)) === sB0);

  // 6 Aufgaben: jeder / gemeinsam / reihum
  const mkT = async (name, persons, mode, points) => { await click("[data-act=edit][data-col=tasks]:not([data-id])"); await pinIf(); set("name", name); qa(".dlg [data-t=persons]").forEach((c) => (c.checked = persons.includes(c.value))); set("mode", mode); set("points", points); await save(); };
  await mkT("Zimmer lüften", [A, B], "jeder", 1);
  await mkT("Geschirrspüler", [V, A], "gemeinsam", 2);
  await mkT("Tisch decken", [A, B], "reihum", 3);
  await click("[data-act=tasktab][data-v=heute]");
  d = await dbg();
  for (const t of d.data.tasks) { const b = q(`.pcol [data-act=done][data-id='${t.id}'][data-p='${A}']`); if (b) { b.click(); await w(400); } }
  d = await dbg();
  const t1 = d.data.tasks[0], t2 = d.data.tasks[1], t3 = d.data.tasks[2];
  check("'jeder': nur Kind A erledigt", t1.done[A] === todayIso && !t1.done[B]);
  check("'gemeinsam': für alle erledigt (Vater sieht ✓)", t2.done["*"] === todayIso && qa(".pcol")[0].textContent.includes("✓"));
  check("'reihum': nächster ist Kind B", t3.rotate_index === 1);

  // 7 Belohnungen
  await nav("punkte");
  const mkW = async (name, cost, appr) => { await click("[data-act=edit][data-col=rewards]:not([data-id])"); await pinIf(); set("name", name); set("cost", cost); set("needs_approval", appr); await save(); };
  await mkW("Eis", 5, true); await mkW("Sticker", 2, false); await mkW("Ausflug", 100, true);
  await click(`[data-act=pp][data-v='${A}']`);
  const red = async (name) => { const c = qa(".rew").find((x) => x.textContent.includes(name)); c.querySelector("[data-act=redeem]").click(); await w(); await save(); };
  d = await dbg(); const saldo0 = d.data.ledger.filter((l) => l.person === A).reduce((s, l) => s + l.delta, 0);
  await red("Eis");
  check("Belohnung mit Bestätigung wartet", (await dbg()).data.pending.some((p) => p.name === "Eis"));
  check("Reservierte Punkte sichtbar ('frei')", qa(".pcol .pts").some((p) => p.textContent.includes("frei")));
  await red("Sticker");
  d = await dbg();
  check("Belohnung ohne Bestätigung sofort abgezogen", d.data.ledger.filter((l) => l.person === A).reduce((s, l) => s + l.delta, 0) === saldo0 - 2);
  check("Zu teure Belohnung gesperrt", qa(".rew").find((x) => x.textContent.includes("Ausflug")).querySelector("[data-act=redeem]").disabled);

  // 8 Kalender
  await nav("kalender");
  const addEv = async (title, who, allday) => { await click("[data-act=addevent]"); await pinIf(); set("title", title); set("person", who); set("date", todayIso); set("allday", allday); set("from", "14:00"); set("to", "15:30"); await save(); };
  await addEv("Velo-Service", V, false);
  await addEv("Ferienbeginn", "", true);
  await addEv("Kinderarzt", A, false);
  d = await dbg();
  check("Termin im Kalender des Vaters", d.calendars["calendar.vater"].some((e) => e.summary === "Velo-Service"));
  check("Ganztägiger Familientermin", d.calendars["calendar.familie"].some((e) => e.summary === "Ferienbeginn"));
  const st = await el.backend.load();
  check("Termin für Kind ohne eigenen Kalender bleibt beim Kind", st.events.some((e) => e.title === "Kinderarzt" && e.person === A), st.events.filter((e) => e.title === "Kinderarzt"));
  el.unlockedUntil = 0; el._pinToken = null;
  const ev = qa(".evc[data-act=event]").find((e) => e.textContent.includes("Velo-Service")); ev.click(); await w();
  qa(".dlg [data-b]")[0].click(); await w(300);
  check("Termin löschen fragt PIN (bleibt offen)", !!q(".pinpad")); await pin("0123"); await w(300);
  d = await dbg();
  check("Termin gelöscht", !d.calendars["calendar.vater"].some((e) => e.summary === "Velo-Service"));
  const n0 = qa(".evc[data-act=event]").length; await click(`[data-act=calfilter][data-v='${A}']`); const n1 = qa(".evc[data-act=event]").length; await click(`[data-act=calfilter][data-v='${A}']`);
  check("Kalenderfilter blendet Person aus", n1 === n0 - 1, [n0, n1]);

  // 8b Serientermine
  await click("[data-act=addevent]"); await pinIf();
  set("title", "Turnen Serie"); set("person", A); set("date", todayIso); set("from", "16:00"); set("to", "17:00");
  set("rr_freq", "WEEKLY"); q(".dlg [data-wd='0']").click(); q(".dlg [data-wd='2']").click(); set("rr_count", 4);
  await save(); await w(300);
  d = await dbg();
  const serie = d.calendars["calendar.familie"].find((e) => e.summary === "Turnen Serie");
  check("Serie angelegt (RRULE)", serie && serie.rrule === "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4", serie);
  let st2 = await el.backend.load();
  let occ = st2.events.filter((e) => e.title === "Turnen Serie");
  check("Serie: 4 Termine sichtbar, alle beim Kind", occ.length === 4 && occ.every((e) => e.person === A && e.rrule), occ.map((e) => e.start));
  await nav("kalender"); await click("[data-act=calnav][data-v='1']");
  const sev = qa(".evc[data-act=event]").find((e) => e.textContent.includes("Turnen Serie"));
  check("Serie im Kalender mit 🔁", sev && sev.textContent.includes("🔁"));
  sev.click(); await w();
  check("Dialog zeigt Wiederholung", (q(".dlg") || {}).textContent.includes("wöchentlich am Mo, Mi"), (q(".dlg") || {}).textContent);
  const btns = qa(".dlg [data-b]").map((b) => b.textContent);
  check("Löschen: nur diesen / ganze Serie", btns.some((x) => x.includes("Nur diesen")) && btns.some((x) => x.includes("Ganze Serie")), btns);
  qa(".dlg [data-b]")[0].click(); await w(400); await pinIf(); await w(300);
  st2 = await el.backend.load(); occ = st2.events.filter((e) => e.title === "Turnen Serie");
  check("Nur diesen gelöscht: 3 übrig", occ.length === 3, occ.length);
  await el.backend.load().then((s3) => { el.state = s3; el.render(); });
  const sev2 = qa(".evc[data-act=event]").find((e) => e.textContent.includes("Turnen Serie")) || (await click("[data-act=calnav][data-v='0']"), qa(".evc[data-act=event]").find((e) => e.textContent.includes("Turnen Serie")));
  sev2.click(); await w(); qa(".dlg [data-b]")[1].click(); await w(400); await pinIf(); await w(300);
  st2 = await el.backend.load();
  check("Ganze Serie gelöscht", !st2.events.some((e) => e.title === "Turnen Serie"));
  await click("[data-act=calnav][data-v='0']");

  // 8b2 CalDAV (z. B. iCloud): Serie im Wörterbuch-Format, kein Löschen
  d = await dbg();
  const mutter = d.data.persons.find((p) => p.name === "Mutter");
  await el.backend.act("save_item", { collection: "persons", item: Object.assign({}, mutter, { calendar: "calendar.icloud" }), _pin: el._pinToken });
  await el.backend.act("add_event", { title: "Yoga", person: mutter.id, allday: false, start: todayIso + "T19:00:00", end: todayIso + "T20:00:00", rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=3", _pin: el._pinToken });
  d = await dbg();
  const yoga = d.calendars["calendar.icloud"].find((e) => e.summary === "Yoga");
  check("CalDAV: Serie als Wörterbuch übergeben", yoga && yoga.rrule_type === "dict", yoga);
  st2 = await el.backend.load();
  const yo = st2.events.filter((e) => e.title === "Yoga");
  check("CalDAV: 3 Termine, Bearbeiten/Löschen über die Verbindung", yo.length === 3 && yo.every((e) => e.can_delete && e.can_edit && e.edit_mode === "caldav"), yo.map((e) => [e.start, e.can_delete, e.edit_mode]));
  el.state = st2; el.render(); await nav("kalender"); el.sub.cal = "woche"; el.sub.calDate = yo[0].start.slice(0, 10); el.render(); await w();
  let yev = qa(".evc[data-act=event]").find((e) => e.textContent.includes("Yoga"));
  yev.click(); await w();
  check("CalDAV: Bearbeiten-Knopf", qa(".dlg [data-b]").some((b) => b.textContent.includes("Bearbeiten")));
  qa(".dlg [data-b]").find((b) => b.textContent.includes("Bearbeiten")).click(); await w(); await pinIf();
  set("title", "Yoga mit Anna"); set("from", "18:30"); set("to", "19:45"); set("scope", "all"); await save(); await w(300);
  d = await dbg();
  const y2 = d.calendars["calendar.icloud"].find((e) => e.uid === yoga.uid);
  check("CalDAV: ganze Serie umbenannt, Uhrzeit verschoben, Datum bleibt", y2.summary === "Yoga mit Anna" && y2.start.includes("18:30") && y2.start.slice(0, 10) === yoga.start.slice(0, 10), y2);
  st2 = await el.backend.load(); el.state = st2; el.render();
  yev = qa(".evc[data-act=event]").find((e) => e.textContent.includes("Yoga mit Anna"));
  yev.click(); await w();
  qa(".dlg [data-b]").find((b) => b.textContent.includes("Nur diesen")).click(); await w(400); await pinIf(); await w(300);
  st2 = await el.backend.load();
  check("CalDAV: einzelnes Vorkommen gelöscht", st2.events.filter((e) => e.title === "Yoga mit Anna").length === 2);
  el.state = st2; el.render();
  await click("[data-act=calnav][data-v='0']");

  // 8b3 Bearbeiten im lokalen Kalender (offizielle HA-Funktion)
  st2 = await el.backend.load();
  const kin = st2.events.find((e) => e.title === "Kinderarzt");
  await el.backend.act("update_event", { id: kin.id, title: "Kinderarzt (Impfung)", person: A, allday: false, start: todayIso + "T15:00:00", end: todayIso + "T15:45:00", description: kin.description, _pin: el._pinToken });
  d = await dbg();
  const kin2 = d.calendars["calendar.familie"].find((e) => e.uid === kin.uid);
  check("Lokal: Termin geändert, Kind bleibt zugeordnet", kin2.summary === "Kinderarzt (Impfung)" && kin2.start.includes("15:00") && kin2.description.includes("[fz:" + A + "]"), kin2);
  await el.backend.act("update_event", { id: (await el.backend.load()).events.find((e) => e.title === "Kinderarzt (Impfung)").id, title: "Kinderarzt (Impfung)", person: V, allday: false, start: todayIso + "T15:00:00", end: todayIso + "T15:45:00", _pin: el._pinToken });
  d = await dbg();
  check("Lokal: Person mit eigenem Kalender – Termin umgezogen", d.calendars["calendar.vater"].some((e) => e.summary === "Kinderarzt (Impfung)") && !d.calendars["calendar.familie"].some((e) => e.summary === "Kinderarzt (Impfung)"));
  el.state = await el.backend.load(); el.render();

  // 8c Schule & Freizeit
  await nav("schule");
  check("Menüpunkt Schule & Freizeit", txt().includes("Stundenplan") && txt().includes("Sport & Freizeit"));
  await click("[data-act=edit][data-col=timetable]:not([data-id])"); await pinIf();
  set("person", A); set("subject", "Mathe"); q(`.dlg [data-wd='${wdToday}']`).click(); set("start", "08:00"); set("end", "12:00");
  await save();
  d = await dbg();
  check("Lektion gespeichert", d.data.timetable.length === 1 && d.data.timetable[0].days.includes(wdToday));
  check("Stundenplan zeigt Lektion", txt().includes("Mathe") && txt().includes("08:00–12:00"));
  await click("[data-act=schooltab][data-v=freizeit]");
  await click("[data-act=edit][data-col=activities]:not([data-id])"); await pinIf();
  set("name", "Fussball"); qa(".dlg [data-t=persons]").forEach((c) => (c.checked = c.value === A)); q(`.dlg [data-wd='${wdToday}']`).click(); set("start", "17:00"); set("end", "18:30"); set("bring", "Schienbeinschoner");
  await save();
  await click("[data-act=edit][data-col=activities]:not([data-id])"); await pinIf();
  set("name", "Klavier"); qa(".dlg [data-t=persons]").forEach((c) => (c.checked = c.value === A)); q(`.dlg [data-wd='${wdToday}']`).click(); set("start", "15:00"); set("every_weeks", 2);
  set("first", iso7(-7)); await save();
  d = await dbg();
  check("2 Aktivitäten gespeichert", d.data.activities.length === 2);
  check("Wochenübersicht zeigt Fussball", txt().includes("Diese Woche") && txt().includes("Fussball"));
  await nav("start");
  const colA = () => qa(".pcol").find((c) => c.querySelector(".pname").textContent === "Kind A").textContent;
  check("Startseite: Schule bis 12:00", colA().includes("Schule bis 12:00"), colA());
  check("Startseite: Fussball mit Mitnehmen", colA().includes("Fussball") && colA().includes("Schienbeinschoner"));
  check("Alle 2 Wochen: Klavier diese Woche nicht", !colA().includes("Klavier"));
  await nav("kalender");
  check("Kalender zeigt Aktivität", qa(".day.today .evc").some((e) => e.textContent.includes("Fussball")));
  await nav("schule"); await click("[data-act=schooltab][data-v=ferien]");
  await click("[data-act=edit][data-col=holidays]:not([data-id])"); await pinIf();
  set("name", "Herbstferien"); set("from", iso7(-1)); set("to", iso7(3)); await save();
  check("Ferien-Hinweis", txt().includes("Zurzeit") && txt().includes("Herbstferien"));
  await nav("start");
  check("In den Ferien: keine Schule, Fussball pausiert", !colA().includes("Schule bis") && !colA().includes("Fussball"), colA());
  d = await dbg();
  await el.backend.act("delete_item", { collection: "holidays", id: d.data.holidays[0].id, _pin: el._pinToken });
  await el.backend.load().then((s3) => { el.state = s3; el.render(); });

  // 9 Einkauf
  await nav("einkauf");
  q("#shopin").value = "Butter"; await click("[data-act=shopadd]", 450);
  q("#shopin").value = "Eier"; q("#shopin").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await w(450);
  q("#shopin").value = "milch"; await click("[data-act=shopadd]", 450);
  d = await dbg();
  const bring = d.todo["todo.zuhause"].map((i) => i.summary);
  check("Hinzufügen mit ＋ und Enter landet in Bring", bring.includes("Butter") && bring.includes("Eier"), bring);
  check("Doppelter Eintrag mit Hinweis verhindert", toasts().some((t) => t.includes("steht schon")) && bring.filter((x) => x.toLowerCase() === "milch").length === 1);
  await click("[data-act=shopdone]", 450);
  d = await dbg();
  check("Abhaken setzt Bring-Eintrag auf erledigt", d.todo["todo.zuhause"].some((i) => i.status === "completed"));

  // 10 Essen mit Mealie
  const otherIso = (() => { const t = new Date(Date.now() + ((new Date().getDay() + 6) % 7 === 0 ? 1 : -1) * 86400000); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); })();
  await nav("essen");
  check("Essen: Quelle Mealie angezeigt", txt().includes("aus Mealie"), txt().slice(0, 200));
  const cellSel = (dd, sl) => `.meal[data-d='${dd}'][data-s='${sl}']`;
  const pick = async (dd, sl, query, name) => {
    q(cellSel(dd, sl)).click(); await w(500);
    q("#rq").value = query; q("#rq").dispatchEvent(new Event("input", { bubbles: true })); await w(700);
    const b = qa("#rl [data-rid]").find((x) => x.dataset.name === name);
    if (!b) throw new Error("Rezept nicht in Suche: " + name + " / " + q("#rl").textContent);
    b.click(); await w(700);
  };
  q(cellSel(todayIso, "abend")).click(); await w(600);
  check("Rezeptsuche zeigt Mealie-Rezepte", qa("#rl [data-rid]").length === 4, qa("#rl [data-rid]").length);
  q("#rq").value = "bolo"; q("#rq").dispatchEvent(new Event("input", { bubbles: true })); await w(700);
  check("Suche filtert", qa("#rl [data-rid]").length === 1);
  qa("#rl [data-rid]")[0].click(); await w(700);
  d = await dbg();
  check("Rezept in Mealie eingetragen (Abendessen)", d.mealie.length === 1 && d.mealie[0].type === "dinner" && d.mealie[0].recipe === "Spaghetti Bolognese" && d.mealie[0].date === todayIso, d.mealie);
  check("Essensplan zeigt das Rezept", q(cellSel(todayIso, "abend")).textContent.includes("Spaghetti"));
  await pick(todayIso, "abend", "", "Gemüsecurry");
  d = await dbg();
  check("Ersetzen: alter Eintrag gelöscht, neuer eingetragen", d.mealie.length === 1 && d.mealie[0].recipe === "Gemüsecurry", d.mealie);
  await pick(otherIso, "abend", "", "Spaghetti Bolognese");
  q(cellSel(todayIso, "mittag")).click(); await w(500); q("#rq").value = "Resten"; { const b = qa(".dlg [data-b]"); b[b.length - 1].click(); } await w(700);
  d = await dbg();
  check("Freitext als Mealie-Notiz", d.mealie.some((x) => x.type === "lunch" && x.title === "Resten" && !x.recipe), d.mealie);
  q(cellSel(todayIso, "mittag")).click(); await w(500); qa(".dlg [data-b]")[0].click(); await w(700);
  d = await dbg();
  check("Leeren löscht in Mealie", !d.mealie.some((x) => x.type === "lunch"), d.mealie);
  check("Startseite zeigt Essen heute", (await (async () => { await nav("start"); return txt().includes("Gemüsecurry"); })()));
  await nav("essen");
  await click("[data-act=weekbring]", 900);
  const ingr = qa(".dlg .task").map((x) => x.textContent.replace(/\s+/g, " "));
  check("Zutaten der Woche mit Mengen", ingr.some((x) => x.includes("Spaghetti") && x.includes("500 g")) && ingr.some((x) => x.includes("Zwiebel") && /Zwiebel\s*3(?!\d)/.test(x)), ingr);
  await save(); await w(400);
  d = await dbg();
  const zu = d.todo["todo.zuhause"];
  check("Zutaten in Bring mit Menge als Beschreibung", zu.some((i) => i.summary === "Spaghetti" && i.description === "500 g") && zu.some((i) => i.summary === "Salz und Pfeffer"), zu);
  // Personenzahl: Bolognese (Rezept für 4) für 6 Personen
  q(cellSel(otherIso, "abend")).click(); await w(500);
  check("Essens-Dialog zeigt Personenzahl", q("#svn") && q("#svn").textContent === "4");
  q(".dlg [data-sv='1']").click(); q(".dlg [data-sv='1']").click(); await w(50);
  { const b = qa(".dlg [data-b]"); b[b.length - 1].click(); } await w(700);
  d = await dbg();
  check("Personenzahl gespeichert", d.data.meal_servings[otherIso + "|abend"] === 6, d.data.meal_servings);
  check("Zelle zeigt 👥6", q(cellSel(otherIso, "abend")).textContent.includes("👥6"));
  const six = await el.backend.act("recipe_ingredients", { entries: [{ recipe_id: "r-bolo", servings: 6 }] });
  check("Mengen hochgerechnet (6 statt 4 Personen)", (six.items || []).some((i) => i.name === "Spaghetti" && i.spec === "750 g") && six.items.some((i) => i.name === "Hackfleisch" && i.spec === "600 g") && six.items.some((i) => i.name === "Zwiebel" && i.spec === "1,5"), six.items);
  await nav("einstellungen"); if (q("[data-act=unlock]")) { await click("[data-act=unlock]"); await pin(); }
  await chg("input[data-chg=servings]", "2");
  d = await dbg();
  check("Standard-Personenzahl einstellbar", d.data.settings.mealie.servings === 2);
  const two = await el.backend.act("recipe_ingredients", { recipe_ids: ["r-bolo"] });
  check("Standard 2 Personen: halbe Menge", (two.items || []).some((i) => i.name === "Spaghetti" && i.spec === "250 g"), two.items);
  await chg("input[data-chg=servings]", "4");
  await nav("essen");

  // Gleiches Rezept zweimal geplant: Mengen doppelt
  const twice = await el.backend.act("recipe_ingredients", { recipe_ids: ["r-curry", "r-curry"] });
  check("Zweimal geplant: doppelte Menge", (twice.items || []).some((i) => i.name === "Reis" && i.spec === "500 g"), twice.items);

  // Freitext-Zutaten, Grundzutaten, kein Doppel bei mehrfachem Senden
  const fx = await el.backend.act("recipe_ingredients", { recipe_ids: ["r-voressen"] });
  const fxn = (fx.items || []).map((i) => i.name + "|" + i.spec);
  check("Freitext-Zutaten zerlegt, reine Mengen weggelassen", fxn.includes("Schnittlauch|1 Bund, fein geschnitten + zum Garnieren") && !fxn.some((x) => x.startsWith("200 g")) && fxn.includes("Salz, Pfeffer|"), fxn);
  const before = (await dbg()).todo["todo.zuhause"].length;
  await Promise.all([el.backend.act("send_to_bring", { items: fx.items }), el.backend.act("send_to_bring", { items: fx.items })]);
  await el.backend.act("send_to_bring", { items: fx.items });
  d = await dbg();
  const sch = d.todo["todo.zuhause"].filter((i) => i.summary === "Schnittlauch").length;
  check("Mehrfach senden: keine Doppel-Einträge", sch === 1 && d.todo["todo.zuhause"].length === before + 2, [sch, before, d.todo["todo.zuhause"].length]);
  await nav("essen"); await click("[data-act=weekbring]", 900);
  const salz = qa(".dlg .task").find((x) => x.textContent.includes("Salz und Pfeffer"));
  check("Grundzutat (Salz) nicht vorausgewählt", salz && !salz.querySelector("input").checked);
  q(".dlg [data-b]").click(); await w();

  // Automatisch
  await nav("einstellungen"); if (q("[data-act=unlock]")) { await click("[data-act=unlock]"); await pin(); }
  await chg("select[data-chg=mealie][data-k=to_bring]", "auto");
  await chg("[data-chg=slot][data-v=nachtisch]", true);
  d = await dbg();
  check("Gerichtstyp Nachtisch eingeschaltet", d.data.settings.mealie.slots.includes("nachtisch"));
  await nav("essen");
  check("Zeile Nachtisch sichtbar", txt().includes("Nachtisch"));
  await pick(otherIso, "fruehstueck", "bircher", "Birchermüesli");
  d = await dbg();
  check("Automatisch: Zutaten sofort in Bring", d.todo["todo.zuhause"].some((i) => i.summary === "Haferflocken") && toasts().some((t) => t.includes("Zutaten an Bring")));
  await nav("einstellungen"); await chg("select[data-chg=mealie][data-k=to_bring]", "button");
  // Ältere Oberfläche (nur Slug) und Notizen mit Rezeptnamen
  await el.act("set_meal", { date: otherIso, slot: "mittag", meal: { name: "Gemüsecurry", recipe: "gemuesecurry" } });
  d = await dbg();
  check("Nur Slug: Rezept-ID wird nachgeschlagen", d.mealie.some((x) => x.type === "lunch" && x.recipe === "Gemüsecurry"), d.mealie);
  const byName = await el.backend.act("recipe_ingredients", { recipe_ids: [], names: ["spaghetti bolognese", "Unbekannt"] });
  check("Notiz mit Rezeptnamen liefert Zutaten", (byName.items || []).some((i) => i.name === "Spaghetti"), byName);
  check("Kein Versionshinweis bei gleicher Version", !txt().includes("neue Version"));

  // Ohne Mealie: lokaler Plan
  await fetch("/api/mealie_off", { method: "POST", body: "{}" });
  await el.backend.load().then((s2) => { el.state = s2; el.render(); });
  await nav("essen");
  check("Ohne Mealie: Hinweis", txt().includes("nicht eingerichtet"));
  q(cellSel(todayIso, "abend")).click(); await w(500);
  check("Ohne Mealie: Hinweis in der Suche", q("#rl").textContent.includes("nicht eingerichtet"));
  q("#rq").value = "Pizza"; { const b = qa(".dlg [data-b]"); b[b.length - 1].click(); } await w(600);
  d = await dbg();
  check("Ohne Mealie: Freitext lokal gespeichert", d.data.meals[todayIso] && d.data.meals[todayIso].abend && d.data.meals[todayIso].abend.name === "Pizza");

  // 11 Wartung
  await nav("wartung");
  await click("[data-act=edit][data-col=maintenance]:not([data-id])"); await pinIf();
  set("name", "Rauchmelder prüfen"); set("every", 1); set("unit", "jahre"); set("warn_days", 14); set("next", todayIso); await save();
  await click("[data-act=maintdone]"); check("Wartung fragt wer", !!q(".who")); q(".who [data-pid]").click(); await w(450);
  d = await dbg();
  check("Wartung: nächster Termin in 1 Jahr", d.data.maintenance[0].next === (Number(todayIso.slice(0, 4)) + 1) + todayIso.slice(4));

  // 12 Müll
  await nav("muell");
  await click("[data-act=edit][data-col=waste]:not([data-id])"); await pinIf();
  const nextWd = (wdToday + 2) % 7;
  set("name", "Grüntonne"); set("rule.weekday", String(nextWd)); set("rule.every_weeks", 2); set("rule.start", todayIso); await save();
  const rows = qa(".card .list .row").map((r) => r.textContent);
  check("Müll: erster Termin in 2 Tagen", rows[0] && rows[0].includes("in 2 Tagen"), rows);
  check("Müll: kein doppeltes Datum", rows.every((r) => (r.match(/\d+\. \w+\./g) || []).length === 1), rows);

  // 13 Löschen
  await nav("aufgaben"); await click("[data-act=tasktab][data-v=alle]");
  qa("[data-act=edit][data-col=routines][data-id]").slice(-1)[0].click(); await w(); await pinIf();
  qa(".dlg [data-b]")[0].click(); await w();
  check("Löschen fragt nach", (q(".dlg") || {}).textContent && q(".dlg").textContent.includes("wirklich löschen"));
  qa(".dlg [data-b]")[1].click(); await w(450);
  d = await dbg();
  check("Routine gelöscht", d.data.routines.length === 2);

  // 14 Einstellungen
  await nav("einstellungen"); if (q("[data-act=unlock]")) { await click("[data-act=unlock]"); await pin("0123"); }
  await chg("[data-chg=module][data-v=wartung]", false);
  check("Modul ausblenden", !qa(".rail [data-act=nav]").some((b) => b.dataset.v === "wartung"));
  await chg("[data-chg=module][data-v=wartung]", true);
  await click("[data-act=frametest]"); check("Bilderrahmen startet", !!sr().querySelector(".frame"));
  sr().querySelector(".frame").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); await w();
  check("Bilderrahmen endet bei Berührung", !sr().querySelector(".frame"));

  // 15 Neustart: Daten bleiben, PIN wird neu verlangt und Aktion ausgeführt
  await fetch("/api/reload", { method: "POST", body: "{}" });
  await chg("input[data-chg=framenum][data-k=idle_min]", "7");
  check("Nach Neustart: PIN-Abfrage statt Fehler", !!q(".pinpad")); await pin("0123"); await w(300);
  d = await dbg();
  check("Nach Neustart: Aktion nach PIN ausgeführt", d.data.settings.frame.idle_min === 7);
  check("Nach Neustart: Daten vorhanden", d.data.persons.length === 4 && d.data.tasks.length === 3);

  return { ok: ok.length, fehler, details: ok };
}
