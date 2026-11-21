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

  // 10 Essen
  await nav("essen");
  const cell = qa(".meal")[0]; const md = cell.dataset.d, ms = cell.dataset.s; cell.click(); await w(400);
  q("#rq").value = "Birchermüesli"; { const b = qa(".dlg [data-b]"); b[b.length - 1].click(); } await w(450);
  d = await dbg();
  check("Essen als Freitext gespeichert", d.data.meals[md] && d.data.meals[md][ms] && d.data.meals[md][ms].name === "Birchermüesli");

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
