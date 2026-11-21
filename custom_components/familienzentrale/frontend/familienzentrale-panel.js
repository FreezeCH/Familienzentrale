/* Familienzentrale – Panel für Home Assistant
 * Klassisches Skript ohne Build-Schritt und ohne Imports, damit es auch auf
 * älteren Geräten (iPadOS 15) und als Vorschau direkt aus einer Datei läuft.
 *
 * Datenquelle:
 *  - In Home Assistant: WebSocket-Befehle familienzentrale/state und familienzentrale/action
 *  - Ohne Home Assistant (Vorschau): MockBackend, Daten im Browser (localStorage)
 */
(function () {
  "use strict";

  // ---------- Hilfsfunktionen ----------
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var iso = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var parse = function (s) { var p = String(s).slice(0, 10).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  var addDays = function (d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  var todayIso = function () { return iso(new Date()); };
  var wd = function (d) { return (d.getDay() + 6) % 7; }; // Montag = 0
  var WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  var WD_LANG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  var MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  var uid = function () { return Math.random().toString(36).slice(2, 10); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var weekStart = function (d) { return addDays(d, -wd(d)); };
  var fmtDate = function (s) { var d = parse(s); return WD[wd(d)] + " " + d.getDate() + ". " + MON[d.getMonth()].slice(0, 3) + "."; };
  var daysBetween = function (a, b) { return Math.round((parse(b) - parse(a)) / 86400000); };
  var addInterval = function (s, every, unit) {
    var d = parse(s);
    every = Number(every) || 1;
    if (unit === "tage") return iso(addDays(d, every));
    if (unit === "wochen") return iso(addDays(d, every * 7));
    if (unit === "monate") { d.setMonth(d.getMonth() + every); return iso(d); }
    if (unit === "jahre") { d.setFullYear(d.getFullYear() + every); return iso(d); }
    return iso(addDays(d, every));
  };
  var textOn = function (hex) {
    var h = String(hex || "#888888").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? "#1b1b1f" : "#ffffff";
  };
  var LOB = [
    "Super gemacht! 🌟", "Klasse, danke dir! 🙌", "Wow, schon erledigt! 🚀", "Du bist spitze! 💪",
    "Danke, das hilft allen! 💛", "Prima! Weiter so! 🎉", "Toll gemacht! 🏆", "Bravo! 👏"
  ];
  var SLOTS = [["fruehstueck", "Frühstück"], ["mittag", "Mittag"], ["abend", "Abend"]];
  var TIMES = [["morgen", "Morgen 🌅"], ["mittag", "Mittag ☀️"], ["abend", "Abend 🌙"]];
  var UNITS = [["tage", "Tage"], ["wochen", "Wochen"], ["monate", "Monate"], ["jahre", "Jahre"]];

  // ---------- Fachlogik (gleich im Python-Backend) ----------
  var Logic = {
    points: function (st, pid) {
      return st.ledger.filter(function (l) { return l.person === pid; }).reduce(function (s, l) { return s + l.delta; }, 0);
    },
    // Verfügbar = Stand minus noch nicht bestätigte Einlösungen (damit nichts doppelt ausgegeben wird)
    available: function (st, pid) {
      return Logic.points(st, pid) + (st.pending || []).filter(function (x) { return x.person === pid && x.points < 0; }).reduce(function (s, x) { return s + x.points; }, 0);
    },
    taskDue: function (t, day) {
      day = day || todayIso();
      var r = t.repeat || { type: "once" };
      if (t.last_done === day) return false;
      if (r.type === "weekly") return (r.days || []).indexOf(wd(parse(day))) >= 0;
      if (r.type === "interval") {
        var base = t.last_done || r.start || day;
        var next = t.last_done ? addInterval(base, r.every, r.unit) : base;
        return next <= day;
      }
      if (r.type === "daily") return true;
      return !t.last_done && (r.date || day) <= day;
    },
    taskDoneToday: function (t) { return t.last_done === todayIso(); },
    taskPerson: function (t, day) {
      var ps = t.persons || [];
      if (t.last_done === todayIso() && t.last_by) return t.last_by;
      if (!ps.length) return null;
      if (!t.rotate) return ps[0];
      var n = t.rotate_index || 0;
      return ps[n % ps.length];
    },
    repeatText: function (r) {
      r = r || {};
      if (r.type === "daily") return "täglich";
      if (r.type === "weekly") return (r.days || []).map(function (i) { return WD[i]; }).join(", ") || "–";
      if (r.type === "interval") return "alle " + r.every + " " + (UNITS.filter(function (u) { return u[0] === r.unit; })[0] || ["", ""])[1] + (r.after_done ? " nach Erledigen" : "");
      if (r.type === "once") return r.date ? "einmalig " + fmtDate(r.date) : "einmalig";
      return "";
    },
    wasteDates: function (w, count, fromDay) {
      var out = [];
      var from = parse(fromDay || todayIso());
      var r = w.rule || {};
      var skip = w.skip_dates || [];
      for (var i = 0; i < 400 && out.length < count + 5; i++) {
        var d = addDays(from, i), s = iso(d);
        if (skip.indexOf(s) >= 0) continue;
        if (r.type === "weekly" && wd(d) === Number(r.weekday)) {
          var every = Number(r.every_weeks) || 1;
          var start = r.start ? weekStart(parse(r.start)) : weekStart(from);
          var weeks = Math.round((weekStart(d) - start) / (7 * 86400000));
          if (weeks >= 0 && weeks % every === 0) out.push(s);
        }
      }
      (w.extra_dates || []).forEach(function (s) { if (s >= iso(from)) out.push(s); });
      out = out.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
      return out.slice(0, count);
    },
    maintStatus: function (m) {
      var t = todayIso();
      if (!m.next) return "ok";
      if (m.next < t) return "ueberfaellig";
      if (daysBetween(t, m.next) <= (Number(m.warn_days) || 0)) return "bald";
      return "ok";
    }
  };

  // ---------- Backends ----------
  function HassBackend(getHass) { this.getHass = getHass; }
  HassBackend.prototype.load = function () { return this.getHass().callWS({ type: "familienzentrale/state" }); };
  HassBackend.prototype.act = function (action, data) {
    return this.getHass().callWS({ type: "familienzentrale/action", action: action, data: data || {} });
  };
  HassBackend.prototype.subscribe = function (cb) {
    return this.getHass().connection.subscribeMessage(cb, { type: "familienzentrale/subscribe" });
  };

  function MockBackend(seed) {
    this.key = "familienzentrale_demo_v3";
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(this.key) || "null"); } catch (e) { saved = null; }
    this.state = saved || JSON.parse(JSON.stringify(seed || DEMO_SEED()));
  }
  MockBackend.prototype.save = function () { try { localStorage.setItem(this.key, JSON.stringify(this.state)); } catch (e) { /* egal */ } };
  MockBackend.prototype.load = function () { return Promise.resolve(this.publicState()); };
  MockBackend.prototype.publicState = function () {
    var s = JSON.parse(JSON.stringify(this.state));
    s.settings.pin_set = !!s.settings.pin;
    delete s.settings.pin;
    return s;
  };
  MockBackend.prototype.reset = function () { try { localStorage.removeItem(this.key); } catch (e) { /* egal */ } };
  MockBackend.prototype.act = function (action, data) {
    var st = this.state, now = new Date().toISOString(), t = todayIso();
    var find = function (col, id) { return (st[col] || []).filter(function (x) { return x.id === id; })[0]; };
    var book = function (pid, delta, reason) { st.ledger.push({ id: uid(), person: pid, delta: delta, reason: reason, ts: now }); };
    switch (action) {
      case "check_pin":
        return Promise.resolve({ ok: !st.settings.pin || data.pin === st.settings.pin });
      case "complete_task": {
        var task = find("tasks", data.task);
        if (!task) break;
        task.last_done = t;
        task.last_by = data.person;
        if (task.rotate) task.rotate_index = (task.rotate_index || 0) + 1;
        st.history.unshift({ id: uid(), kind: "aufgabe", name: task.name, person: data.person, ts: now });
        var p = find("persons", data.person);
        if (task.points && p && p.points_enabled) {
          if (task.needs_approval) st.pending.push({ id: uid(), kind: "aufgabe", ref: task.id, name: task.name, person: data.person, points: task.points, ts: now });
          else book(data.person, task.points, task.name);
        }
        break;
      }
      case "undo_task": {
        var tk = find("tasks", data.task);
        if (tk && tk.last_done === t) {
          // Punkte der heutigen Erledigung wieder abziehen bzw. offene Bestätigung entfernen
          var lp = tk.last_by;
          var pend = st.pending.filter(function (x) { return x.ref === tk.id && x.person === lp; });
          if (pend.length) st.pending = st.pending.filter(function (x) { return pend.indexOf(x) < 0; });
          else if (tk.points && find("persons", lp) && find("persons", lp).points_enabled) book(lp, -tk.points, "↩︎ " + tk.name);
          if (tk.rotate) tk.rotate_index = Math.max(0, (tk.rotate_index || 0) - 1);
          tk.last_done = null; tk.last_by = null;
        }
        break;
      }
      case "redeem": {
        var rw = find("rewards", data.reward);
        if (!rw) break;
        if (Logic.available(st, data.person) < rw.cost) return Promise.reject(new Error("Nicht genug Punkte"));
        if (rw.needs_approval) st.pending.push({ id: uid(), kind: "belohnung", ref: rw.id, name: rw.name, person: data.person, points: -rw.cost, ts: now });
        else book(data.person, -rw.cost, "🎁 " + rw.name);
        break;
      }
      case "approve": {
        var pe = st.pending.filter(function (x) { return x.id === data.id; })[0];
        if (pe) { book(pe.person, pe.points, (pe.kind === "belohnung" ? "🎁 " : "") + pe.name); st.pending = st.pending.filter(function (x) { return x.id !== data.id; }); }
        break;
      }
      case "reject":
        st.pending = st.pending.filter(function (x) { return x.id !== data.id; });
        break;
      case "adjust_points":
        book(data.person, Number(data.delta) || 0, data.reason || "Korrektur");
        break;
      case "save_item": {
        var col = st[data.collection];
        var item = data.item;
        if (!item.id) { item.id = uid(); col.push(item); }
        else { var i = col.findIndex(function (x) { return x.id === item.id; }); if (i >= 0) col[i] = Object.assign(col[i], item); else col.push(item); }
        break;
      }
      case "delete_item":
        st[data.collection] = st[data.collection].filter(function (x) { return x.id !== data.id; });
        break;
      case "save_settings":
        Object.keys(data).forEach(function (k) {
          if (k === "new_pin") { if (data.new_pin) st.settings.pin = data.new_pin; }
          else st.settings[k] = data[k];
        });
        break;
      case "set_meal":
        st.meals[data.date] = st.meals[data.date] || {};
        st.meals[data.date][data.slot] = data.meal;
        if (data.meal && data.meal.recipe && st.settings.mealie.to_bring === "auto") {
          addToBring(st, recipeIngredients(st, data.meal.recipe));
        }
        break;
      case "send_to_bring":
        return Promise.resolve({ added: addToBring(st, data.items || []) }).then(this._done.bind(this));
      case "shopping_add":
        st.shopping.push({ uid: uid(), summary: data.summary, status: "needs_action" });
        break;
      case "shopping_done":
        st.shopping = st.shopping.filter(function (x) { return x.uid !== data.uid; });
        break;
      case "maint_done": {
        var m = find("maintenance", data.id);
        if (!m) break;
        m.last = t;
        m.next = addInterval(t, m.every, m.unit);
        m.history = m.history || [];
        m.history.unshift({ person: data.person, ts: now });
        st.history.unshift({ id: uid(), kind: "wartung", name: m.name, person: data.person, ts: now });
        break;
      }
      case "add_event":
        st.events.push(Object.assign({ id: uid() }, data));
        break;
      case "delete_event":
        st.events = st.events.filter(function (e) { return e.id !== data.id; });
        break;
      case "search_recipes": {
        var q = String(data.query || "").toLowerCase();
        return Promise.resolve({ recipes: st.recipes.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) >= 0; }) });
      }
      default:
        return Promise.reject(new Error("Unbekannte Aktion " + action));
    }
    return Promise.resolve({}).then(this._done.bind(this));
  };
  MockBackend.prototype._done = function (r) { this.save(); if (this.onChange) this.onChange(this.publicState()); return r; };

  function recipeIngredients(st, slug) {
    var r = st.recipes.filter(function (x) { return x.slug === slug; })[0];
    return r ? r.ingredients.slice() : [];
  }
  function addToBring(st, items) {
    var have = st.shopping.map(function (x) { return x.summary.toLowerCase(); });
    var added = 0;
    items.forEach(function (it) {
      if (have.indexOf(it.toLowerCase()) < 0) { st.shopping.push({ uid: uid(), summary: it, status: "needs_action" }); have.push(it.toLowerCase()); added++; }
    });
    return added;
  }

  // ---------- Demodaten (allgemein, ohne echte Personen) ----------
  function DEMO_SEED() {
    var t = new Date();
    var d = function (n) { return iso(addDays(t, n)); };
    var at = function (n, h, m) { return d(n) + "T" + pad(h) + ":" + pad(m || 0) + ":00"; };
    return {
      settings: {
        pin: "1234",
        theme: "hell",
        title: "Familienzentrale",
        modules: { kalender: true, aufgaben: true, punkte: true, essen: true, einkauf: true, wartung: true, muell: true, bilderrahmen: true },
        lock_calendar: true,
        frame: { enabled: true, idle_min: 3, interval_s: 10, night_from: "22:00", night_to: "06:00", media: "media-source://media_source/local/familie" },
        notify: { telegram: "", sonos: [], quiet_from: "21:00", quiet_to: "07:00", waste_time: "19:00", waste_targets: ["telegram", "sonos"] },
        mealie: { to_bring: "button", bring_list: "" }
      },
      persons: [
        { id: "p1", name: "Elternteil 1", color: "#6C5CE7", role: "erwachsen", points_enabled: false, photo: null },
        { id: "p2", name: "Elternteil 2", color: "#00A8A8", role: "erwachsen", points_enabled: false, photo: null },
        { id: "p3", name: "Kind 1", color: "#FF7AA2", role: "kind", points_enabled: true, photo: null },
        { id: "p4", name: "Kind 2", color: "#FFB020", role: "kind", points_enabled: true, photo: null }
      ],
      events: [
        { id: "e1", person: "p3", title: "Turnen", start: at(0, 16, 30), end: at(0, 17, 30) },
        { id: "e2", person: "p1", title: "Zahnarzt", start: at(0, 9, 0), end: at(0, 10, 0) },
        { id: "e3", person: "p4", title: "Kindergeburtstag", start: at(2, 14, 0), end: at(2, 17, 0) },
        { id: "e4", person: "p2", title: "Elternabend", start: at(1, 19, 30), end: at(1, 21, 0) },
        { id: "e5", person: null, title: "Besuch", start: d(5), end: d(6), allday: true },
        { id: "e6", person: "p3", title: "Klavier", start: at(3, 15, 0), end: at(3, 16, 0) }
      ],
      routines: [
        { id: "r1", name: "Morgenroutine", person: "p3", time: "morgen", icon: "🌅" },
        { id: "r2", name: "Abendroutine", person: "p3", time: "abend", icon: "🌙" },
        { id: "r3", name: "Morgenroutine", person: "p4", time: "morgen", icon: "🌅" },
        { id: "r4", name: "Abendroutine", person: "p4", time: "abend", icon: "🌙" }
      ],
      tasks: [
        { id: "t1", name: "Zähne putzen", icon: "🦷", persons: ["p3"], routine: "r1", points: 1, repeat: { type: "daily" } },
        { id: "t2", name: "Anziehen", icon: "👕", persons: ["p3"], routine: "r1", points: 1, repeat: { type: "daily" } },
        { id: "t3", name: "Bett machen", icon: "🛏️", persons: ["p3"], routine: "r1", points: 2, repeat: { type: "daily" } },
        { id: "t4", name: "Schulsachen packen", icon: "🎒", persons: ["p3"], routine: "r2", points: 2, repeat: { type: "weekly", days: [6, 0, 1, 2, 3] } },
        { id: "t5", name: "Zähne putzen", icon: "🦷", persons: ["p3"], routine: "r2", points: 1, repeat: { type: "daily" } },
        { id: "t6", name: "Zähne putzen", icon: "🦷", persons: ["p4"], routine: "r3", points: 1, repeat: { type: "daily" } },
        { id: "t7", name: "Anziehen", icon: "👕", persons: ["p4"], routine: "r3", points: 1, repeat: { type: "daily" } },
        { id: "t8", name: "Spielzeug aufräumen", icon: "🧸", persons: ["p4"], routine: "r4", points: 2, repeat: { type: "daily" } },
        { id: "t9", name: "Pyjama anziehen", icon: "😴", persons: ["p4"], routine: "r4", points: 1, repeat: { type: "daily" } },
        { id: "t10", name: "Tisch decken", icon: "🍽️", persons: ["p3", "p4"], rotate: true, points: 3, repeat: { type: "daily" }, needs_approval: true },
        { id: "t11", name: "Bad putzen", icon: "🛁", persons: ["p1"], points: 0, room: "Bad", repeat: { type: "weekly", days: [5] } },
        { id: "t12", name: "Pflanzen giessen", icon: "🌱", persons: ["p2"], points: 0, repeat: { type: "interval", every: 3, unit: "tage", after_done: true, start: d(0) } },
        { id: "t13", name: "Staubsaugen", icon: "🧹", persons: ["p1", "p2"], rotate: true, points: 0, repeat: { type: "weekly", days: [wd(t)] } }
      ],
      rewards: [
        { id: "w1", name: "30 Min. Bildschirm", icon: "📺", cost: 15, needs_approval: true },
        { id: "w2", name: "Eis", icon: "🍦", cost: 25, needs_approval: true },
        { id: "w3", name: "Länger aufbleiben", icon: "🌙", cost: 40, needs_approval: true },
        { id: "w4", name: "Ausflug wählen", icon: "🎡", cost: 100, needs_approval: true }
      ],
      ledger: [
        { id: "l1", person: "p3", delta: 34, reason: "Startguthaben", ts: d(-7) },
        { id: "l2", person: "p4", delta: 21, reason: "Startguthaben", ts: d(-7) }
      ],
      pending: [],
      history: [],
      meals: (function () {
        var m = {};
        m[d(0)] = { abend: { name: "Spaghetti Bolognese", recipe: "spaghetti-bolognese" } };
        m[d(1)] = { abend: { name: "Gemüsecurry", recipe: "gemuesecurry" } };
        m[d(2)] = { mittag: { name: "Älplermagronen", recipe: "aelplermagronen" } };
        return m;
      })(),
      recipes: [
        { slug: "spaghetti-bolognese", name: "Spaghetti Bolognese", ingredients: ["Spaghetti", "Hackfleisch", "Tomatenpassata", "Zwiebel", "Rüebli", "Parmesan"] },
        { slug: "gemuesecurry", name: "Gemüsecurry", ingredients: ["Kokosmilch", "Currypaste", "Zucchetti", "Peperoni", "Reis"] },
        { slug: "aelplermagronen", name: "Älplermagronen", ingredients: ["Hörnli", "Kartoffeln", "Rahm", "Bergkäse", "Zwiebel", "Apfelmus"] },
        { slug: "pizza", name: "Pizza Margherita", ingredients: ["Pizzateig", "Tomatenpassata", "Mozzarella", "Basilikum"] },
        { slug: "rosti", name: "Rösti mit Spiegelei", ingredients: ["Kartoffeln", "Eier", "Butter"] },
        { slug: "birchermuesli", name: "Birchermüesli", ingredients: ["Haferflocken", "Joghurt", "Äpfel", "Milch"] }
      ],
      calendar_list: [{ entity_id: "calendar.familie", name: "Familie" }],
      ha_persons: [],
      todo_lists: [
        { entity_id: "todo.einkauf", name: "Einkauf (Bring)", platform: "bring" },
        { entity_id: "todo.shopping_list", name: "Einkaufsliste (HA)", platform: "shopping_list" }
      ],
      shopping: [
        { uid: "s1", summary: "Milch", status: "needs_action" },
        { uid: "s2", summary: "Brot", status: "needs_action" },
        { uid: "s3", summary: "Bananen", status: "needs_action" }
      ],
      maintenance: [
        { id: "m1", name: "Rauchmelder testen", icon: "🚨", every: 1, unit: "jahre", warn_days: 14, last: d(-350), next: d(15), note: "" },
        { id: "m2", name: "Kaffeemaschine entkalken", icon: "☕", every: 6, unit: "wochen", warn_days: 3, last: d(-44), next: d(-2), note: "" },
        { id: "m3", name: "Lüftungsfilter wechseln", icon: "🌬️", every: 6, unit: "monate", warn_days: 14, last: d(-100), next: d(80), note: "" },
        { id: "m4", name: "Thermostat-Batterien", icon: "🔋", every: 1, unit: "jahre", warn_days: 30, last: d(-300), next: d(65), note: "" }
      ],
      waste: [
        { id: "a1", name: "Kehricht", icon: "🗑️", color: "#5F6B7A", rule: { type: "weekly", weekday: 1, every_weeks: 1, start: d(0) }, extra_dates: [], skip_dates: [] },
        { id: "a2", name: "Papier", icon: "📰", color: "#2E86DE", rule: { type: "weekly", weekday: 2, every_weeks: 4, start: d(0) }, extra_dates: [], skip_dates: [] },
        { id: "a3", name: "Karton", icon: "📦", color: "#B9770E", rule: { type: "weekly", weekday: 2, every_weeks: 4, start: d(14) }, extra_dates: [], skip_dates: [] },
        { id: "a4", name: "Grüngut", icon: "🌿", color: "#27AE60", rule: { type: "weekly", weekday: 4, every_weeks: 2, start: d(0) }, extra_dates: [], skip_dates: [] }
      ]
    };
  }

  // ---------- Stile ----------
  var CSS = "\
:host{--bg:#f6f4fb;--card:#ffffff;--ink:#1d1b26;--muted:#6b6880;--line:#e6e2f0;--accent:#6c5cE7;--ok:#27ae60;--warn:#f39c12;--bad:#e74c3c;--rail:#ffffff;--shadow:0 2px 10px rgba(40,30,90,.07);\
display:block;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:var(--bg);-webkit-tap-highlight-color:transparent}\
:host([data-theme=dunkel]){--bg:#15131f;--card:#211e30;--ink:#f1eff8;--muted:#a19cb8;--line:#332f47;--rail:#1b1829;--shadow:none}\
*{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer}\
.app{display:flex;height:100vh}\
.rail{width:88px;flex:none;background:var(--rail);border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;padding:10px 0;gap:4px;overflow-y:auto}\
.rail button{width:76px;border:0;background:none;border-radius:14px;padding:8px 2px;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;color:var(--muted)}\
.rail button .i{font-size:24px;line-height:1}\
.rail button.on{background:var(--accent);color:#fff}\
.rail .sp{flex:1}\
.main{flex:1;min-width:0;min-height:0;padding:18px 20px 30px;overflow-y:auto;-webkit-overflow-scrolling:touch}\
.head{display:flex;align-items:baseline;gap:14px;margin-bottom:14px;flex-wrap:wrap}\
.head h1{font-size:26px;margin:0;font-weight:700}\
.head .sub{color:var(--muted);font-size:15px}\
.head .grow{flex:1}\
.clock{font-size:40px;font-weight:700;letter-spacing:-1px}\
.card{background:var(--card);border-radius:18px;box-shadow:var(--shadow);padding:14px 16px;border:1px solid var(--line)}\
.card h3{margin:0 0 10px;font-size:15px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:6px}\
.grid{display:grid;gap:14px}\
.people{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:14px}\
.pcol{border-radius:18px;overflow:hidden;background:var(--card);box-shadow:var(--shadow);border:1px solid var(--line);display:flex;flex-direction:column}\
.pcol .ph{display:flex;align-items:center;gap:10px;padding:12px 14px}\
.pcol .pb{padding:4px 14px 14px;display:flex;flex-direction:column;gap:8px}\
.av{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:19px;flex:none;background-size:cover;background-position:center;border:3px solid rgba(255,255,255,.7)}\
.av.s{width:34px;height:34px;font-size:15px;border-width:2px}\
.av.l{width:76px;height:76px;font-size:30px}\
.pname{font-weight:700;font-size:18px}\
.pts{margin-left:auto;font-weight:700;font-size:15px;background:rgba(255,255,255,.28);padding:4px 10px;border-radius:20px}\
.ev{display:flex;gap:8px;align-items:flex-start;font-size:14px;padding:6px 8px;border-radius:10px;background:var(--bg)}\
.ev .t{font-variant-numeric:tabular-nums;color:var(--muted);min-width:42px}\
.ev .bar{width:4px;align-self:stretch;border-radius:2px}\
.muted{color:var(--muted)}.small{font-size:13px}\
.row{display:flex;align-items:center;gap:10px}\
.task{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:var(--bg);font-size:15px}\
.task .ic{font-size:22px;width:28px;text-align:center}\
.task .nm{flex:1;min-width:0}\
.task.done{opacity:.5}.task.done .nm{text-decoration:line-through}\
.chk{width:34px;height:34px;border-radius:50%;border:2px solid var(--line);background:var(--card);display:flex;align-items:center;justify-content:center;font-size:18px;flex:none}\
.chk.on{background:var(--ok);border-color:var(--ok);color:#fff}\
.prog{height:8px;border-radius:4px;background:var(--line);overflow:hidden}.prog>i{display:block;height:100%;border-radius:4px}\
.bottom{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}\
.btn{border:0;border-radius:12px;padding:10px 16px;background:var(--accent);color:#fff;font-weight:600;font-size:15px}\
.btn.sec{background:var(--bg);color:var(--ink);border:1px solid var(--line)}\
.btn.bad{background:var(--bad)}.btn.ok{background:var(--ok)}\
.btn.sm{padding:6px 10px;font-size:13px;border-radius:10px}\
.pill{display:inline-flex;align-items:center;gap:4px;border-radius:20px;padding:3px 10px;font-size:13px;font-weight:600}\
.list{display:flex;flex-direction:column;gap:8px}\
.tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}\
.tabs button{border:1px solid var(--line);background:var(--card);border-radius:20px;padding:7px 14px;font-size:14px}\
.tabs button.on{background:var(--ink);color:var(--card);border-color:var(--ink)}\
.week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}\
.day{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:8px;min-height:180px;display:flex;flex-direction:column;gap:6px}\
.day.today{border:2px solid var(--accent)}\
.day .dh{font-weight:700;font-size:14px;display:flex;justify-content:space-between}\
.evc{border-radius:8px;padding:5px 7px;font-size:12.5px;line-height:1.25}\
.month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}\
.mc{background:var(--card);border:1px solid var(--line);border-radius:10px;min-height:74px;padding:4px 6px;font-size:12px}\
.mc.other{opacity:.4}.mc.today{border:2px solid var(--accent)}\
.dots{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px}.dots i{width:8px;height:8px;border-radius:50%}\
.routines{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}\
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}\
.tile{border:0;border-radius:18px;padding:14px 8px;background:var(--bg);display:flex;flex-direction:column;align-items:center;gap:6px;font-size:14px;font-weight:600;min-height:120px;justify-content:center;position:relative}\
.tile .ic{font-size:40px}\
.tile.done{background:var(--ok);color:#fff}\
.tile.done:after{content:'✓';position:absolute;top:8px;right:12px;font-size:20px}\
.tile .pt{font-size:12px;font-weight:600;opacity:.75}\
.shop{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}\
.rew{border-radius:16px;padding:14px;background:var(--bg);text-align:center;display:flex;flex-direction:column;gap:6px;align-items:center}\
.rew .ic{font-size:38px}\
.meals{display:grid;grid-template-columns:90px repeat(7,minmax(0,1fr));gap:6px;align-items:stretch}\
.meals .h{font-weight:700;font-size:13px;text-align:center;padding:4px}\
.meals .h.today{color:var(--accent)}\
.meals .sl{font-size:13px;color:var(--muted);display:flex;align-items:center}\
.meal{border:1px dashed var(--line);background:var(--card);border-radius:10px;min-height:56px;padding:6px;font-size:12.5px;text-align:left}\
.meal.set{border-style:solid}\
.status{width:10px;height:10px;border-radius:50%;display:inline-block}\
.empty{color:var(--muted);font-size:14px;padding:6px 2px}\
.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}\
input,select,textarea{font:inherit;font-size:15px;padding:9px 11px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);width:100%}\
input[type=color]{padding:2px;height:40px;width:64px}\
input[type=checkbox]{width:22px;height:22px}\
label.f{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);font-weight:600}\
.ov{position:fixed;inset:0;background:rgba(20,16,40,.45);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}\
.dlg{background:var(--card);color:var(--ink);border-radius:20px;padding:20px;width:min(520px,100%);max-height:90vh;overflow-y:auto;box-shadow:0 20px 50px rgba(0,0,0,.25)}\
.dlg h2{margin:0 0 14px;font-size:20px}\
.dlg .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}\
.form{display:grid;gap:12px}\
.days{display:flex;gap:6px;flex-wrap:wrap}\
.days button{width:42px;height:42px;border-radius:50%;border:1px solid var(--line);background:var(--bg)}\
.days button.on{background:var(--accent);color:#fff;border-color:var(--accent)}\
.who{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}\
.who button{border:0;background:var(--bg);border-radius:16px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:6px;font-weight:600}\
.pinpad{display:grid;grid-template-columns:repeat(3,72px);gap:10px;justify-content:center;margin-top:10px}\
.pinpad button{height:60px;border-radius:14px;border:1px solid var(--line);background:var(--bg);font-size:22px;font-weight:600}\
.pindots{display:flex;justify-content:center;gap:12px;margin:6px 0}.pindots i{width:16px;height:16px;border-radius:50%;border:2px solid var(--muted)}.pindots i.on{background:var(--ink);border-color:var(--ink)}\
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--ink);color:var(--card);padding:12px 20px;border-radius:14px;font-weight:600;z-index:60;box-shadow:0 10px 30px rgba(0,0,0,.25)}\
.lob{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:70;pointer-events:none}\
.lob div{background:var(--card);border-radius:26px;padding:30px 40px;font-size:30px;font-weight:800;box-shadow:0 20px 60px rgba(0,0,0,.3);text-align:center;animation:pop .35s ease-out}\
.lob small{display:block;font-size:16px;font-weight:600;color:var(--muted);margin-top:8px}\
@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}\
.frame{position:fixed;inset:0;z-index:80;background:#000;color:#fff;display:flex;align-items:flex-end;justify-content:flex-end}\
.frame .img{position:absolute;inset:0;background-size:cover;background-position:center;transition:opacity 1.2s}\
.frame .fc{position:relative;padding:28px 36px;text-align:right;text-shadow:0 2px 10px rgba(0,0,0,.6)}\
.frame .fc b{display:block;font-size:64px;font-weight:700;line-height:1}\
.set-sec{margin-bottom:14px}\
.prow{display:flex;align-items:center;gap:12px;padding:10px;border-radius:14px;background:var(--bg);margin-bottom:8px}\
.lock{font-size:13px;color:var(--muted)}\
@media (max-width:760px){\
.app{flex-direction:column-reverse}.rail{width:100%;height:68px;flex:none;flex-direction:row;border-right:0;border-top:1px solid var(--line);padding:4px;overflow-x:auto;overflow-y:hidden}\
.rail button{width:auto;min-width:62px}.rail .sp{display:none}.main{padding:12px}\
.week{grid-template-columns:1fr}.day{min-height:0}.meals{grid-template-columns:70px repeat(7,minmax(90px,1fr));overflow-x:auto}\
.clock{font-size:30px}}\
";

  var NAV = [
    ["start", "🏠", "Start"], ["kalender", "📅", "Kalender"], ["aufgaben", "✅", "Aufgaben"], ["punkte", "⭐", "Punkte"],
    ["essen", "🍽️", "Essen"], ["einkauf", "🛒", "Einkauf"], ["wartung", "🔧", "Wartung"], ["muell", "🗑️", "Müll"]
  ];

  // ---------- Panel ----------
  class FamilienzentralePanel extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.view = "start";
      this.sub = {};
      this.state = null;
      this.unlockedUntil = 0;
      this._idle = null;
      this._frameTimer = null;
    }
    set hass(h) {
      var first = !this._hass;
      this._hass = h;
      if (first && !this.backend) { this.backend = new HassBackend(() => this._hass); this._start(); }
    }
    get hass() { return this._hass; }
    set narrow(v) { var ch = this._narrow !== v; this._narrow = v; if (ch && this.state) this.render(); }
    set panel(p) { this._panel = p; }
    useDemo(seed) { this.backend = new MockBackend(seed); this.backend.onChange = (s) => { this.state = s; this.render(); }; this._start(); }

    connectedCallback() {
      if (!this._boot) {
        this._boot = true;
        this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
        this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
        ["pointerdown", "keydown", "touchstart"].forEach((ev) => this.shadowRoot.addEventListener(ev, () => this._resetIdle(), { passive: true }));
        this._clock = setInterval(() => { var c = this.shadowRoot.querySelector(".clock"); if (c) c.textContent = this._time(); }, 15000);
      }
      if (!this.backend && !window.hassConnection && !this._hass) {
        // Ohne Home Assistant: Vorschau mit Demodaten
        setTimeout(() => { if (!this.backend) this.useDemo(window.FAMILIENZENTRALE_DEMO); }, 50);
      }
    }
    disconnectedCallback() { clearInterval(this._clock); clearTimeout(this._idle); clearInterval(this._frameTimer); if (this._unsub) { try { this._unsub(); } catch (e) { /* egal */ } } }

    _start() {
      this.backend.load().then((s) => { this.state = s; this.render(); this._resetIdle(); }).catch((e) => this._error(e));
      if (this.backend.subscribe) {
        Promise.resolve(this.backend.subscribe((s) => { this.state = s; this.render(); })).then((u) => { this._unsub = u; }).catch(() => { /* altes Backend */ });
      }
    }
    _root() {
      // Grundgerüst einmal anlegen. Dialoge, Meldungen und Bilderrahmen liegen ausserhalb von #root
      // und überleben so jedes Neuzeichnen.
      var r = this.shadowRoot.getElementById("root");
      if (!r) {
        this.shadowRoot.innerHTML = "<style>" + CSS + "</style><div id='root'></div><div id='layer'></div>";
        r = this.shadowRoot.getElementById("root");
      }
      return r;
    }
    _error(e) { this._root().innerHTML = "<div class='main'><div class='card'>⚠️ Familienzentrale: " + esc(e && e.message || e) + "</div></div>"; }
    _time() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
    person(id) { return (this.state.persons || []).filter((p) => p.id === id)[0]; }
    _todoLists() {
      // In HA: alle To-do-Listen aus dem Zustand, sonst die Liste aus dem Backend (Vorschau)
      return this.state.todo_lists || [];
    }
    color(id) { var p = this.person(id); return p ? p.color : "#9aa0ad"; }
    av(p, cls) {
      if (!p) return "<span class='av " + (cls || "") + "' style='background:#ccc'>?</span>";
      var bg = p.photo ? "background-image:url(" + esc(p.photo) + ");" : "background-color:" + esc(p.color) + ";";
      return "<span class='av " + (cls || "") + "' style='" + bg + "color:" + textOn(p.color) + "'>" + (p.photo ? "" : esc(p.name.charAt(0))) + "</span>";
    }
    act(action, data) {
      data = Object.assign({}, data || {});
      if (this._pinToken && Date.now() < this.unlockedUntil) data._pin = this._pinToken;
      return this.backend.act(action, data).then((r) => {
        if (!this.backend.onChange && !this._unsub) return this.backend.load().then((s) => { this.state = s; this.render(); return r; });
        return r;
      }).catch((e) => { this.toast("⚠️ " + (e && e.message || e)); throw e; });
    }

    // ---------- Darstellung ----------
    render() {
      if (!this.state) return;
      var st = this.state, m = st.settings.modules || {};
      this.setAttribute("data-theme", st.settings.theme || "hell");
      var nav = NAV.filter((n) => n[0] === "start" || m[n[0]] !== false);
      if (nav.map((n) => n[0]).indexOf(this.view) < 0 && this.view !== "einstellungen") this.view = "start";
      var body = this["v_" + this.view] ? this["v_" + this.view]() : "";
      var scroll = this.shadowRoot.querySelector(".main");
      var top = scroll ? scroll.scrollTop : 0;
      var menu = this._hass && this._narrow ? "<button data-act='hamenu'><span class='i'>☰</span>Menü</button>" : "";
      this._root().innerHTML = "<div class='app'><nav class='rail'>" + menu +
        nav.map((n) => "<button data-act='nav' data-v='" + n[0] + "' class='" + (this.view === n[0] ? "on" : "") + "'><span class='i'>" + n[1] + "</span>" + n[2] + "</button>").join("") +
        "<span class='sp'></span><button data-act='nav' data-v='einstellungen' class='" + (this.view === "einstellungen" ? "on" : "") + "'><span class='i'>⚙️</span>Einstellungen</button></nav>" +
        "<main class='main'>" + body + "</main></div>";
      var nm = this.shadowRoot.querySelector(".main");
      if (nm && this._keepScroll) nm.scrollTop = top;
      this._keepScroll = false;
    }

    v_start() {
      var st = this.state, t = todayIso(), now = new Date();
      var head = "<div class='head'><span class='clock'>" + this._time() + "</span><span class='sub'>" + WD_LANG[wd(now)] + ", " + now.getDate() + ". " + MON[now.getMonth()] + " " + now.getFullYear() + "</span><span class='grow'></span>" + this._pendingBadge() + "<button class='btn sec sm' data-act='theme' title='Hell / Dunkel'>" + (st.settings.theme === "dunkel" ? "☀️ Hell" : "🌙 Dunkel") + "</button></div>";
      var cols = st.persons.map((p) => {
        var evs = this._eventsOn(t).filter((e) => e.person === p.id);
        var tasks = st.tasks.filter((x) => Logic.taskPerson(x) === p.id && (Logic.taskDue(x) || Logic.taskDoneToday(x)));
        var done = tasks.filter(Logic.taskDoneToday).length;
        var open = tasks.filter((x) => !Logic.taskDoneToday(x));
        var bodyHtml = "";
        bodyHtml += evs.length ? evs.map((e) => "<div class='ev'><span class='bar' style='background:" + esc(p.color) + "'></span><span class='t'>" + this._evTime(e) + "</span><span>" + esc(e.title) + "</span></div>").join("") : "<div class='empty'>Keine Termine heute</div>";
        if (tasks.length) {
          bodyHtml += "<div class='row small muted'><span>Aufgaben " + done + "/" + tasks.length + "</span></div><div class='prog'><i style='width:" + Math.round(100 * done / tasks.length) + "%;background:" + esc(p.color) + "'></i></div>";
          // Routinen kompakt als eine Zeile, einzelne Aufgaben zum Abhaken
          st.routines.filter((r) => r.person === p.id).forEach((r) => {
            var rt = tasks.filter((x) => x.routine === r.id);
            if (!rt.length) return;
            var rd = rt.filter(Logic.taskDoneToday).length;
            bodyHtml += "<button class='task' style='border:0;text-align:left' data-act='nav' data-v='aufgaben'><span class='ic'>" + esc(r.icon || "•") + "</span><span class='nm'>" + esc(r.name) + "</span><b class='small' style='color:" + (rd === rt.length ? "var(--ok)" : "var(--muted)") + "'>" + rd + "/" + rt.length + (rd === rt.length ? " ✓" : "") + "</b></button>";
          });
          var single = open.filter((x) => !x.routine);
          bodyHtml += single.slice(0, 4).map((x) => this._taskRow(x, p.id)).join("");
          if (single.length > 4) bodyHtml += "<div class='small muted'>+ " + (single.length - 4) + " weitere</div>";
        }
        return "<div class='pcol'><div class='ph' style='background:" + esc(p.color) + ";color:" + textOn(p.color) + "'>" + this.av(p) + "<span class='pname'>" + esc(p.name) + "</span>" + (p.points_enabled && st.settings.modules.punkte !== false ? "<span class='pts'>⭐ " + Logic.points(st, p.id) + "</span>" : "") + "</div><div class='pb'>" + bodyHtml + "</div></div>";
      }).join("");
      var allEv = this._eventsOn(t).filter((e) => !e.person || !this.person(e.person));
      var common = allEv.length ? "<div class='card' style='margin-bottom:14px'><h3>👪 Alle</h3><div class='list'>" + allEv.map((e) => "<div class='ev'><span class='bar' style='background:var(--accent)'></span><span class='t'>" + this._evTime(e) + "</span><span>" + esc(e.title) + "</span></div>").join("") + "</div></div>" : "";
      var m = st.settings.modules, cards = [];
      if (m.essen !== false) {
        var tm = iso(addDays(now, 1));
        var mealLine = (d, label) => { var x = st.meals[d] || {}; var s = SLOTS.filter((sl) => x[sl[0]]).map((sl) => esc(x[sl[0]].name)).join(" · "); return "<div class='row'><b style='min-width:62px'>" + label + "</b><span>" + (s || "<span class='muted'>noch nichts geplant</span>") + "</span></div>"; };
        cards.push("<div class='card' data-act='nav' data-v='essen'><h3>🍽️ Essen</h3><div class='list'>" + mealLine(t, "Heute") + mealLine(tm, "Morgen") + "</div></div>");
      }
      if (m.muell !== false) {
        var next = st.waste.map((w) => ({ w: w, d: Logic.wasteDates(w, 1)[0] })).filter((x) => x.d).sort((a, b) => a.d < b.d ? -1 : 1).slice(0, 3);
        cards.push("<div class='card' data-act='nav' data-v='muell'><h3>🗑️ Müll</h3><div class='list'>" + (next.map((x) => "<div class='row'><span class='pill' style='background:" + esc(x.w.color) + ";color:" + textOn(x.w.color) + "'>" + esc(x.w.icon) + " " + esc(x.w.name) + "</span><span>" + this._relDay(x.d) + "</span></div>").join("") || "<div class='empty'>Keine Termine erfasst</div>") + "</div></div>");
      }
      if (m.wartung !== false) {
        var due = st.maintenance.filter((x) => Logic.maintStatus(x) !== "ok");
        cards.push("<div class='card' data-act='nav' data-v='wartung'><h3>🔧 Wartung</h3><div class='list'>" + (due.map((x) => "<div class='row'><span class='status' style='background:" + (Logic.maintStatus(x) === "ueberfaellig" ? "var(--bad)" : "var(--warn)") + "'></span><span>" + esc(x.icon) + " " + esc(x.name) + "</span><span class='muted small' style='margin-left:auto'>" + this._relDay(x.next) + "</span></div>").join("") || "<div class='empty'>Alles erledigt ✅</div>") + "</div></div>");
      }
      if (m.einkauf !== false) {
        var open = st.shopping.filter((x) => x.status !== "completed");
        cards.push("<div class='card' data-act='nav' data-v='einkauf'><h3>🛒 Einkauf</h3><div><b style='font-size:28px'>" + open.length + "</b> <span class='muted'>Artikel</span></div><div class='small muted'>" + open.slice(0, 5).map((x) => esc(x.summary)).join(", ") + "</div></div>");
      }
      if (!st.persons.length) cols = "<div class='card'><h3>👋 Willkommen</h3><p>Noch keine Personen erfasst. Unter <b>⚙️ Einstellungen → Personen</b> legst du die Familie an, mit Farbe und Foto.</p><button class='btn' data-act='nav' data-v='einstellungen'>Zu den Einstellungen</button></div>";
      return head + "<div class='people'>" + cols + "</div>" + common + "<div class='bottom'>" + cards.join("") + "</div>";
    }

    _pendingBadge() {
      var n = (this.state.pending || []).length;
      return n ? "<button class='btn sm' data-act='nav' data-v='punkte'>🔔 " + n + " zu bestätigen</button>" : "";
    }
    _relDay(d) {
      var n = daysBetween(todayIso(), d);
      if (n === 0) return "heute";
      if (n === 1) return "morgen";
      if (n === -1) return "gestern";
      if (n < 0) return "seit " + (-n) + " Tagen";
      if (n < 7) return WD_LANG[wd(parse(d))];
      return fmtDate(d);
    }
    _evTime(e) { return e.allday || String(e.start).length <= 10 ? "ganzt." : String(e.start).slice(11, 16); }
    _eventsOn(day) {
      return (this.state.events || []).filter((e) => {
        var s = String(e.start).slice(0, 10), en = String(e.end || e.start).slice(0, 10);
        if (e.allday || String(e.start).length <= 10) return s <= day && day < (en > s ? en : iso(addDays(parse(s), 1)));
        return s <= day && day <= en;
      }).sort((a, b) => String(a.start) < String(b.start) ? -1 : 1);
    }
    _taskRow(x, pid) {
      var done = Logic.taskDoneToday(x);
      return "<div class='task " + (done ? "done" : "") + "'><span class='ic'>" + esc(x.icon || "•") + "</span><span class='nm'>" + esc(x.name) + (x.points ? " <span class='muted small'>⭐" + x.points + "</span>" : "") + "</span><button class='chk " + (done ? "on" : "") + "' data-act='" + (done ? "undo" : "done") + "' data-id='" + x.id + "' data-p='" + (pid || "") + "'>" + (done ? "✓" : "") + "</button></div>";
    }

    v_kalender() {
      var mode = this.sub.cal || "woche";
      var base = this.sub.calDate ? parse(this.sub.calDate) : new Date();
      var tabs = "<div class='toolbar'><div class='tabs' style='margin:0'><button data-act='calmode' data-v='woche' class='" + (mode === "woche" ? "on" : "") + "'>Woche</button><button data-act='calmode' data-v='monat' class='" + (mode === "monat" ? "on" : "") + "'>Monat</button></div>" +
        "<button class='btn sec sm' data-act='calnav' data-v='-1'>‹</button><button class='btn sec sm' data-act='calnav' data-v='0'>Heute</button><button class='btn sec sm' data-act='calnav' data-v='1'>›</button><span class='grow' style='flex:1'></span><button class='btn' data-act='addevent'>＋ Termin</button></div>";
      var legend = "<div class='row small' style='flex-wrap:wrap;margin-bottom:10px'>" + this.state.persons.map((p) => "<span class='pill' style='background:" + esc(p.color) + ";color:" + textOn(p.color) + "'>" + esc(p.name) + "</span>").join("") + "<span class='pill' style='background:var(--accent);color:#fff'>Alle</span></div>";
      var t = todayIso(), html = "";
      if (mode === "woche") {
        var ws = weekStart(base);
        html = "<div class='head'><h1>KW " + this._kw(ws) + "</h1><span class='sub'>" + fmtDate(iso(ws)) + " – " + fmtDate(iso(addDays(ws, 6))) + "</span></div>" + tabs + legend + "<div class='week'>";
        for (var i = 0; i < 7; i++) {
          var d = iso(addDays(ws, i));
          var evs = this._eventsOn(d);
          var waste = this.state.settings.modules.muell !== false ? this.state.waste.filter((w) => Logic.wasteDates(w, 1, d)[0] === d) : [];
          html += "<div class='day " + (d === t ? "today" : "") + "'><div class='dh'><span>" + WD[i] + "</span><span class='muted'>" + parse(d).getDate() + ".</span></div>" +
            waste.map((w) => "<div class='evc' style='background:" + esc(w.color) + "22;color:inherit'>" + esc(w.icon) + " " + esc(w.name) + "</div>").join("") +
            evs.map((e) => { var c = e.person ? this.color(e.person) : "#6c5ce7"; return "<div class='evc' data-act='event' data-id='" + esc(e.id) + "' style='background:" + esc(c) + ";color:" + textOn(c) + "'><b>" + this._evTime(e) + "</b> " + esc(e.title) + "</div>"; }).join("") + "</div>";
        }
        html += "</div>";
      } else {
        var first = new Date(base.getFullYear(), base.getMonth(), 1);
        var gs = weekStart(first);
        html = "<div class='head'><h1>" + MON[base.getMonth()] + " " + base.getFullYear() + "</h1></div>" + tabs + legend + "<div class='month'>" + WD.map((w) => "<div class='h small muted' style='text-align:center'>" + w + "</div>").join("");
        for (var k = 0; k < 42; k++) {
          var dd = addDays(gs, k), ds = iso(dd);
          var ev = this._eventsOn(ds);
          html += "<div class='mc " + (dd.getMonth() !== base.getMonth() ? "other " : "") + (ds === t ? "today" : "") + "' data-act='dayjump' data-v='" + ds + "'><b>" + dd.getDate() + "</b><div class='dots'>" + ev.map((e) => "<i style='background:" + esc(e.person ? this.color(e.person) : "#6c5ce7") + "'></i>").join("") + "</div></div>";
        }
        html += "</div>";
      }
      return html;
    }
    _kw(d) { var x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); var dn = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - dn); var y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y) / 86400000 + 1) / 7); }

    v_aufgaben() {
      var st = this.state, tab = this.sub.task || "routinen";
      var html = "<div class='head'><h1>Aufgaben</h1><span class='grow'></span><button class='btn sec' data-act='history'>📜 Verlauf</button><button class='btn' data-act='edit' data-col='" + (tab === "routinen" ? "routines" : "tasks") + "'>＋ " + (tab === "routinen" ? "Routine" : "Aufgabe") + "</button></div>";
      html += "<div class='tabs'><button data-act='tasktab' data-v='routinen' class='" + (tab === "routinen" ? "on" : "") + "'>Routinen</button><button data-act='tasktab' data-v='heute' class='" + (tab === "heute" ? "on" : "") + "'>Heute</button><button data-act='tasktab' data-v='alle' class='" + (tab === "alle" ? "on" : "") + "'>Alle Aufgaben</button></div>";
      if (tab === "routinen") {
        var h = new Date().getHours();
        var nowSlot = h < 11 ? "morgen" : h < 16 ? "mittag" : "abend";
        var rs = st.routines.slice().sort((a, b) => (a.time === nowSlot ? -1 : 0) - (b.time === nowSlot ? -1 : 0));
        html += "<div class='routines'>" + (rs.map((r) => {
          var p = this.person(r.person) || { name: "?", color: "#999" };
          var ts = st.tasks.filter((x) => x.routine === r.id && (Logic.taskDue(x) || Logic.taskDoneToday(x)));
          var done = ts.filter(Logic.taskDoneToday).length;
          return "<div class='card' style='border-top:6px solid " + esc(p.color) + "'><div class='row' style='margin-bottom:10px'>" + this.av(p, "s") + "<b style='font-size:17px'>" + esc(p.name) + " · " + esc(r.icon || "") + " " + esc(r.name) + "</b><span class='grow' style='flex:1'></span><span class='muted small'>" + done + "/" + ts.length + "</span><button class='btn sec sm' data-act='edit' data-col='routines' data-id='" + r.id + "'>✏️</button></div>" +
            "<div class='tiles'>" + (ts.map((x) => { var dn = Logic.taskDoneToday(x); return "<button class='tile " + (dn ? "done" : "") + "' data-act='" + (dn ? "undo" : "done") + "' data-id='" + x.id + "' data-p='" + r.person + "'><span class='ic'>" + esc(x.icon || "•") + "</span>" + esc(x.name) + (x.points ? "<span class='pt'>⭐ " + x.points + "</span>" : "") + "</button>"; }).join("") || "<div class='empty'>Heute nichts zu tun</div>") + "</div></div>";
        }).join("") || "<div class='card empty'>Noch keine Routinen. Lege mit „＋ Routine“ eine an und ordne ihr Aufgaben zu.</div>") + "</div>";
      } else if (tab === "heute") {
        html += "<div class='people'>" + st.persons.map((p) => {
          var ts = st.tasks.filter((x) => !x.routine && Logic.taskPerson(x) === p.id && (Logic.taskDue(x) || Logic.taskDoneToday(x)));
          return "<div class='pcol'><div class='ph' style='background:" + esc(p.color) + ";color:" + textOn(p.color) + "'>" + this.av(p, "s") + "<span class='pname'>" + esc(p.name) + "</span></div><div class='pb'>" + (ts.map((x) => this._taskRow(x, p.id)).join("") || "<div class='empty'>Nichts fällig 🎉</div>") + "</div></div>";
        }).join("") + "</div>";
      } else {
        html += "<div class='card'><div class='list'>" + (st.tasks.map((x) => {
          var r = st.routines.filter((y) => y.id === x.routine)[0];
          return "<div class='task'><span class='ic'>" + esc(x.icon || "•") + "</span><span class='nm'><b>" + esc(x.name) + "</b><br><span class='small muted'>" + esc(Logic.repeatText(x.repeat)) + " · " + (x.persons || []).map((id) => esc((this.person(id) || {}).name || "?")).join(x.rotate ? " ↻ " : ", ") + (r ? " · Routine " + esc(r.name) : "") + (x.points ? " · ⭐" + x.points : "") + (x.needs_approval ? " · mit Bestätigung" : "") + "</span></span><button class='btn sec sm' data-act='edit' data-col='tasks' data-id='" + x.id + "'>✏️</button></div>";
        }).join("") || "<div class='empty'>Noch keine Aufgaben</div>") + "</div></div>";
      }
      return html;
    }

    v_punkte() {
      var st = this.state;
      var kids = st.persons.filter((p) => p.points_enabled);
      var sel = this.sub.pp && this.person(this.sub.pp) ? this.sub.pp : (kids[0] || {}).id;
      var html = "<div class='head'><h1>Punkte & Belohnungen</h1><span class='grow'></span><button class='btn' data-act='edit' data-col='rewards'>＋ Belohnung</button></div>";
      if (st.pending.length) {
        html += "<div class='card' style='margin-bottom:14px;border:2px solid var(--warn)'><h3>🔔 Wartet auf Bestätigung</h3><div class='list'>" + st.pending.map((x) => { var p = this.person(x.person); return "<div class='task'>" + this.av(p, "s") + "<span class='nm'><b>" + esc(p ? p.name : "?") + "</b> · " + esc(x.name) + " <span class='muted'>(" + (x.points > 0 ? "+" : "") + x.points + " ⭐)</span></span><button class='btn ok sm' data-act='approve' data-id='" + x.id + "'>✓ Bestätigen</button><button class='btn sec sm' data-act='reject' data-id='" + x.id + "'>✕</button></div>"; }).join("") + "</div></div>";
      }
      if (!kids.length) return html + "<div class='card empty'>Bei keiner Person sind Punkte eingeschaltet. Das geht unter ⚙️ Einstellungen → Personen.</div>";
      html += "<div class='people'>" + kids.map((p) => "<button class='pcol' data-act='pp' data-v='" + p.id + "' style='border:" + (p.id === sel ? "3px solid " + esc(p.color) : "1px solid var(--line)") + ";text-align:left;padding:0'><div class='ph' style='background:" + esc(p.color) + ";color:" + textOn(p.color) + "'>" + this.av(p) + "<span class='pname'>" + esc(p.name) + "</span><span class='pts' style='font-size:22px'>⭐ " + Logic.points(st, p.id) + "</span></div></button>").join("") + "</div>";
      var pts = Logic.available(st, sel), sp = this.person(sel);
      html += "<div class='card' style='margin-bottom:14px'><h3>🎁 Belohnungen für " + esc(sp.name) + "</h3><div class='shop'>" + (st.rewards.map((r) => "<div class='rew'><span class='ic'>" + esc(r.icon || "🎁") + "</span><b>" + esc(r.name) + "</b><span class='muted'>⭐ " + r.cost + "</span><button class='btn sm' " + (pts < r.cost ? "disabled style='opacity:.4'" : "") + " data-act='redeem' data-id='" + r.id + "' data-p='" + sel + "'>Einlösen</button><button class='btn sec sm' data-act='edit' data-col='rewards' data-id='" + r.id + "'>✏️</button></div>").join("") || "<div class='empty'>Noch keine Belohnungen</div>") + "</div></div>";
      var led = st.ledger.filter((l) => l.person === sel).slice().reverse().slice(0, 20);
      html += "<div class='card'><h3>📜 Punkteverlauf <span class='grow' style='flex:1'></span><button class='btn sec sm' data-act='adjust' data-p='" + sel + "'>± Korrektur</button></h3><div class='list'>" + (led.map((l) => "<div class='row small'><b style='min-width:50px;color:" + (l.delta >= 0 ? "var(--ok)" : "var(--bad)") + "'>" + (l.delta > 0 ? "+" : "") + l.delta + "</b><span>" + esc(l.reason) + "</span><span class='muted' style='margin-left:auto'>" + fmtDate(l.ts) + "</span></div>").join("") || "<div class='empty'>Noch keine Buchungen</div>") + "</div></div>";
      return html;
    }

    v_essen() {
      var st = this.state, off = this.sub.mealWeek || 0;
      var ws = addDays(weekStart(new Date()), off * 7), t = todayIso();
      var beh = { auto: "automatisch beim Eintragen", button: "auf Knopfdruck", never: "nie" }[st.settings.mealie.to_bring] || "";
      var html = "<div class='head'><h1>Essensplan</h1><span class='sub'>aus Mealie · Zutaten an Bring: " + beh + "</span></div>";
      html += "<div class='toolbar'><div class='tabs' style='margin:0'><button data-act='mealweek' data-v='0' class='" + (off === 0 ? "on" : "") + "'>Diese Woche</button><button data-act='mealweek' data-v='1' class='" + (off === 1 ? "on" : "") + "'>Nächste Woche</button></div><span style='flex:1'></span>" + (st.settings.mealie.to_bring !== "never" ? "<button class='btn' data-act='weekbring' data-v='" + iso(ws) + "'>🛒 Zutaten der Woche an Bring</button>" : "") + "</div>";
      html += "<div class='card'><div class='meals'><div></div>";
      for (var i = 0; i < 7; i++) { var d = iso(addDays(ws, i)); html += "<div class='h " + (d === t ? "today" : "") + "'>" + WD[i] + " " + parse(d).getDate() + ".</div>"; }
      SLOTS.forEach((sl) => {
        html += "<div class='sl'>" + sl[1] + "</div>";
        for (var j = 0; j < 7; j++) {
          var dd = iso(addDays(ws, j)), m = (st.meals[dd] || {})[sl[0]];
          html += "<button class='meal " + (m ? "set" : "") + "' data-act='meal' data-d='" + dd + "' data-s='" + sl[0] + "'>" + (m ? esc(m.name) + (m.recipe ? " <span class='muted'>📖</span>" : "") : "<span class='muted'>＋</span>") + "</button>";
        }
      });
      return html + "</div></div>";
    }

    v_einkauf() {
      var st = this.state, open = st.shopping.filter((x) => x.status !== "completed");
      var lst = this._todoLists().filter((o) => o.entity_id === st.settings.mealie.bring_list)[0];
      if (!st.settings.mealie.bring_list) return "<div class='head'><h1>Einkauf</h1></div><div class='card'>Noch keine Einkaufsliste gewählt. Das geht unter ⚙️ Einstellungen → Mealie & Bring.</div>";
      return "<div class='head'><h1>Einkauf</h1><span class='sub'>" + esc(lst ? lst.name : st.settings.mealie.bring_list) + (lst && lst.platform === "bring" ? " · Bring" : "") + "</span></div>" +
        "<div class='card' style='margin-bottom:14px'><div class='row'><input id='shopin' placeholder='Was fehlt?'><button class='btn' data-act='shopadd'>＋</button></div></div>" +
        "<div class='card'><div class='list'>" + (open.map((x) => "<div class='task'><span class='nm'>" + esc(x.summary) + "</span><button class='chk' data-act='shopdone' data-id='" + esc(x.uid) + "'></button></div>").join("") || "<div class='empty'>Liste ist leer 🎉</div>") + "</div></div>";
    }

    v_wartung() {
      var st = this.state;
      var order = { ueberfaellig: 0, bald: 1, ok: 2 };
      var ms = st.maintenance.slice().sort((a, b) => order[Logic.maintStatus(a)] - order[Logic.maintStatus(b)] || (a.next < b.next ? -1 : 1));
      return "<div class='head'><h1>Wartung</h1><span class='grow'></span><button class='btn' data-act='edit' data-col='maintenance'>＋ Wartung</button></div><div class='card'><div class='list'>" +
        (ms.map((m) => {
          var s = Logic.maintStatus(m);
          var c = s === "ueberfaellig" ? "var(--bad)" : s === "bald" ? "var(--warn)" : "var(--ok)";
          return "<div class='task'><span class='status' style='background:" + c + "'></span><span class='ic'>" + esc(m.icon || "🔧") + "</span><span class='nm'><b>" + esc(m.name) + "</b><br><span class='small muted'>alle " + m.every + " " + (UNITS.filter((u) => u[0] === m.unit)[0] || ["", ""])[1] + " · nächstes Mal " + (m.next ? this._relDay(m.next) : "–") + (m.last ? " · zuletzt " + fmtDate(m.last) : "") + "</span></span><button class='btn ok sm' data-act='maintdone' data-id='" + m.id + "'>✓ Erledigt</button><button class='btn sec sm' data-act='edit' data-col='maintenance' data-id='" + m.id + "'>✏️</button></div>";
        }).join("") || "<div class='empty'>Noch keine Wartungen erfasst</div>") + "</div></div>";
    }

    v_muell() {
      var st = this.state;
      return "<div class='head'><h1>Müllabfuhr</h1><span class='sub'>Erinnerung am Vorabend um " + esc(st.settings.notify.waste_time) + "</span><span class='grow'></span><button class='btn' data-act='edit' data-col='waste'>＋ Müllart</button></div><div class='grid' style='grid-template-columns:repeat(auto-fit,minmax(240px,1fr))'>" +
        (st.waste.map((w) => {
          var ds = Logic.wasteDates(w, 4);
          var r = w.rule || {};
          return "<div class='card' style='border-left:8px solid " + esc(w.color) + "'><div class='row'><span style='font-size:30px'>" + esc(w.icon) + "</span><b style='font-size:18px'>" + esc(w.name) + "</b><span style='flex:1'></span><button class='btn sec sm' data-act='edit' data-col='waste' data-id='" + w.id + "'>✏️</button></div><div class='small muted' style='margin:6px 0'>" + (r.type === "weekly" ? (r.every_weeks > 1 ? "alle " + r.every_weeks + " Wochen" : "jede Woche") + " am " + WD_LANG[r.weekday] : "nur einzelne Daten") + "</div><div class='list'>" + (ds.map((d) => "<div class='row'><span>" + this._relDay(d) + "</span><span class='muted small' style='margin-left:auto'>" + fmtDate(d) + "</span></div>").join("") || "<div class='empty'>Keine Termine</div>") + "</div></div>";
        }).join("") || "<div class='card empty'>Noch keine Müllarten erfasst</div>") + "</div>";
    }

    v_einstellungen() {
      var st = this.state, s = st.settings;
      if (!this._unlocked()) {
        return "<div class='head'><h1>Einstellungen</h1></div><div class='card'><p>Die Einstellungen sind mit der Eltern-PIN geschützt.</p><button class='btn' data-act='unlock'>🔒 Entsperren</button></div>";
      }
      var mods = NAV.filter((n) => n[0] !== "start").concat([["bilderrahmen", "🖼️", "Bilderrahmen"]]);
      return "<div class='head'><h1>Einstellungen</h1><span class='grow'></span><span class='lock'>🔓 entsperrt</span><button class='btn sec sm' data-act='lock'>Sperren</button></div>" +
        "<div class='card set-sec'><h3>👪 Personen <span style='flex:1'></span><button class='btn sm' data-act='edit' data-col='persons'>＋ Person</button></h3>" +
        st.persons.map((p) => "<div class='prow'>" + this.av(p) + "<div style='flex:1'><b>" + esc(p.name) + "</b><div class='small muted'>" + (p.role === "kind" ? "Kind" : "Erwachsen") + (p.points_enabled ? " · sammelt Punkte" : "") + (p.ha_person ? " · " + esc(p.ha_person) : "") + (p.calendar ? " · " + esc(p.calendar) : "") + "</div></div><input type='color' value='" + esc(p.color) + "' data-chg='pcolor' data-id='" + p.id + "'><button class='btn sec sm' data-act='edit' data-col='persons' data-id='" + p.id + "'>✏️</button></div>").join("") + "</div>" +
        "<div class='card set-sec'><h3>🧩 Module</h3><div class='grid' style='grid-template-columns:repeat(auto-fill,minmax(170px,1fr))'>" + mods.map((n) => "<label class='row'><input type='checkbox' data-chg='module' data-v='" + n[0] + "' " + (s.modules[n[0]] !== false ? "checked" : "") + ">" + n[1] + " " + n[2] + "</label>").join("") + "</div></div>" +
        "<div class='card set-sec'><h3>📅 Kalender</h3><div class='form'><label class='f'>Familienkalender (Termine für alle)<select data-chg='set' data-k='family_calendar'><option value=''>– keiner –</option>" + (st.calendar_list || []).map((o) => "<option value='" + esc(o.entity_id) + "'" + (s.family_calendar === o.entity_id ? " selected" : "") + ">" + esc(o.name) + "</option>").join("") + "</select></label><div class='small muted'>Eigene Kalender pro Person wählst du bei der Person (✏️).</div></div></div>" +
        "<div class='card set-sec'><h3>🎨 Darstellung & Schutz</h3><div class='form'>" +
        "<label class='f'>Farbschema<select data-chg='set' data-k='theme'><option value='hell'" + (s.theme === "hell" ? " selected" : "") + ">Hell</option><option value='dunkel'" + (s.theme === "dunkel" ? " selected" : "") + ">Dunkel</option></select></label>" +
        "<label class='row'><input type='checkbox' data-chg='setbool' data-k='lock_calendar' " + (s.lock_calendar ? "checked" : "") + "> Termine anlegen/löschen nur mit PIN</label>" +
        "<button class='btn sec' data-act='newpin'>🔑 PIN ändern</button></div></div>" +
        "<div class='card set-sec'><h3>🍽️ Mealie & Bring</h3><div class='form'><label class='f'>Zutaten an Bring<select data-chg='mealie' data-k='to_bring'>" + [["auto", "automatisch beim Eintragen"], ["button", "auf Knopfdruck (mit Auswahl)"], ["never", "nie"]].map((o) => "<option value='" + o[0] + "'" + (s.mealie.to_bring === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></label><label class='f'>Einkaufsliste für Zutaten und Einkauf<select data-chg='mealie' data-k='bring_list'><option value=''>– bitte wählen –</option>" + this._todoLists().map((o) => "<option value='" + esc(o.entity_id) + "'" + (s.mealie.bring_list === o.entity_id ? " selected" : "") + ">" + esc(o.name) + (o.platform === "bring" ? " · Bring" : "") + "</option>").join("") + "</select></label></div></div>" +
        "<div class='card set-sec'><h3>🔔 Benachrichtigungen</h3><div class='form'><label class='f'>Telegram (Notify-Aktion)<input data-chg='notify' data-k='telegram' placeholder='notify.telegram_familie' value='" + esc(s.notify.telegram) + "'></label><label class='f'>Sonos-Lautsprecher (kommagetrennt)<input data-chg='notifylist' data-k='sonos' placeholder='media_player.sonos_kuche' value='" + esc((s.notify.sonos || []).join(", ")) + "'></label>" +
        "<div class='row'><label class='f' style='flex:1'>Ruhezeit von<input type='time' data-chg='notify' data-k='quiet_from' value='" + esc(s.notify.quiet_from) + "'></label><label class='f' style='flex:1'>bis<input type='time' data-chg='notify' data-k='quiet_to' value='" + esc(s.notify.quiet_to) + "'></label></div>" +
        "<label class='f'>Müll-Erinnerung am Vorabend um<input type='time' data-chg='notify' data-k='waste_time' value='" + esc(s.notify.waste_time) + "'></label></div></div>" +
        "<div class='card set-sec'><h3>🖼️ Bilderrahmen</h3><div class='form'><label class='f'>Medienordner<input data-chg='frame' data-k='media' value='" + esc(s.frame.media) + "'></label>" +
        "<div class='row'><label class='f' style='flex:1'>Start nach (Minuten)<input type='number' min='1' data-chg='framenum' data-k='idle_min' value='" + esc(s.frame.idle_min) + "'></label><label class='f' style='flex:1'>Bildwechsel (Sekunden)<input type='number' min='3' data-chg='framenum' data-k='interval_s' value='" + esc(s.frame.interval_s) + "'></label></div>" +
        "<div class='row'><label class='f' style='flex:1'>Nachtruhe von<input type='time' data-chg='frame' data-k='night_from' value='" + esc(s.frame.night_from) + "'></label><label class='f' style='flex:1'>bis<input type='time' data-chg='frame' data-k='night_to' value='" + esc(s.frame.night_to) + "'></label></div>" +
        "<button class='btn sec' data-act='frametest'>▶️ Jetzt testen</button></div></div>" +
        (this.backend instanceof MockBackend ? "<div class='card set-sec'><h3>🧪 Vorschau</h3><button class='btn bad' data-act='demoreset'>Demodaten zurücksetzen</button></div>" : "");
    }

    // ---------- Ereignisse ----------
    _onClick(e) {
      var el = e.target.closest("[data-act]");
      if (!el) return;
      var a = el.getAttribute("data-act"), id = el.getAttribute("data-id"), v = el.getAttribute("data-v");
      var st = this.state;
      switch (a) {
        case "nav": this.view = v; this.render(); break;
        case "hamenu": this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })); break;
        case "calmode": this.sub.cal = v; this.render(); break;
        case "calnav": {
          if (v === "0") { this.sub.calDate = null; this.render(); break; }
          var b = this.sub.calDate ? parse(this.sub.calDate) : new Date();
          if ((this.sub.cal || "woche") === "woche") b = addDays(b, 7 * Number(v)); else b = new Date(b.getFullYear(), b.getMonth() + Number(v), 1);
          this.sub.calDate = iso(b); this.render(); break;
        }
        case "dayjump": this.sub.cal = "woche"; this.sub.calDate = v; this.render(); break;
        case "tasktab": this.sub.task = v; this.render(); break;
        case "mealweek": this.sub.mealWeek = Number(v); this.render(); break;
        case "pp": this.sub.pp = v; this.render(); break;
        case "done": this._complete(id, el.getAttribute("data-p")); break;
        case "undo": this._keepScroll = true; this.act("undo_task", { task: id }); break;
        case "redeem": this._redeem(id, el.getAttribute("data-p")); break;
        case "approve": this.pin(() => this.act("approve", { id: id }).then(() => this.toast("✓ Bestätigt"))); break;
        case "reject": this.pin(() => this.act("reject", { id: id })); break;
        case "adjust": this.pin(() => this._adjust(el.getAttribute("data-p"))); break;
        case "edit": this._edit(el.getAttribute("data-col"), id); break;
        case "history": this._history(); break;
        case "addevent": (st.settings.lock_calendar ? this.pin.bind(this) : (f) => f())(() => this._addEvent()); break;
        case "event": this._eventDlg(id); break;
        case "meal": this._mealDlg(el.getAttribute("data-d"), el.getAttribute("data-s")); break;
        case "weekbring": this._weekBring(v); break;
        case "shopadd": { var inp = this.shadowRoot.getElementById("shopin"); if (inp && inp.value.trim()) this.act("shopping_add", { summary: inp.value.trim() }); break; }
        case "shopdone": this._keepScroll = true; this.act("shopping_done", { uid: id }); break;
        case "maintdone": this._who("Wer hat's gemacht?", null, (pid) => this.act("maint_done", { id: id, person: pid }).then(() => this.lob(pid))); break;
        case "unlock": this.pin(() => this.render()); break;
        case "lock": this.unlockedUntil = 0; this._pinToken = null; this.render(); break;
        case "newpin": this._newPin(); break;
        case "frametest": this.showFrame(); break;
        case "theme": this._keepScroll = true; this.act("save_settings", { theme: st.settings.theme === "dunkel" ? "hell" : "dunkel" }); break;
        case "demoreset": if (confirm("Alle Demodaten zurücksetzen?")) { this.backend.reset(); this.useDemo(window.FAMILIENZENTRALE_DEMO); } break;
      }
    }
    _onChange(e) {
      var el = e.target, c = el.getAttribute("data-chg");
      if (!c) return;
      var s = this.state.settings, k = el.getAttribute("data-k");
      var save = (key, val) => { var d = {}; d[key] = val; this._keepScroll = true; return this.act("save_settings", d); };
      switch (c) {
        case "pcolor": { var p = Object.assign({}, this.person(el.getAttribute("data-id")), { color: el.value }); this._keepScroll = true; this.act("save_item", { collection: "persons", item: p }); break; }
        case "module": { var m = Object.assign({}, s.modules); m[el.getAttribute("data-v")] = el.checked; save("modules", m); break; }
        case "set": save(k, el.value); break;
        case "setbool": save(k, el.checked); break;
        case "mealie": save("mealie", Object.assign({}, s.mealie, { [k]: el.value })); break;
        case "notify": save("notify", Object.assign({}, s.notify, { [k]: el.value })); break;
        case "notifylist": save("notify", Object.assign({}, s.notify, { [k]: el.value.split(",").map((x) => x.trim()).filter(Boolean) })); break;
        case "frame": save("frame", Object.assign({}, s.frame, { [k]: el.value })); break;
        case "framenum": save("frame", Object.assign({}, s.frame, { [k]: Number(el.value) || 1 })); break;
      }
    }

    _complete(taskId, pid) {
      var task = this.state.tasks.filter((x) => x.id === taskId)[0];
      if (!task) return;
      var go = (p) => { this._keepScroll = true; this.act("complete_task", { task: taskId, person: p }).then(() => this.lob(p, task)); };
      if (pid) return go(pid);
      this._who("Wer hat's gemacht?", task.persons, go);
    }
    _redeem(rid, pid) {
      var r = this.state.rewards.filter((x) => x.id === rid)[0], p = this.person(pid);
      this.dialog("🎁 " + esc(r.name), "<p>" + esc(p.name) + " löst <b>" + esc(r.name) + "</b> für <b>⭐ " + r.cost + "</b> ein." + (r.needs_approval ? "<br><span class='muted'>Ein Elternteil muss das noch bestätigen.</span>" : "") + "</p>",
        [["Abbrechen", "sec"], ["Einlösen", "", () => this.act("redeem", { reward: rid, person: pid }).then(() => this.toast(r.needs_approval ? "🔔 Wartet auf Bestätigung" : "🎉 Viel Spass!"))]]);
    }
    _adjust(pid) {
      this.form("± Punkte für " + esc(this.person(pid).name), [
        { k: "delta", l: "Punkte (z. B. 5 oder -3)", t: "number" }, { k: "reason", l: "Grund", t: "text" }
      ], {}, (v) => this.act("adjust_points", { person: pid, delta: Number(v.delta), reason: v.reason || "Korrektur" }));
    }

    // ---------- Formulare für alle Sammlungen ----------
    _edit(col, id) {
      var st = this.state;
      var item = id ? JSON.parse(JSON.stringify((st[col] || []).filter((x) => x.id === id)[0] || {})) : {};
      var personOpts = st.persons.map((p) => [p.id, p.name]);
      var specs = {
        persons: { title: "Person", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "color", l: "Farbe", t: "color" }, { k: "photo", l: "Foto", t: "photo" },
          { k: "role", l: "Rolle", t: "select", o: [["erwachsen", "Erwachsen"], ["kind", "Kind"]] },
          { k: "points_enabled", l: "Sammelt Punkte", t: "toggle" },
          { k: "ha_person", l: "Verknüpfte HA-Person (optional)", t: "select", o: [["", "– keine –"]].concat((st.ha_persons || []).map((o) => [o.entity_id, o.name])) },
          { k: "calendar", l: "Eigener Kalender (optional)", t: "select", o: [["", "– keiner –"]].concat((st.calendar_list || []).map((o) => [o.entity_id, o.name])) }
        ], def: { color: "#6c5ce7", role: "kind", points_enabled: true } },
        tasks: { title: "Aufgabe", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol (Emoji)", t: "text" },
          { k: "persons", l: "Wer?", t: "persons" }, { k: "rotate", l: "Reihum wechseln", t: "toggle" },
          { k: "routine", l: "Gehört zur Routine", t: "select", o: [["", "– keine –"]].concat(st.routines.map((r) => [r.id, ((this.person(r.person) || {}).name || "?") + ": " + r.name])) },
          { k: "repeat", l: "Wiederholung", t: "repeat" },
          { k: "points", l: "Punkte", t: "number" }, { k: "needs_approval", l: "Punkte erst nach Bestätigung durch Eltern", t: "toggle" },
          { k: "room", l: "Raum (optional)", t: "text" }
        ], def: { icon: "✨", persons: [], points: 1, repeat: { type: "daily" } } },
        routines: { title: "Routine", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol", t: "text" },
          { k: "person", l: "Für", t: "select", o: personOpts }, { k: "time", l: "Tageszeit", t: "select", o: TIMES }
        ], def: { icon: "🌅", time: "morgen", person: (st.persons.filter((p) => p.role === "kind")[0] || st.persons[0] || {}).id } },
        rewards: { title: "Belohnung", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol", t: "text" }, { k: "cost", l: "Preis in Punkten", t: "number" },
          { k: "needs_approval", l: "Eltern müssen bestätigen", t: "toggle" }
        ], def: { icon: "🎁", cost: 20, needs_approval: true } },
        maintenance: { title: "Wartung", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol", t: "text" },
          { k: "every", l: "Wiederholen alle", t: "number" }, { k: "unit", l: "Einheit", t: "select", o: UNITS },
          { k: "warn_days", l: "Vorwarnung (Tage vorher)", t: "number" }, { k: "next", l: "Nächster Termin", t: "date" },
          { k: "note", l: "Notiz", t: "textarea" }
        ], def: { icon: "🔧", every: 1, unit: "jahre", warn_days: 14, next: todayIso() } },
        waste: { title: "Müllart", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol", t: "text" }, { k: "color", l: "Farbe", t: "color" },
          { k: "rule.weekday", l: "Wochentag", t: "select", o: WD_LANG.map((w, i) => [String(i), w]) },
          { k: "rule.every_weeks", l: "Alle … Wochen", t: "number" }, { k: "rule.start", l: "Erster Termin (für den Rhythmus)", t: "date" },
          { k: "extra_dates", l: "Zusätzliche Daten (JJJJ-MM-TT, kommagetrennt)", t: "dates" },
          { k: "skip_dates", l: "Ausfallende Daten (kommagetrennt)", t: "dates" }
        ], def: { icon: "🗑️", color: "#5f6b7a", rule: { type: "weekly", weekday: 0, every_weeks: 1, start: todayIso() }, extra_dates: [], skip_dates: [] } }
      };
      var spec = specs[col];
      if (!spec) return;
      var go = () => this.form((id ? "✏️ " : "＋ ") + spec.title, spec.fields, id ? item : JSON.parse(JSON.stringify(spec.def)), (v) => {
        var it = Object.assign(item, v);
        if (col === "waste") { it.rule = it.rule || {}; it.rule.type = "weekly"; it.rule.weekday = Number(it.rule.weekday); it.rule.every_weeks = Number(it.rule.every_weeks) || 1; }
        if (col === "maintenance") { it.every = Number(it.every) || 1; it.warn_days = Number(it.warn_days) || 0; }
        if (col === "rewards") it.cost = Number(it.cost) || 0;
        if (col === "tasks") { it.points = Number(it.points) || 0; if (!it.routine) it.routine = null; }
        return this.act("save_item", { collection: col, item: it });
      }, id ? () => this.dialog("Löschen?", "<p>„" + esc(item.name) + "“ wirklich löschen?</p>", [["Abbrechen", "sec"], ["Löschen", "bad", () => this.act("delete_item", { collection: col, id: id })]]) : null);
      // Personen, Belohnungen und Wartung ändern nur Erwachsene
      if (["persons", "rewards", "maintenance", "waste", "tasks", "routines"].indexOf(col) >= 0) this.pin(go); else go();
    }

    form(title, fields, vals, onSave, onDelete) {
      var get = (o, k) => k.split(".").reduce((x, p) => (x == null ? undefined : x[p]), o);
      var set = (o, k, v) => { var ps = k.split("."), x = o; ps.slice(0, -1).forEach((p) => { x[p] = x[p] || {}; x = x[p]; }); x[ps[ps.length - 1]] = v; };
      var state = JSON.parse(JSON.stringify(vals || {}));
      var html = "<div class='form'>" + fields.map((f) => {
        var v = get(state, f.k);
        var name = "data-k='" + f.k + "'";
        if (f.t === "text" || f.t === "number" || f.t === "date") return "<label class='f'>" + esc(f.l) + "<input type='" + f.t + "' " + name + " value='" + esc(v == null ? "" : v) + "'></label>";
        if (f.t === "textarea") return "<label class='f'>" + esc(f.l) + "<textarea " + name + " rows='2'>" + esc(v || "") + "</textarea></label>";
        if (f.t === "color") return "<label class='f'>" + esc(f.l) + "<input type='color' " + name + " value='" + esc(v || "#888888") + "'></label>";
        if (f.t === "toggle") return "<label class='row'><input type='checkbox' " + name + (v ? " checked" : "") + "> " + esc(f.l) + "</label>";
        if (f.t === "select") return "<label class='f'>" + esc(f.l) + "<select " + name + ">" + f.o.map((o) => "<option value='" + esc(o[0]) + "'" + (String(v == null ? "" : v) === String(o[0]) ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select></label>";
        if (f.t === "dates") return "<label class='f'>" + esc(f.l) + "<input " + name + " data-t='dates' value='" + esc((v || []).join(", ")) + "'></label>";
        if (f.t === "photo") return "<label class='f'>" + esc(f.l) + "<input type='file' accept='image/*' " + name + " data-t='photo'></label>";
        if (f.t === "persons") return "<div class='f'><span class='small muted'><b>" + esc(f.l) + "</b></span><div class='who'>" + this.state.persons.map((p) => "<label style='display:flex;align-items:center;gap:8px;background:var(--bg);padding:8px;border-radius:12px'><input type='checkbox' data-k='" + f.k + "' data-t='persons' value='" + p.id + "'" + ((v || []).indexOf(p.id) >= 0 ? " checked" : "") + ">" + this.av(p, "s") + esc(p.name) + "</label>").join("") + "</div></div>";
        if (f.t === "repeat") {
          var r = v || { type: "daily" };
          return "<div class='f'><span class='small muted'><b>" + esc(f.l) + "</b></span><select data-k='repeat.type' data-t='rtype'>" + [["daily", "täglich"], ["weekly", "an Wochentagen"], ["interval", "alle X Tage/Wochen/Monate"], ["once", "einmalig"]].map((o) => "<option value='" + o[0] + "'" + (r.type === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select>" +
            "<div data-show='weekly' class='days' style='margin-top:8px'>" + WD.map((w, i) => "<button type='button' data-day='" + i + "' class='" + ((r.days || []).indexOf(i) >= 0 ? "on" : "") + "'>" + w + "</button>").join("") + "</div>" +
            "<div data-show='interval' class='row' style='margin-top:8px'><input type='number' min='1' data-k='repeat.every' value='" + esc(r.every || 1) + "' style='width:90px'><select data-k='repeat.unit'>" + UNITS.map((u) => "<option value='" + u[0] + "'" + (r.unit === u[0] ? " selected" : "") + ">" + u[1] + "</option>").join("") + "</select><label class='row small'><input type='checkbox' data-k='repeat.after_done'" + (r.after_done ? " checked" : "") + ">nach Erledigen</label></div>" +
            "<div data-show='once' style='margin-top:8px'><input type='date' data-k='repeat.date' value='" + esc(r.date || "") + "'></div></div>";
        }
        return "";
      }).join("") + "</div>";
      var btns = [["Abbrechen", "sec"]];
      if (onDelete) btns.unshift(["🗑️ Löschen", "bad", onDelete]);
      var dlg;
      btns.push(["Speichern", "", () => {
        dlg.querySelectorAll("[data-k]").forEach((inp) => {
          var k = inp.getAttribute("data-k"), t = inp.getAttribute("data-t");
          if (t === "persons") return;
          if (t === "photo") return;
          if (inp.type === "checkbox") set(state, k, inp.checked);
          else if (t === "dates") set(state, k, inp.value.split(",").map((x) => x.trim()).filter(Boolean));
          else if (inp.type === "number") set(state, k, inp.value === "" ? null : Number(inp.value));
          else set(state, k, inp.value);
        });
        var pk = dlg.querySelector("[data-t=persons]");
        if (pk) set(state, pk.getAttribute("data-k"), Array.prototype.map.call(dlg.querySelectorAll("[data-t=persons]:checked"), (x) => x.value));
        if (state.repeat && state.repeat.type === "weekly") state.repeat.days = Array.prototype.map.call(dlg.querySelectorAll("[data-day].on"), (b) => Number(b.getAttribute("data-day")));
        if (state.repeat && state.repeat.type === "interval" && !state.repeat.start) state.repeat.start = todayIso();
        if (state._photo) { state.photo = state._photo; delete state._photo; }
        return onSave(state);
      }]);
      dlg = this.dialog(title, html, btns);
      var sync = () => { var ty = dlg.querySelector("[data-t=rtype]"); if (!ty) return; dlg.querySelectorAll("[data-show]").forEach((x) => { x.style.display = x.getAttribute("data-show") === ty.value ? "" : "none"; }); };
      sync();
      dlg.addEventListener("change", (e) => {
        if (e.target.getAttribute("data-t") === "rtype") sync();
        if (e.target.getAttribute("data-t") === "photo" && e.target.files[0]) this._readPhoto(e.target.files[0]).then((u) => { state._photo = u; });
      });
      dlg.addEventListener("click", (e) => { var b = e.target.closest("[data-day]"); if (b) b.classList.toggle("on"); });
    }

    _readPhoto(file) {
      // Foto verkleinern (256 px), damit es klein bleibt und auf dem iPad schnell lädt
      return new Promise((res) => {
        var fr = new FileReader();
        fr.onload = () => {
          var img = new Image();
          img.onload = () => {
            var s = 256, c = document.createElement("canvas"); c.width = s; c.height = s;
            var m = Math.min(img.width, img.height);
            c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
            res(c.toDataURL("image/jpeg", 0.85));
          };
          img.src = fr.result;
        };
        fr.readAsDataURL(file);
      });
    }

    _history() {
      var h = (this.state.history || []).slice(0, 50);
      this.dialog("📜 Verlauf", "<div class='list'>" + (h.map((x) => { var p = this.person(x.person); return "<div class='row small'>" + this.av(p, "s") + "<span><b>" + esc(p ? p.name : "?") + "</b> · " + esc(x.name) + "</span><span class='muted' style='margin-left:auto'>" + fmtDate(x.ts) + " " + String(x.ts).slice(11, 16) + "</span></div>"; }).join("") || "<div class='empty'>Noch nichts erledigt</div>") + "</div>", [["Schliessen", "sec"]]);
    }

    _addEvent() {
      var cal = [["", "Alle / Familie"]].concat(this.state.persons.map((p) => [p.id, p.name]));
      this.form("＋ Termin", [
        { k: "title", l: "Titel", t: "text" }, { k: "person", l: "Für", t: "select", o: cal }, { k: "date", l: "Datum", t: "date" },
        { k: "allday", l: "Ganztägig", t: "toggle" }, { k: "from", l: "Von (HH:MM)", t: "text" }, { k: "to", l: "Bis (HH:MM)", t: "text" }
      ], { date: this.sub.calDate || todayIso(), from: "09:00", to: "10:00" }, (v) => {
        if (!v.title) return Promise.resolve();
        var ev = { title: v.title, person: v.person || null, allday: !!v.allday };
        if (v.allday) { ev.start = v.date; ev.end = iso(addDays(parse(v.date), 1)); }
        else { ev.start = v.date + "T" + (v.from || "09:00") + ":00"; ev.end = v.date + "T" + (v.to || v.from || "10:00") + ":00"; }
        return this.act("add_event", ev);
      });
    }
    _eventDlg(id) {
      var e = this.state.events.filter((x) => x.id === id)[0];
      if (!e) return;
      var p = this.person(e.person);
      this.dialog(esc(e.title), "<p>" + (p ? this.av(p, "s") + " " + esc(p.name) + "<br>" : "") + fmtDate(e.start) + " · " + this._evTime(e) + (e.location ? "<br>📍 " + esc(e.location) : "") + "</p>",
        [["🗑️ Löschen", "bad", () => (this.state.settings.lock_calendar ? this.pin.bind(this) : (f) => f())(() => this.act("delete_event", { id: id }))], ["Schliessen", "sec"]]);
    }

    _mealDlg(date, slot) {
      var cur = (this.state.meals[date] || {})[slot];
      var dlg = this.dialog("🍽️ " + fmtDate(date) + " · " + SLOTS.filter((s) => s[0] === slot)[0][1],
        "<div class='form'><input id='rq' placeholder='Rezept in Mealie suchen oder frei eintippen' value='" + esc(cur ? cur.name : "") + "'><div id='rl' class='list'><div class='empty'>Suche …</div></div></div>",
        [["🗑️ Leeren", "bad", () => this.act("set_meal", { date: date, slot: slot, meal: null })], ["Abbrechen", "sec"], ["✓ Übernehmen (Freitext)", "", () => { var q = dlg.querySelector("#rq").value.trim(); return this.act("set_meal", { date: date, slot: slot, meal: q ? { name: q } : null }); }]]);
      var q = dlg.querySelector("#rq"), rl = dlg.querySelector("#rl"), timer;
      var search = () => this.backend.act("search_recipes", { query: q.value === (cur && cur.name) ? "" : q.value }).then((r) => {
        rl.innerHTML = (r.recipes || []).slice(0, 12).map((x) => "<button class='task' style='border:0;text-align:left' data-slug='" + esc(x.slug) + "' data-name='" + esc(x.name) + "'><span class='ic'>📖</span><span class='nm'>" + esc(x.name) + "</span></button>").join("") || "<div class='empty'>Kein Rezept gefunden – mit „Übernehmen“ als Freitext eintragen.</div>";
      }).catch(() => { rl.innerHTML = "<div class='empty'>Mealie nicht erreichbar</div>"; });
      q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 250); });
      rl.addEventListener("click", (e) => {
        var b = e.target.closest("[data-slug]"); if (!b) return;
        this.closeDialog();
        this.act("set_meal", { date: date, slot: slot, meal: { name: b.getAttribute("data-name"), recipe: b.getAttribute("data-slug") } }).then(() => {
          if (this.state.settings.mealie.to_bring === "auto") this.toast("🛒 Zutaten an Bring geschickt");
        });
      });
      search();
    }
    _weekBring(startIso) {
      var st = this.state, items = [];
      for (var i = 0; i < 7; i++) {
        var d = iso(addDays(parse(startIso), i));
        SLOTS.forEach((sl) => { var m = (st.meals[d] || {})[sl[0]]; if (m && m.recipe) { var r = st.recipes.filter((x) => x.slug === m.recipe)[0]; if (r) r.ingredients.forEach((ing) => { if (items.indexOf(ing) < 0) items.push(ing); }); } });
      }
      var have = st.shopping.map((x) => x.summary.toLowerCase());
      if (!items.length) return this.toast("Diese Woche sind keine Rezepte aus Mealie geplant");
      var dlg = this.dialog("🛒 Zutaten an Bring", "<p class='small muted'>Abwählen, was schon da ist. Was bereits auf der Liste steht, ist abgewählt.</p><div class='list'>" + items.map((it) => "<label class='task'><input type='checkbox' value='" + esc(it) + "'" + (have.indexOf(it.toLowerCase()) < 0 ? " checked" : "") + "><span class='nm'>" + esc(it) + "</span></label>").join("") + "</div>",
        [["Abbrechen", "sec"], ["An Bring senden", "", () => {
          var sel = Array.prototype.map.call(dlg.querySelectorAll("input:checked"), (x) => x.value);
          return this.act("send_to_bring", { items: sel }).then((r) => this.toast("🛒 " + (r && r.added != null ? r.added : sel.length) + " Artikel an Bring"));
        }]]);
    }

    // ---------- Dialoge ----------
    dialog(title, html, buttons) {
      var layer = this.shadowRoot.getElementById("layer");
      layer.innerHTML = "<div class='ov'><div class='dlg'><h2>" + title + "</h2>" + html + "<div class='acts'>" + (buttons || []).map((b, i) => "<button class='btn " + (b[1] || "") + "' data-b='" + i + "'>" + b[0] + "</button>").join("") + "</div></div></div>";
      var dlg = layer.querySelector(".dlg");
      layer.querySelector(".ov").addEventListener("click", (e) => { if (e.target.classList.contains("ov")) this.closeDialog(); });
      dlg.querySelectorAll("[data-b]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        var fn = buttons[Number(b.getAttribute("data-b"))][2];
        var r = fn ? fn() : null;
        if (r && r.then) r.then(() => this.closeDialog()).catch(() => { /* Meldung kam schon */ });
        else if (r !== false) this.closeDialog();
      }));
      return dlg;
    }
    closeDialog() { var l = this.shadowRoot.getElementById("layer"); if (l) l.innerHTML = ""; }
    toast(msg) {
      var t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
      this.shadowRoot.appendChild(t); setTimeout(() => t.remove(), 2600);
    }
    lob(pid, task) {
      var p = this.person(pid), l = document.createElement("div"); l.className = "lob";
      var pending = task && task.needs_approval && task.points && p && p.points_enabled;
      l.innerHTML = "<div>" + LOB[Math.floor(Math.random() * LOB.length)] + "<small>" + esc(p ? p.name : "") + (task && task.points && p && p.points_enabled ? (pending ? " · ⭐ " + task.points + " nach Bestätigung" : " · +" + task.points + " ⭐") : "") + "</small></div>";
      this.shadowRoot.appendChild(l); setTimeout(() => l.remove(), 1800);
    }
    _who(title, ids, cb) {
      var ps = this.state.persons.filter((p) => !ids || !ids.length || ids.indexOf(p.id) >= 0);
      if (ids && ids.length) ps = ps.concat(this.state.persons.filter((p) => ids.indexOf(p.id) < 0));
      var dlg = this.dialog(title, "<div class='who'>" + ps.map((p) => "<button data-pid='" + p.id + "'>" + this.av(p, "l") + esc(p.name) + "</button>").join("") + "</div>", [["Abbrechen", "sec"]]);
      dlg.querySelector(".who").addEventListener("click", (e) => { var b = e.target.closest("[data-pid]"); if (!b) return; this.closeDialog(); cb(b.getAttribute("data-pid")); });
    }
    _unlocked() { return !this.state.settings.pin_set || Date.now() < this.unlockedUntil; }
    pin(cb) {
      if (this._unlocked()) return cb();
      var val = "";
      var dlg = this.dialog("🔒 Eltern-PIN", "<div class='pindots'>" + [0, 1, 2, 3].map(() => "<i></i>").join("") + "</div><div class='pinpad'>" + [1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((n) => n === "" ? "<span></span>" : "<button data-n='" + n + "'>" + n + "</button>").join("") + "</div>", [["Abbrechen", "sec"]]);
      var dots = dlg.querySelectorAll(".pindots i");
      dlg.querySelector(".pinpad").addEventListener("click", (e) => {
        var b = e.target.closest("[data-n]"); if (!b) return;
        var n = b.getAttribute("data-n");
        val = n === "⌫" ? val.slice(0, -1) : (val + n).slice(0, 8);
        dots.forEach((d, i) => d.classList.toggle("on", i < val.length));
        if (val.length >= 4) {
          this.backend.act("check_pin", { pin: val }).then((r) => {
            if (r && r.ok) { this._pinToken = r.token || null; this.unlockedUntil = Date.now() + 5 * 60000 - 5000; this.closeDialog(); cb(); }
            else if (val.length >= 4) { val = ""; dots.forEach((d) => d.classList.remove("on")); this.toast("Falsche PIN"); }
          });
        }
      });
    }
    _newPin() {
      this.form("🔑 Neue Eltern-PIN", [{ k: "a", l: "Neue PIN (4 Ziffern)", t: "number" }, { k: "b", l: "Wiederholen", t: "number" }], {}, (v) => {
        var a = String(v.a == null ? "" : v.a), b = String(v.b == null ? "" : v.b);
        if (!/^\d{4}$/.test(a) || a !== b) { this.toast("PINs stimmen nicht überein oder sind nicht 4-stellig"); return Promise.reject(new Error("pin")); }
        return this.act("save_settings", { new_pin: a }).then(() => this.toast("✓ PIN geändert"));
      });
    }

    // ---------- Bilderrahmen ----------
    _resetIdle() {
      clearTimeout(this._idle);
      if (this._frameOn) this.hideFrame();
      var f = this.state && this.state.settings.frame;
      if (!f || this.state.settings.modules.bilderrahmen === false) return;
      this._idle = setTimeout(() => { if (!this._isNight()) this.showFrame(); }, Math.max(1, Number(f.idle_min) || 3) * 60000);
    }
    _isNight() {
      var f = this.state.settings.frame, n = this._time();
      if (!f.night_from || !f.night_to) return false;
      return f.night_from < f.night_to ? (n >= f.night_from && n < f.night_to) : (n >= f.night_from || n < f.night_to);
    }
    showFrame() {
      if (this._frameOn) return;
      this._frameOn = true;
      var el = document.createElement("div"); el.className = "frame";
      el.innerHTML = "<div class='img'></div><div class='img' style='opacity:0'></div><div class='fc'><b class='fclock'>" + this._time() + "</b><span>" + WD_LANG[wd(new Date())] + ", " + new Date().getDate() + ". " + MON[new Date().getMonth()] + "</span></div>";
      this.shadowRoot.appendChild(el);
      this._frameEl = el;
      el.addEventListener("pointerdown", (e) => { e.stopPropagation(); this.hideFrame(); this._resetIdle(); });
      var imgs = el.querySelectorAll(".img"), k = 0;
      var next = () => {
        this._photo(k).then((url) => {
          var a = imgs[k % 2], b = imgs[(k + 1) % 2];
          b.style.backgroundImage = url; b.style.opacity = 1; a.style.opacity = 0; k++;
          var c = el.querySelector(".fclock"); if (c) c.textContent = this._time();
        });
      };
      next();
      this._frameTimer = setInterval(next, Math.max(3, Number(this.state.settings.frame.interval_s) || 10) * 1000);
    }
    hideFrame() { this._frameOn = false; clearInterval(this._frameTimer); if (this._frameEl) this._frameEl.remove(); this._frameEl = null; }
    _photo(k) {
      if (this.backend instanceof HassBackend) {
        return this.backend.act("frame_photo", { index: k }).then((r) => "url(" + r.url + ")").catch(() => this._fallbackPhoto(k));
      }
      return Promise.resolve(this._fallbackPhoto(k));
    }
    _fallbackPhoto(k) {
      var g = [["#ff9a9e", "#fad0c4"], ["#a18cd1", "#fbc2eb"], ["#84fab0", "#8fd3f4"], ["#f6d365", "#fda085"], ["#5ee7df", "#b490ca"]][k % 5];
      return "linear-gradient(135deg," + g[0] + "," + g[1] + ")";
    }
  }

  if (!customElements.get("familienzentrale-panel")) customElements.define("familienzentrale-panel", FamilienzentralePanel);
  window.FamilienzentraleLogic = Logic;
  window.FamilienzentraleDemoSeed = DEMO_SEED;
})();
