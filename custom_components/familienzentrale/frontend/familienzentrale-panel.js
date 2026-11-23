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
  var PANEL_VERSION = "0.8.0"; // muss zu const.py VERSION passen

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
  var ALL_SLOTS = [["fruehstueck", "Frühstück"], ["mittag", "Mittag"], ["abend", "Abend"], ["beilage", "Beilage"], ["nachtisch", "Nachtisch"], ["snack", "Snack"], ["getraenk", "Getränk"]];
  var slotsOf = function (st) { var on = (st && st.settings.mealie && st.settings.mealie.slots) || ["fruehstueck", "mittag", "abend"]; return ALL_SLOTS.filter(function (x) { return on.indexOf(x[0]) >= 0; }); };
  var TIMES = [["morgen", "Morgen 🌅"], ["mittag", "Mittag ☀️"], ["abend", "Abend 🌙"]];
  // Auswahl für Symbole (Routinen, Aufgaben, Belohnungen, Wartung, Müll)
  var ICONS = [
    ["Körper & Morgen", "🦷 🚿 🛁 🧼 🧴 💇 👕 👖 🧦 👟 🧥 🛏️ 🌅 ☀️ ⏰"],
    ["Abend & Schlaf", "🌙 😴 🛌 📖 🧸 💤"],
    ["Schule & Lernen", "🎒 📚 ✏️ 📝 🎹 🎸 🎻 ⚽ 🏊 🚲"],
    ["Küche & Essen", "🍽️ 🥣 🥗 🍳 🥪 🍎 🥛 🧃 🧊 🫖 ☕"],
    ["Haushalt", "🧹 🧽 🧺 🧻 🗑️ ♻️ 🍾 📦 📰 🛒 🧾 🚪 🔑 🧯"],
    ["Garten & Tiere", "🌱 🌻 🌳 🍂 💧 🐶 🐱 🐰 🐟 🐦"],
    ["Technik & Wartung", "🔧 🔨 🔋 💡 🚨 🌬️ 🔥 🚗 🧰 🖨️ 💻 📱"],
    ["Belohnung & Spass", "🎁 ⭐ 🏆 🍦 🍫 🍿 📺 🎮 🎡 🎨 🎬 🏖️ 🎉 💶"],
    ["Sonstiges", "✨ ✅ ❤️ 👍 🙌 📌 🗓️ 🏠 👪"]
  ].map(function (g) { return [g[0], g[1].split(" ")]; });
  var daysText = function (days) {
    days = (days || []).map(Number).sort();
    if (!days.length || days.length === 7) return "täglich";
    if (days.join() === "0,1,2,3,4") return "Mo–Fr";
    if (days.join() === "5,6") return "Wochenende";
    return days.map(function (i) { return WD[i]; }).join(", ");
  };
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
    // Aufgaben: mode "jeder" (jede Person für sich), "gemeinsam" (einer für alle), "reihum"
    taskMode: function (t) { return t.mode || "jeder"; },
    taskKey: function (t, pid) { return Logic.taskMode(t) === "jeder" ? (pid || "*") : "*"; },
    taskDoneFor: function (t, pid, day) { return ((t.done || {})[Logic.taskKey(t, pid)]) === (day || todayIso()); },
    taskDueFor: function (t, pid, day) {
      day = day || todayIso();
      var r = t.repeat || { type: "once" }, last = (t.done || {})[Logic.taskKey(t, pid)];
      if (last === day) return false;
      if (r.type === "daily") return true;
      if (r.type === "weekly") return (r.days || []).indexOf(wd(parse(day))) >= 0;
      if (r.type === "interval") return (last ? addInterval(last, r.every, r.unit) : (r.start || day)) <= day;
      return !last && (r.date || day) <= day;
    },
    taskAssignees: function (t, day) {
      var ps = (t.persons || []).slice();
      if (Logic.taskMode(t) === "reihum" && ps.length) {
        if (Logic.taskDoneFor(t, null, day) && t.last_by) return [t.last_by];
        return [ps[(t.rotate_index || 0) % ps.length]];
      }
      return ps;
    },
    taskToday: function (t, pid, day) {
      return Logic.taskAssignees(t, day).indexOf(pid) >= 0 && (Logic.taskDueFor(t, pid, day) || Logic.taskDoneFor(t, pid, day));
    },
    // Routinen: für mehrere Personen, an Wochentagen (leer = täglich), mit Schritten
    routineToday: function (r, day) { var d = r.days || []; return !d.length || d.indexOf(wd(parse(day || todayIso()))) >= 0; },
    routineDone: function (r, pid, day) { var x = (r.done || {})[pid]; return x && x.date === (day || todayIso()) ? (x.steps || []) : []; },
    routineProgress: function (r, pid, day) {
      var done = Logic.routineDone(r, pid, day), steps = r.steps || [];
      if (!steps.length) return [done.indexOf("*") >= 0 ? 1 : 0, 1];
      return [steps.filter(function (x) { return done.indexOf(x.id) >= 0; }).length, steps.length];
    },
    // Schule & Freizeit
    // Wiederholungsregel (RFC 5545) aus dem Formular
    buildRrule: function (v, allday) {
      if (!v.rr_freq) return "";
      var parts = ["FREQ=" + v.rr_freq];
      var n = Number(v.rr_interval) || 1;
      if (n > 1) parts.push("INTERVAL=" + n);
      if (v.rr_freq === "WEEKLY") {
        var days = (v.rr_days || []).map(Number);
        if (!days.length) days = [wd(parse(v.date))];
        parts.push("BYDAY=" + days.sort().map(function (i) { return ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][i]; }).join(","));
      }
      if (Number(v.rr_count) > 0) parts.push("COUNT=" + Number(v.rr_count));
      else if (v.rr_until) {
        var u = parse(v.rr_until);
        if (allday) parts.push("UNTIL=" + iso(u).replace(/-/g, ""));
        else { var z = new Date(u.getFullYear(), u.getMonth(), u.getDate(), 23, 59, 59).toISOString(); parts.push("UNTIL=" + z.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")); }
      }
      return parts.join(";");
    },
    rruleText: function (rr) {
      if (!rr) return "";
      var m = {}; String(rr).replace(/^RRULE:/, "").split(";").forEach(function (x) { var kv = x.split("="); m[kv[0]] = kv[1]; });
      var n = Number(m.INTERVAL) || 1;
      var base = { DAILY: n > 1 ? "alle " + n + " Tage" : "täglich", WEEKLY: n > 1 ? "alle " + n + " Wochen" : "wöchentlich", MONTHLY: n > 1 ? "alle " + n + " Monate" : "monatlich", YEARLY: "jährlich" }[m.FREQ] || "Serie";
      if (m.BYDAY) base += " am " + m.BYDAY.split(",").map(function (d) { return WD[["MO", "TU", "WE", "TH", "FR", "SA", "SU"].indexOf(d)] || d; }).join(", ");
      if (m.COUNT) base += ", " + m.COUNT + "×";
      if (m.UNTIL) base += ", bis " + m.UNTIL.slice(6, 8) + "." + m.UNTIL.slice(4, 6) + "." + m.UNTIL.slice(0, 4);
      return base;
    },
    isHoliday: function (st, day) { return (st.holidays || []).some(function (h) { return h.from && h.to && h.from <= day && day <= h.to; }); },
    lessonsOn: function (st, pid, day) {
      if (wd(parse(day)) > 4 && !(st.timetable || []).some(function (l) { return (l.days || []).map(Number).indexOf(wd(parse(day))) >= 0; })) return [];
      if (Logic.isHoliday(st, day)) return [];
      return (st.timetable || []).filter(function (l) { return l.person === pid && (l.days || []).map(Number).indexOf(wd(parse(day))) >= 0; })
        .sort(function (a, b) { return String(a.start) < String(b.start) ? -1 : 1; });
    },
    activityOn: function (st, a, day) {
      var dd = parse(day);
      if ((a.days || []).map(Number).indexOf(wd(dd)) < 0) return false;
      if (a.season_from && day < a.season_from) return false;
      if (a.season_to && day > a.season_to) return false;
      if (a.pause_holidays && Logic.isHoliday(st, day)) return false;
      var every = Number(a.every_weeks) || 1;
      if (every > 1) {
        var anchor = weekStart(parse(a.first || a.season_from || day));
        var weeks = Math.round((weekStart(dd) - anchor) / (7 * 86400000));
        if (weeks < 0 || weeks % every !== 0) return false;
      }
      return true;
    },
    activitiesOn: function (st, day, pid) {
      return (st.activities || []).filter(function (a) { return (!pid || (a.persons || []).indexOf(pid) >= 0) && Logic.activityOn(st, a, day); })
        .sort(function (a, b) { return String(a.start || "") < String(b.start || "") ? -1 : 1; });
    },
    modeText: function (m) { return { jeder: "jeder für sich", gemeinsam: "einer für alle", reihum: "reihum" }[m || "jeder"]; },
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
          var st0 = r.start ? parse(r.start) : from;
          var anchor = addDays(st0, (Number(r.weekday) - wd(st0) + 7) % 7);
          var days = Math.round((d - anchor) / 86400000);
          if (days >= 0 && Math.round(days / 7) % every === 0) out.push(s);
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
    this.key = "familienzentrale_demo_v4";
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
    var book = function (pid, delta, reason, ref) { var e = { id: uid(), person: pid, delta: delta, reason: reason, ts: now }; if (ref) e.src = ref; st.ledger.push(e); };
    var credit = function (p, pts, name, approval, ref) {
      pts = Number(pts) || 0;
      if (!pts || !p || !p.points_enabled) return;
      if (approval) st.pending.push(Object.assign({ id: uid(), kind: "aufgabe", name: name, person: p.id, points: pts, ts: now }, ref));
      else book(p.id, pts, name, ref);
    };
    var uncredit = function (pid, pts, name, ref) {
      pts = Number(pts) || 0;
      var hi = st.history.findIndex(function (h) { return h.person === pid && h.name === name && String(h.ts).slice(0, 10) === t; });
      if (hi >= 0) st.history.splice(hi, 1);
      var m = st.pending.filter(function (x) { return x.person === pid && Object.keys(ref).every(function (k) { return x[k] === ref[k]; }); })[0];
      if (m) { st.pending = st.pending.filter(function (x) { return x !== m; }); return; }
      // Nur zurückbuchen, was für genau diesen Haken auch gutgeschrieben wurde
      for (var li = st.ledger.length - 1; li >= 0; li--) {
        var le = st.ledger[li], src = le.src || {};
        if (le.person === pid && le.delta > 0 && !le.undone && Object.keys(ref).every(function (k) { return src[k] === ref[k]; })) {
          le.undone = true; book(pid, -le.delta, "↩︎ " + name); return;
        }
      }
    };
    switch (action) {
      case "check_pin":
        return Promise.resolve({ ok: !st.settings.pin || data.pin === st.settings.pin });
      case "complete_task":
      case "undo_task": {
        var task = find("tasks", data.task), p = find("persons", data.person);
        if (!task) break;
        task.done = task.done || {};
        var key = Logic.taskKey(task, data.person), ref = { ref: task.id, date: t };
        if (action === "complete_task") {
          if (!p) break;
          task.done[key] = t; task.last_by = p.id;
          if (Logic.taskMode(task) === "reihum") task.rotate_index = (task.rotate_index || 0) + 1;
          st.history.unshift({ id: uid(), kind: "aufgabe", name: task.name, person: p.id, ts: now });
          credit(p, task.points, task.name, task.needs_approval, ref);
        } else if (task.done[key] === t) {
          var who = Logic.taskMode(task) === "jeder" ? data.person : task.last_by;
          delete task.done[key];
          if (Logic.taskMode(task) === "reihum") task.rotate_index = Math.max(0, (task.rotate_index || 0) - 1);
          uncredit(who, task.points, task.name, ref);
        }
        break;
      }
      case "complete_step":
      case "undo_step": {
        var r = find("routines", data.routine), pr = find("persons", data.person);
        if (!r || !pr) break;
        var sid = data.step || "*";
        var step = (r.steps || []).filter(function (x) { return x.id === sid; })[0];
        var nm = step ? r.name + " · " + step.name : r.name, pts = Number((step || r).points) || 0;
        r.done = r.done || {};
        var rec = r.done[pr.id] && r.done[pr.id].date === t ? r.done[pr.id].steps.slice() : [];
        var rref = { ref: r.id, step: sid, date: t };
        if (action === "complete_step") {
          if (rec.indexOf(sid) >= 0) break;
          rec.push(sid);
          st.history.unshift({ id: uid(), kind: "routine", name: nm, person: pr.id, ts: now });
          credit(pr, pts, nm, r.needs_approval, rref);
        } else {
          if (rec.indexOf(sid) < 0) break;
          rec = rec.filter(function (x) { return x !== sid; });
          uncredit(pr.id, pts, nm, rref);
        }
        r.done[pr.id] = { date: t, steps: rec };
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
        if (pe) { book(pe.person, pe.points, (pe.kind === "belohnung" ? "🎁 " : "") + pe.name, pe.kind === "aufgabe" ? { ref: pe.ref, step: pe.step, date: pe.date } : null); st.pending = st.pending.filter(function (x) { return x.id !== data.id; }); }
        break;
      }
      case "reject": {
        var rj = st.pending.filter(function (x) { return x.id === data.id; })[0];
        st.pending = st.pending.filter(function (x) { return x.id !== data.id; });
        if (rj && rj.kind === "aufgabe" && rj.date === t) {
          if (rj.step) {
            var rr = find("routines", rj.ref);
            if (rr && rr.done && rr.done[rj.person] && rr.done[rj.person].date === t) rr.done[rj.person].steps = rr.done[rj.person].steps.filter(function (x) { return x !== rj.step; });
          } else {
            var tt = find("tasks", rj.ref);
            if (tt && tt.done) { delete tt.done[Logic.taskKey(tt, rj.person)]; if (Logic.taskMode(tt) === "reihum") tt.rotate_index = Math.max(0, (tt.rotate_index || 0) - 1); }
          }
        }
        break;
      }
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
          return Promise.resolve({ added: addToBring(st, recipeIngredients(st, data.meal.recipe)) }).then(this._done.bind(this));
        }
        break;
      case "send_to_bring":
        return Promise.resolve({ added: addToBring(st, data.items || []) }).then(this._done.bind(this));
      case "shopping_add":
        return Promise.resolve({ added: addToBring(st, [data.summary]) }).then(this._done.bind(this));
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
      case "add_event": {
        var sid = uid();
        mockExpand(data).forEach(function (occ, n) { st.events.push(Object.assign({}, data, occ, { id: sid + "-" + n, series: data.rrule ? sid : null, recurrence_id: data.rrule ? occ.start : null })); });
        break;
      }
      case "update_event": {
        var ue = st.events.filter(function (e) { return e.id === data.id; })[0];
        if (!ue) break;
        var targets = ue.series && data.scope === "all" ? st.events.filter(function (e) { return e.series === ue.series; }) : [ue];
        targets.forEach(function (e) {
          e.title = data.title; e.person = data.person; e.allday = data.allday;
          if (e === ue) { e.start = data.start; e.end = data.end; }
          else if (!data.allday) { e.start = String(e.start).slice(0, 10) + String(data.start).slice(10); e.end = String(e.end).slice(0, 10) + String(data.end).slice(10); }
        });
        if (data.scope === "one") { ue.series = null; ue.recurrence_id = null; ue.rrule = null; }
        break;
      }
      case "delete_event": {
        var de = st.events.filter(function (e) { return e.id === data.id; })[0];
        st.events = st.events.filter(function (e) { return e.id !== data.id && !(de && de.series && data.scope === "all" && e.series === de.series); });
        break;
      }
      case "search_recipes": {
        var q = String(data.query || "").toLowerCase();
        return Promise.resolve({ recipes: st.recipes.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) >= 0; }).map(function (r) { return { slug: r.slug, name: r.name, recipe_id: r.slug }; }) });
      }
      case "set_servings":
        st.meal_servings = st.meal_servings || {};
        if (Number(data.servings) > 0) st.meal_servings[data.date + "|" + data.slot] = Number(data.servings); else delete st.meal_servings[data.date + "|" + data.slot];
        Object.keys(st.meal_servings).forEach(function (k) { var p2 = k.split("|"); if (st.meals[p2[0]] && st.meals[p2[0]][p2[1]]) st.meals[p2[0]][p2[1]].servings = st.meal_servings[k]; });
        break;
      case "noop":
        break;
      case "recipe_ingredients": {
        (data.entries || []).forEach(function (e) { if (e.recipe_id) data.recipe_ids = (data.recipe_ids || []).concat([e.recipe_id]); else if (e.name) data.names = (data.names || []).concat([e.name]); });
        var out = [];
        (data.names || []).forEach(function (n) { var rr = st.recipes.filter(function (x) { return x.name.toLowerCase() === String(n).toLowerCase(); })[0]; if (rr) data.recipe_ids = (data.recipe_ids || []).concat([rr.slug]); });
        (data.recipe_ids || []).forEach(function (rid) { recipeIngredients(st, rid).forEach(function (n) { if (!out.some(function (o) { return o.name === n; })) out.push({ name: n, spec: "" }); }); });
        return Promise.resolve({ items: out });
      }
      default:
        return Promise.reject(new Error("Unbekannte Aktion " + action));
    }
    return Promise.resolve({}).then(this._done.bind(this));
  };
  MockBackend.prototype._done = function (r) { this.save(); if (this.onChange) this.onChange(this.publicState()); return r; };

  // Vorschau: Serientermin in einzelne Termine auflösen (vereinfacht, max. 1 Jahr)
  function mockExpand(ev) {
    if (!ev.rrule) return [{ start: ev.start, end: ev.end }];
    var m = {}; ev.rrule.split(";").forEach(function (x) { var kv = x.split("="); m[kv[0]] = kv[1]; });
    var s0 = parse(ev.start), dur = parse(ev.end) - s0, out = [], n = Number(m.INTERVAL) || 1;
    var timeS = String(ev.start).slice(10), timeE = String(ev.end).slice(10);
    var days = m.BYDAY ? m.BYDAY.split(",").map(function (d) { return ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].indexOf(d); }) : [wd(s0)];
    var until = m.UNTIL ? m.UNTIL.slice(0, 4) + "-" + m.UNTIL.slice(4, 6) + "-" + m.UNTIL.slice(6, 8) : iso(addDays(s0, 365));
    for (var i = 0; i < 400 && out.length < (Number(m.COUNT) || 999); i++) {
      var d = addDays(s0, i), ds = iso(d);
      if (ds > until) break;
      var ok = m.FREQ === "DAILY" ? i % n === 0 : m.FREQ === "WEEKLY" ? days.indexOf(wd(d)) >= 0 && Math.round((weekStart(d) - weekStart(s0)) / 6048e5) % n === 0 : m.FREQ === "MONTHLY" ? d.getDate() === s0.getDate() : d.getDate() === s0.getDate() && d.getMonth() === s0.getMonth();
      if (ok) out.push({ start: ds + timeS, end: iso(new Date(d.getTime() + dur)) + timeE });
    }
    return out;
  }

  function recipeIngredients(st, slug) {
    var r = st.recipes.filter(function (x) { return x.slug === slug; })[0];
    return r ? r.ingredients.slice() : [];
  }
  function addToBring(st, items) {
    var have = st.shopping.map(function (x) { return x.summary.toLowerCase(); });
    var added = 0;
    items.forEach(function (it) {
      var name = typeof it === "string" ? it : it.name;
      if (name && have.indexOf(name.toLowerCase()) < 0) { st.shopping.push({ uid: uid(), summary: name, status: "needs_action" }); have.push(name.toLowerCase()); added++; }
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
        modules: { schule: true, kalender: true, aufgaben: true, punkte: true, essen: true, einkauf: true, wartung: true, muell: true, bilderrahmen: true },
        lock_calendar: true,
        frame: { enabled: true, idle_min: 3, interval_s: 10, night_from: "22:00", night_to: "06:00", media: "media-source://media_source/local/familie" },
        notify: { targets: [], sonos: [], tts: "", language: "de", volume: 0.35, quiet_from: "21:00", quiet_to: "07:00", waste_time: "19:00", maint_time: "08:00", link: "/familienzentrale", events: { approval: { push: true, sonos: false }, waste: { push: true, sonos: true }, maintenance: { push: true, sonos: false } } },
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
        { id: "r1", name: "Morgenroutine", icon: "🌅", persons: ["p3", "p4"], time: "morgen", days: [], steps: [
          { id: "s1", name: "Zähne putzen", icon: "🦷", points: 1 }, { id: "s2", name: "Anziehen", icon: "👕", points: 1 }, { id: "s3", name: "Bett machen", icon: "🛏️", points: 2 }] },
        { id: "r2", name: "Abendroutine", icon: "🌙", persons: ["p3", "p4"], time: "abend", days: [], steps: [
          { id: "s4", name: "Spielzeug aufräumen", icon: "🧸", points: 2 }, { id: "s5", name: "Zähne putzen", icon: "🦷", points: 1 }, { id: "s6", name: "Pyjama anziehen", icon: "😴", points: 1 }] },
        { id: "r3", name: "Schultasche packen", icon: "🎒", persons: ["p3"], time: "abend", days: [6, 0, 1, 2, 3], steps: [], points: 2 },
        { id: "r4", name: "Entsorgen", icon: "♻️", persons: ["p3", "p4"], time: "morgen", days: [5], steps: [
          { id: "s7", name: "Altglas", icon: "🍾", points: 2 }, { id: "s8", name: "Papier bündeln", icon: "📰", points: 2 }] }
      ],
      tasks: [
        { id: "t10", name: "Tisch decken", icon: "🍽️", persons: ["p3", "p4"], mode: "reihum", points: 3, repeat: { type: "daily" }, needs_approval: true, done: {} },
        { id: "t11", name: "Bad putzen", icon: "🛁", persons: ["p1"], mode: "jeder", points: 0, room: "Bad", repeat: { type: "weekly", days: [5] }, done: {} },
        { id: "t12", name: "Pflanzen giessen", icon: "🌱", persons: ["p2"], mode: "jeder", points: 0, repeat: { type: "interval", every: 3, unit: "tage", start: d(0) }, done: {} },
        { id: "t13", name: "Staubsaugen", icon: "🧹", persons: ["p1", "p2"], mode: "reihum", points: 0, repeat: { type: "weekly", days: [wd(t)] }, done: {} },
        { id: "t14", name: "Geschirrspüler ausräumen", icon: "🍽️", persons: ["p1", "p2", "p3"], mode: "gemeinsam", points: 2, repeat: { type: "daily" }, done: {} }
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
      timetable: [
        { id: "l1", person: "p3", subject: "Mathe", icon: "➗", days: [0, 2, 4], start: "08:00", end: "08:45" },
        { id: "l2", person: "p3", subject: "Deutsch", icon: "📖", days: [0, 1, 3], start: "08:50", end: "09:35" },
        { id: "l3", person: "p3", subject: "Turnen", icon: "🤸", days: [1], start: "13:30", end: "15:05", room: "Turnhalle" },
        { id: "l4", person: "p4", subject: "Kindergarten", icon: "🧸", days: [0, 1, 2, 3, 4], start: "08:15", end: "11:45" }
      ],
      activities: [
        { id: "x1", name: "Fussball", icon: "⚽", persons: ["p3"], days: [2], start: "17:00", end: "18:30", location: "Sportplatz", bring: "Schienbeinschoner", every_weeks: 1, pause_holidays: true },
        { id: "x2", name: "Schwimmkurs", icon: "🏊", persons: ["p4"], days: [5], start: "10:00", end: "10:45", location: "Hallenbad", bring: "Badetuch", every_weeks: 1, pause_holidays: true },
        { id: "x3", name: "Klavier", icon: "🎹", persons: ["p3"], days: [3], start: "15:00", end: "15:30", every_weeks: 2, first: d(0), pause_holidays: true }
      ],
      holidays: [],
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
*{box-sizing:border-box}#root{height:100%}button{font:inherit;color:inherit;cursor:pointer}\
.app{display:flex;height:var(--fz-hoehe,100vh)}\
:host([data-stil=wand]){--bg:rgba(255,255,255,.05);--card:rgba(255,255,255,.07);--ink:#f1eff8;--muted:#a9a4c4;--line:rgba(255,255,255,.10);--rail:rgba(255,255,255,.04);--shadow:none;background:transparent}\
:host([data-stil=wand]) .dlg,:host([data-stil=wand]) .lob div{background:#211e30}\
:host([data-stil=wand]) input,:host([data-stil=wand]) select,:host([data-stil=wand]) textarea{background:#2a2640}\
:host([data-stil=wand]) .toast{background:#f1eff8;color:#211e30}\
:host([data-stil=wand]) .tabs button.on{color:#211e30}\
:host([data-stil=wand]) .chk{background:rgba(255,255,255,.08)}\
:host([data-stil=wand]) .rail button.back{color:var(--ink);background:rgba(255,255,255,.08)}\
.rahmen{position:relative;height:100%;min-height:200px;background:#000;overflow:hidden;border-radius:18px;cursor:pointer}\
:host([data-vollbild]) .rahmen{border-radius:0;height:100vh}\
.rahmen .img{position:absolute;left:0;top:0;right:0;bottom:0;background:#000 center/contain no-repeat;opacity:0;transition:opacity 1.5s}\
:host([data-anpassen=cover]) .rahmen .img{background-size:cover}\
.rahmen .dim{position:absolute;left:0;top:0;right:0;bottom:0;background:#000;opacity:var(--fz-dim,0);pointer-events:none}\
.rahmen .rc{position:absolute;left:28px;bottom:22px;display:flex;flex-direction:column;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.8);pointer-events:none}\
.rahmen .rclock{font-size:72px;font-weight:300;line-height:1;letter-spacing:-2px}\
.rahmen .rdate{font-size:17px;opacity:.85;margin-top:4px}\
.rahmen .rmsg{font-size:13px;opacity:.75;margin-top:8px;max-width:520px}\
.heute{height:100%;display:flex;flex-direction:column;gap:8px;padding:12px;overflow:hidden}\
.heute .hh{display:flex;align-items:center;gap:8px;font-size:17px}\
.heute .hh b{cursor:pointer}\
.heute .hb{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:8px}\
.people.mini{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin:0}\
.mini .pcol{border-radius:14px}\
.mini .pcol .ph{padding:6px 10px;gap:8px}\
.mini .pcol .pb{padding:4px 8px 8px;gap:5px}\
.mini .av{width:28px;height:28px;font-size:13px;border-width:2px}\
.mini .pname{font-size:15px}\
.mini .pts{font-size:12px;padding:2px 8px}\
.mini .ev,.mini .task{font-size:13px;padding:4px 6px;gap:6px}\
.mini .ev .t{min-width:36px}\
.mini .task .ic{font-size:16px;width:20px}\
.mini .chk{width:26px;height:26px;font-size:14px}\
.mini .empty{padding:4px;font-size:12px}\
.heute .line{font-size:13px;padding:6px 10px;border-radius:12px;background:var(--card);border:1px solid var(--line)}\
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
.meal img{display:block;width:100%;height:46px;object-fit:cover;border-radius:6px;margin-bottom:3px}\
.rimg{width:44px;height:44px;object-fit:cover;border-radius:8px;flex:none}\
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
.iconbtn{width:52px;height:46px;border-radius:12px;border:1px solid var(--line);background:var(--bg);font-size:26px;flex:none}\
.igrid{background:var(--bg);border-radius:14px;padding:8px;margin-top:6px;max-height:260px;overflow-y:auto}\
.igrid .ig{font-size:12px;color:var(--muted);font-weight:600;margin:6px 2px 2px}\
.igrid button{width:44px;height:44px;border:0;background:none;font-size:26px;border-radius:10px}\
.igrid button:hover{background:var(--line)}\
.steprow{display:flex;gap:6px;align-items:center;margin-bottom:6px}\
.steprow input[data-st=name]{flex:1}.steprow input[data-st=points]{width:70px}\
.pchip{cursor:pointer;border:0}.pchip.off{opacity:.35;text-decoration:line-through}\
.rperson{display:flex;flex-direction:column;gap:8px;padding:10px 0;border-top:1px solid var(--line)}\
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
    ["start", "🏠", "Start"], ["kalender", "📅", "Kalender"], ["aufgaben", "✅", "Aufgaben"], ["schule", "🎒", "Schule & Freizeit"], ["punkte", "⭐", "Punkte"],
    ["essen", "🍽️", "Essen"], ["einkauf", "🛒", "Einkauf"], ["wartung", "🔧", "Wartung"], ["muell", "🗑️", "Müll"]
  ];

  // Navigation innerhalb von Home Assistant (wie ein Tippen auf einen Link im Dashboard)
  var navigateTo = function (path) {
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  };
  var NAV_IDS = ["start", "kalender", "aufgaben", "schule", "punkte", "essen", "einkauf", "wartung", "muell", "einstellungen"];

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
    _wand() { return this.getAttribute("data-stil") === "wand"; }
    useDemo(seed) { this.backend = new MockBackend(seed); this.backend.onChange = (s) => { this.state = s; this.render(); }; this._start(); }

    connectedCallback() {
      if (!this._boot) {
        this._boot = true;
        this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
        this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
        this.shadowRoot.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target && e.target.id === "shopin") { e.preventDefault(); this._shopAdd(); } });
        ["pointerdown", "keydown", "touchstart"].forEach((ev) => this.shadowRoot.addEventListener(ev, () => this._resetIdle(), { passive: true }));
      }
      clearInterval(this._clock);
      this._clock = setInterval(() => { var c = this.shadowRoot.querySelector(".clock"); if (c) c.textContent = this._time(); }, 15000);
      if (this.backend && this._detached) { this._detached = false; this._start(); }
      if (!this.backend && !window.hassConnection && !this._hass) {
        // Ohne Home Assistant: Vorschau mit Demodaten
        setTimeout(() => { if (!this.backend) this.useDemo(window.FAMILIENZENTRALE_DEMO); }, 50);
      }
    }
    disconnectedCallback() {
      clearInterval(this._clock); clearTimeout(this._idle); clearInterval(this._frameTimer);
      if (this._unsub) { try { this._unsub(); } catch (e) { /* egal */ } this._unsub = null; }
      this._detached = true;
    }

    _start() {
      var h = String(location.hash || "").slice(1);
      if (!this._cfg && NAV_IDS.indexOf(h) >= 0) this.view = h;
      this.backend.load().then((s) => { this.state = s; this.render(); this._resetIdle(); }).catch((e) => this._error(e));
      if (this.backend.subscribe) {
        Promise.resolve(this.backend.subscribe((s) => { this.state = s; this.render(); })).then((u) => { if (this._detached) { try { u(); } catch (e) { /* egal */ } } else this._unsub = u; }).catch(() => { /* altes Backend */ });
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
      var isRetry = data._retry; delete data._retry;
      if (this._pinToken && Date.now() < this.unlockedUntil) data._pin = this._pinToken;
      return this.backend.act(action, data).then((r) => {
        if (!this.backend.onChange && !this._unsub) return this.backend.load().then((s) => { this.state = s; this.render(); return r; });
        return r;
      }).catch((e) => {
        var msg = String(e && e.message || e);
        if (msg.indexOf("Eltern-PIN") >= 0 && !isRetry) {
          this.unlockedUntil = 0; this._pinToken = null;
          var retry = Object.assign({}, data, { _retry: true }); delete retry._pin;
          return new Promise((res, rej) => this.pin(() => this.act(action, retry).then(res, rej), () => rej(e)));
        }
        this.toast("⚠️ " + msg); throw e;
      });
    }

    // ---------- Darstellung ----------
    render() {
      if (!this.state) return;
      var st = this.state, m = st.settings.modules || {};
      this.setAttribute("data-theme", this._wand() ? "dunkel" : (st.settings.theme || "hell"));
      var nav = NAV.filter((n) => n[0] === "start" || m[n[0]] !== false);
      if (nav.map((n) => n[0]).indexOf(this.view) < 0 && this.view !== "einstellungen") this.view = "start";
      var body = this["v_" + this.view] ? this["v_" + this.view]() : "";
      var scroll = this.shadowRoot.querySelector(".main");
      var top = scroll ? scroll.scrollTop : 0;
      var menu = this._hass && this._narrow ? "<button data-act='hamenu'><span class='i'>☰</span>Menü</button>" : "";
      var cfg = this._cfg || {};
      if (cfg.zurueck) menu = "<button class='back' data-act='back'><span class='i'>←</span>" + esc(cfg.zurueck_text || "Start") + "</button>" + menu;
      this._root().innerHTML = "<div class='app'><nav class='rail'>" + menu +
        nav.map((n) => "<button data-act='nav' data-v='" + n[0] + "' class='" + (this.view === n[0] ? "on" : "") + "'><span class='i'>" + n[1] + "</span>" + n[2] + "</button>").join("") +
        "<span class='sp'></span><button data-act='nav' data-v='einstellungen' class='" + (this.view === "einstellungen" ? "on" : "") + "'><span class='i'>⚙️</span>Einstellungen</button></nav>" +
        "<main class='main'>" + (st.version && st.version !== PANEL_VERSION ? "<div class='card' style='margin-bottom:14px;border:2px solid var(--warn)'>🔄 Es ist eine neue Version der Familienzentrale installiert (" + esc(st.version) + "). Bitte die Seite neu laden. <button class='btn sm' data-act='reload'>Neu laden</button></div>" : "") + body + "</main></div>";
      var nm = this.shadowRoot.querySelector(".main");
      if (nm && this._keepScroll) nm.scrollTop = top;
      this._keepScroll = false;
    }

    v_start() {
      var st = this.state, t = todayIso(), now = new Date();
      var head = "<div class='head'><span class='clock'>" + this._time() + "</span><span class='sub'>" + WD_LANG[wd(now)] + ", " + now.getDate() + ". " + MON[now.getMonth()] + " " + now.getFullYear() + "</span><span class='grow'></span>" + this._pendingBadge() + (this._wand() ? "" : "<button class='btn sec sm' data-act='theme' title='Hell / Dunkel'>" + (st.settings.theme === "dunkel" ? "☀️ Hell" : "🌙 Dunkel") + "</button>") + "</div>";
      var cols = st.persons.map((p) => this._personCol(p, t, false)).join("");
      var allEv = this._eventsOn(t).filter((e) => !e.person || !this.person(e.person));
      var common = allEv.length ? "<div class='card' style='margin-bottom:14px'><h3>👪 Alle</h3><div class='list'>" + allEv.map((e) => "<div class='ev'><span class='bar' style='background:var(--accent)'></span><span class='t'>" + this._evTime(e) + "</span><span>" + esc(e.title) + "</span></div>").join("") + "</div></div>" : "";
      var m = st.settings.modules, cards = [];
      if (m.essen !== false) {
        var tm = iso(addDays(now, 1));
        var mealLine = (d, label) => { var x = st.meals[d] || {}; var s = slotsOf(st).filter((sl) => x[sl[0]]).map((sl) => esc(x[sl[0]].name)).join(" · "); return "<div class='row'><b style='min-width:62px'>" + label + "</b><span>" + (s || "<span class='muted'>noch nichts geplant</span>") + "</span></div>"; };
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

    _personCol(p, t, mini) {
      var st = this.state;
      var evs = this._eventsOn(t).filter((e) => e.person === p.id);
      var tasks = st.tasks.filter((x) => Logic.taskToday(x, p.id));
      var rts = st.routines.filter((r) => (r.persons || []).indexOf(p.id) >= 0 && Logic.routineToday(r));
      var done = tasks.filter((x) => Logic.taskDoneFor(x, p.id)).length, total = tasks.length;
      rts.forEach((r) => { var pr = Logic.routineProgress(r, p.id); done += pr[0]; total += pr[1]; });
      var open = tasks.filter((x) => !Logic.taskDoneFor(x, p.id));
      var bodyHtml = "";
      var rows = evs.map((e) => ({ t: this._evTime(e), html: esc(e.title) }));
      if (st.settings.modules.schule !== false) {
        var les = Logic.lessonsOn(st, p.id, t);
        if (les.length) rows.push({ t: les[0].start, html: "🏫 Schule bis " + esc(les[les.length - 1].end) });
        Logic.activitiesOn(st, t, p.id).forEach((a) => rows.push({ t: a.start || "", html: esc(a.icon || "🎯") + " " + esc(a.name) + (a.bring ? " <span class='muted small'>· " + esc(a.bring) + "</span>" : "") }));
      }
      rows.sort((a, b) => (a.t === "ganzt." ? "" : a.t) < (b.t === "ganzt." ? "" : b.t) ? -1 : 1);
      bodyHtml += rows.length ? rows.map((r) => "<div class='ev'><span class='bar' style='background:" + esc(p.color) + "'></span><span class='t'>" + esc(r.t) + "</span><span>" + r.html + "</span></div>").join("") : "<div class='empty'>Keine Termine heute</div>";
      if (total) {
        bodyHtml += "<div class='row small muted'><span>Heute " + done + "/" + total + "</span></div><div class='prog'><i style='width:" + Math.round(100 * done / total) + "%;background:" + esc(p.color) + "'></i></div>";
        rts.forEach((r) => {
          var pr = Logic.routineProgress(r, p.id), ok = pr[0] === pr[1];
          if (!(r.steps || []).length) {
            bodyHtml += "<div class='task " + (ok ? "done" : "") + "'><span class='ic'>" + esc(r.icon || "•") + "</span><span class='nm'>" + esc(r.name) + "</span><button class='chk " + (ok ? "on" : "") + "' data-act='rstep' data-r='" + r.id + "' data-p='" + p.id + "' data-s='*'>" + (ok ? "✓" : "") + "</button></div>";
          } else {
            bodyHtml += "<button class='task' style='border:0;text-align:left' data-act='nav' data-v='aufgaben'><span class='ic'>" + esc(r.icon || "•") + "</span><span class='nm'>" + esc(r.name) + "</span><b class='small' style='color:" + (ok ? "var(--ok)" : "var(--muted)") + "'>" + pr[0] + "/" + pr[1] + (ok ? " ✓" : "") + "</b></button>";
          }
        });
        bodyHtml += open.slice(0, mini ? 3 : 4).map((x) => this._taskRow(x, p.id)).join("");
        if (open.length > (mini ? 3 : 4)) bodyHtml += "<div class='small muted'>+ " + (open.length - (mini ? 3 : 4)) + " weitere</div>";
      }
      return "<div class='pcol'><div class='ph' style='background:" + esc(p.color) + ";color:" + textOn(p.color) + "'>" + this.av(p) + "<span class='pname'>" + esc(p.name) + "</span>" + (p.points_enabled && st.settings.modules.punkte !== false ? "<span class='pts'>⭐ " + Logic.points(st, p.id) + (!mini && Logic.available(st, p.id) !== Logic.points(st, p.id) ? " <small>(" + Logic.available(st, p.id) + " frei)</small>" : "") + "</span>" : "") + "</div><div class='pb'>" + bodyHtml + "</div></div>";
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
      var done = Logic.taskDoneFor(x, pid);
      var hint = Logic.taskMode(x) === "gemeinsam" ? " <span class='muted small'>👪</span>" : Logic.taskMode(x) === "reihum" ? " <span class='muted small'>↻</span>" : "";
      return "<div class='task " + (done ? "done" : "") + "'><span class='ic'>" + esc(x.icon || "•") + "</span><span class='nm'>" + esc(x.name) + hint + (x.points ? " <span class='muted small'>⭐" + x.points + "</span>" : "") + "</span><button class='chk " + (done ? "on" : "") + "' data-act='" + (done ? "undo" : "done") + "' data-id='" + x.id + "' data-p='" + (pid || "") + "'>" + (done ? "✓" : "") + "</button></div>";
    }

    v_kalender() {
      var mode = this.sub.cal || "woche";
      var base = this.sub.calDate ? parse(this.sub.calDate) : new Date();
      var tabs = "<div class='toolbar'><div class='tabs' style='margin:0'><button data-act='calmode' data-v='woche' class='" + (mode === "woche" ? "on" : "") + "'>Woche</button><button data-act='calmode' data-v='monat' class='" + (mode === "monat" ? "on" : "") + "'>Monat</button></div>" +
        "<button class='btn sec sm' data-act='calnav' data-v='-1'>‹</button><button class='btn sec sm' data-act='calnav' data-v='0'>Heute</button><button class='btn sec sm' data-act='calnav' data-v='1'>›</button><span class='grow' style='flex:1'></span><button class='btn' data-act='addevent'>＋ Termin</button></div>";
      var hid = this._calHidden();
      var chip = (key, name, color) => "<button class='pill pchip " + (hid[key] ? "off" : "") + "' data-act='calfilter' data-v='" + key + "' style='background:" + esc(color) + ";color:" + textOn(color) + "'>" + (hid[key] ? "" : "✓ ") + esc(name) + "</button>";
      var legend = "<div class='row small' style='flex-wrap:wrap;margin-bottom:10px'><span class='muted'>Anzeigen:</span>" + this.state.persons.map((p) => chip(p.id, p.name, p.color)).join("") + chip("_alle", "Familie", "#6c5ce7") + "</div>";
      var vis = (e) => !hid[e.person && this.person(e.person) ? e.person : "_alle"];
      var t = todayIso(), html = "";
      if (mode === "woche") {
        var ws = weekStart(base);
        html = "<div class='head'><h1>KW " + this._kw(ws) + "</h1><span class='sub'>" + fmtDate(iso(ws)) + " – " + fmtDate(iso(addDays(ws, 6))) + "</span></div>" + tabs + legend + "<div class='week'>";
        for (var i = 0; i < 7; i++) {
          var d = iso(addDays(ws, i));
          var evs = this._eventsOn(d).filter(vis);
          var waste = this.state.settings.modules.muell !== false ? this.state.waste.filter((w) => Logic.wasteDates(w, 1, d)[0] === d) : [];
          html += "<div class='day " + (d === t ? "today" : "") + "'><div class='dh'><span>" + WD[i] + "</span><span class='muted'>" + parse(d).getDate() + ".</span></div>" +
            waste.map((w) => "<div class='evc' style='background:" + esc(w.color) + "22;color:inherit'>" + esc(w.icon) + " " + esc(w.name) + "</div>").join("") +
            evs.map((e) => { var c = e.person ? this.color(e.person) : "#6c5ce7"; return "<div class='evc' data-act='event' data-id='" + esc(e.id) + "' style='background:" + esc(c) + ";color:" + textOn(c) + "'><b>" + this._evTime(e) + "</b> " + (e.rrule || e.recurrence_id ? "🔁 " : "") + esc(e.title) + "</div>"; }).join("") +
            (this.state.settings.modules.schule !== false ? Logic.activitiesOn(this.state, d).filter((a) => (a.persons || []).some((pid) => !hid[pid])).map((a) => { var c = this.color((a.persons || [])[0]); return "<div class='evc' data-act='nav' data-v='schule' style='border:2px dashed " + esc(c) + ";background:transparent'><b>" + esc(a.start || "") + "</b> " + esc(a.icon || "🎯") + " " + esc(a.name) + " <span class='muted'>" + (a.persons || []).map((pid) => esc((this.person(pid) || {}).name || "")).join(", ") + "</span></div>"; }).join("") : "") + "</div>";
        }
        html += "</div>";
      } else {
        var first = new Date(base.getFullYear(), base.getMonth(), 1);
        var gs = weekStart(first);
        html = "<div class='head'><h1>" + MON[base.getMonth()] + " " + base.getFullYear() + "</h1></div>" + tabs + legend + "<div class='month'>" + WD.map((w) => "<div class='h small muted' style='text-align:center'>" + w + "</div>").join("");
        for (var k = 0; k < 42; k++) {
          var dd = addDays(gs, k), ds = iso(dd);
          var ev = this._eventsOn(ds).filter(vis);
          html += "<div class='mc " + (dd.getMonth() !== base.getMonth() ? "other " : "") + (ds === t ? "today" : "") + "' data-act='dayjump' data-v='" + ds + "'><b>" + dd.getDate() + "</b><div class='dots'>" + ev.map((e) => "<i style='background:" + esc(e.person ? this.color(e.person) : "#6c5ce7") + "'></i>").join("") + "</div></div>";
        }
        html += "</div>";
      }
      return html;
    }
    _calHidden() {
      if (!this.__calHidden) { try { this.__calHidden = JSON.parse(localStorage.getItem("fz_cal_hidden") || "{}"); } catch (e) { this.__calHidden = {}; } }
      return this.__calHidden;
    }
    _kw(d) { var x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); var dn = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - dn); var y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y) / 86400000 + 1) / 7); }

    v_aufgaben() {
      var st = this.state, tab = this.sub.task || "routinen";
      var html = "<div class='head'><h1>Aufgaben</h1><span class='grow'></span><button class='btn sec' data-act='history'>📜 Verlauf</button><button class='btn' data-act='edit' data-col='routines'>＋ Routine</button><button class='btn' data-act='edit' data-col='tasks'>＋ Aufgabe</button></div>";
      html += "<div class='tabs'>" + [["routinen", "Routinen heute"], ["heute", "Aufgaben heute"], ["alle", "Alle verwalten"]].map((x) => "<button data-act='tasktab' data-v='" + x[0] + "' class='" + (tab === x[0] ? "on" : "") + "'>" + x[1] + "</button>").join("") + "</div>";
      if (tab === "routinen") {
        var h = new Date().getHours();
        var nowSlot = h < 11 ? "morgen" : h < 16 ? "mittag" : "abend";
        var order = { morgen: 0, mittag: 1, abend: 2 };
        var rs = st.routines.filter((r) => Logic.routineToday(r)).sort((a, b) => (a.time === nowSlot ? -1 : 0) - (b.time === nowSlot ? -1 : 0) || order[a.time] - order[b.time]);
        html += "<div class='routines'>" + (rs.map((r) => {
          var steps = r.steps || [];
          var people = (r.persons || []).map((id) => this.person(id)).filter(Boolean);
          return "<div class='card'><div class='row' style='margin-bottom:4px'><span style='font-size:28px'>" + esc(r.icon || "•") + "</span><div style='flex:1'><b style='font-size:17px'>" + esc(r.name) + "</b><div class='small muted'>" + ((TIMES.filter((x) => x[0] === r.time)[0] || ["", ""])[1]) + " · " + daysText(r.days) + "</div></div><button class='btn sec sm' data-act='edit' data-col='routines' data-id='" + r.id + "'>✏️</button></div>" +
            (people.map((p) => {
              var done = Logic.routineDone(r, p.id), pr = Logic.routineProgress(r, p.id);
              var tiles = steps.length
                ? steps.map((x) => { var dn = done.indexOf(x.id) >= 0; return "<button class='tile " + (dn ? "done" : "") + "' data-act='rstep' data-r='" + r.id + "' data-p='" + p.id + "' data-s='" + esc(x.id) + "'><span class='ic'>" + esc(x.icon || "•") + "</span>" + esc(x.name) + (x.points ? "<span class='pt'>⭐ " + x.points + "</span>" : "") + "</button>"; }).join("")
                : (function (dn) { return "<button class='tile " + (dn ? "done" : "") + "' data-act='rstep' data-r='" + r.id + "' data-p='" + p.id + "' data-s='*'><span class='ic'>" + esc(r.icon || "✅") + "</span>Erledigt" + (r.points ? "<span class='pt'>⭐ " + r.points + "</span>" : "") + "</button>"; })(done.indexOf("*") >= 0);
              return "<div class='rperson'><div class='row'>" + this.av(p, "s") + "<b>" + esc(p.name) + "</b><span style='flex:1'></span><span class='small' style='color:" + (pr[0] === pr[1] ? "var(--ok)" : "var(--muted)") + "'>" + pr[0] + "/" + pr[1] + (pr[0] === pr[1] ? " ✓" : "") + "</span></div><div class='tiles'>" + tiles + "</div></div>";
            }).join("") || "<div class='empty'>Keine Person zugeteilt</div>") + "</div>";
        }).join("") || "<div class='card empty'>Heute stehen keine Routinen an. Mit „＋ Routine“ legst du eine an, zum Beispiel „Morgenroutine“ mit den Schritten Zähne putzen, Anziehen, Bett machen.</div>") + "</div>";
      } else if (tab === "heute") {
        html += "<div class='people'>" + st.persons.map((p) => {
          var ts = st.tasks.filter((x) => Logic.taskToday(x, p.id));
          return "<div class='pcol'><div class='ph' style='background:" + esc(p.color) + ";color:" + textOn(p.color) + "'>" + this.av(p, "s") + "<span class='pname'>" + esc(p.name) + "</span></div><div class='pb'>" + (ts.map((x) => this._taskRow(x, p.id)).join("") || "<div class='empty'>Nichts fällig 🎉</div>") + "</div></div>";
        }).join("") + "</div>";
      } else {
        var names = (ids, sep) => (ids || []).map((id) => esc((this.person(id) || {}).name || "?")).join(sep || ", ");
        html += "<div class='card' style='margin-bottom:14px'><h3>🔁 Routinen</h3><div class='list'>" + (st.routines.map((r) => "<div class='task'><span class='ic'>" + esc(r.icon || "•") + "</span><span class='nm'><b>" + esc(r.name) + "</b><br><span class='small muted'>" + ((TIMES.filter((x) => x[0] === r.time)[0] || ["", ""])[1]) + " · " + daysText(r.days) + " · " + names(r.persons) + " · " + ((r.steps || []).length ? (r.steps.length + " Schritte") : "ohne Schritte") + (r.needs_approval ? " · mit Bestätigung" : "") + "</span></span><button class='btn sec sm' data-act='edit' data-col='routines' data-id='" + r.id + "'>✏️</button></div>").join("") || "<div class='empty'>Noch keine Routinen</div>") + "</div></div>";
        html += "<div class='card'><h3>🧹 Aufgaben</h3><div class='list'>" + (st.tasks.map((x) => "<div class='task'><span class='ic'>" + esc(x.icon || "•") + "</span><span class='nm'><b>" + esc(x.name) + "</b><br><span class='small muted'>" + esc(Logic.repeatText(x.repeat)) + " · " + names(x.persons, Logic.taskMode(x) === "reihum" ? " ↻ " : ", ") + " · " + Logic.modeText(x.mode) + (x.points ? " · ⭐" + x.points : "") + (x.needs_approval ? " · mit Bestätigung" : "") + "</span></span><button class='btn sec sm' data-act='edit' data-col='tasks' data-id='" + x.id + "'>✏️</button></div>").join("") || "<div class='empty'>Noch keine Aufgaben</div>") + "</div></div>";
      }
      return html;
    }

    v_schule() {
      var st = this.state, tab = this.sub.school || "stundenplan", t = todayIso();
      var kids = st.persons.filter((p) => p.role === "kind");
      var plist = kids.length ? kids : st.persons;
      var sel = this.sub.schoolP && this.person(this.sub.schoolP) ? this.sub.schoolP : (plist[0] || {}).id;
      var addBtn = { stundenplan: ["timetable", "＋ Lektion"], freizeit: ["activities", "＋ Aktivität"], ferien: ["holidays", "＋ Ferien"] }[tab];
      var html = "<div class='head'><h1>Schule & Freizeit</h1><span class='grow'></span><button class='btn' data-act='edit' data-col='" + addBtn[0] + "'>" + addBtn[1] + "</button></div>";
      html += "<div class='tabs'>" + [["stundenplan", "🏫 Stundenplan"], ["freizeit", "⚽ Sport & Freizeit"], ["ferien", "🏖️ Ferien"]].map((x) => "<button data-act='schooltab' data-v='" + x[0] + "' class='" + (tab === x[0] ? "on" : "") + "'>" + x[1] + "</button>").join("") + "</div>";
      var hol = (st.holidays || []).filter((h) => h.from <= t && t <= h.to)[0];
      if (hol) html += "<div class='card' style='margin-bottom:14px'>🏖️ Zurzeit: <b>" + esc(hol.name) + "</b> bis " + fmtDate(hol.to) + "</div>";
      if (tab === "stundenplan") {
        html += "<div class='row' style='flex-wrap:wrap;margin-bottom:12px'>" + plist.map((p) => "<button class='pill pchip " + (p.id === sel ? "" : "off") + "' data-act='schoolp' data-v='" + p.id + "' style='background:" + esc(p.color) + ";color:" + textOn(p.color) + ";text-decoration:none'>" + esc(p.name) + "</button>").join("") + "</div>";
        var les = (st.timetable || []).filter((l) => l.person === sel);
        var maxDay = les.some((l) => (l.days || []).map(Number).some((x) => x > 4)) ? 7 : 5;
        var ws = weekStart(new Date());
        html += "<div class='week' style='grid-template-columns:repeat(" + maxDay + ",minmax(0,1fr))'>";
        for (var i = 0; i < maxDay; i++) {
          var d = iso(addDays(ws, i));
          var dl = les.filter((l) => (l.days || []).map(Number).indexOf(i) >= 0).sort((a, b) => String(a.start) < String(b.start) ? -1 : 1);
          html += "<div class='day " + (d === t ? "today" : "") + "'><div class='dh'><span>" + WD_LANG[i] + "</span></div>" +
            (dl.map((l) => "<div class='evc' data-act='edit' data-col='timetable' data-id='" + l.id + "' style='background:var(--bg);color:inherit;cursor:pointer'><b>" + esc(l.start) + "–" + esc(l.end) + "</b><br>" + esc(l.icon || "") + " " + esc(l.subject) + (l.room ? "<br><span class='muted'>" + esc(l.room) + "</span>" : "") + "</div>").join("") || "<div class='empty small'>frei</div>") + "</div>";
        }
        html += "</div>";
        if (!les.length) html += "<div class='card empty' style='margin-top:12px'>Noch kein Stundenplan. Mit „＋ Lektion“ trägst du Fach, Tage und Zeit ein, z. B. Mathe Mo + Mi 08:00–08:45.</div>";
      } else if (tab === "freizeit") {
        var acts = (st.activities || []).slice().sort((a, b) => ((a.days || [9])[0] - (b.days || [9])[0]) || (String(a.start) < String(b.start) ? -1 : 1));
        html += "<div class='grid' style='grid-template-columns:repeat(auto-fill,minmax(260px,1fr))'>" + (acts.map((a) => {
          var c = this.color((a.persons || [])[0]);
          var season = a.season_from || a.season_to ? "<br>Saison " + (a.season_from ? fmtDate(a.season_from) : "…") + " – " + (a.season_to ? fmtDate(a.season_to) : "…") : "";
          return "<div class='card' style='border-left:8px solid " + esc(c) + "'><div class='row'><span style='font-size:30px'>" + esc(a.icon || "🎯") + "</span><div style='flex:1'><b style='font-size:17px'>" + esc(a.name) + "</b><div class='small muted'>" + (a.persons || []).map((pid) => esc((this.person(pid) || {}).name || "?")).join(", ") + "</div></div><button class='btn sec sm' data-act='edit' data-col='activities' data-id='" + a.id + "'>✏️</button></div>" +
            "<div class='small' style='margin-top:6px'>" + daysText(a.days) + (Number(a.every_weeks) > 1 ? " (alle " + a.every_weeks + " Wochen)" : "") + " · " + esc(a.start || "") + (a.end ? "–" + esc(a.end) : "") + (a.location ? "<br>📍 " + esc(a.location) : "") + (a.bring ? "<br>🎒 " + esc(a.bring) : "") + season + (a.pause_holidays ? "<br><span class='muted'>pausiert in den Ferien</span>" : "") + "</div></div>";
        }).join("") || "<div class='card empty'>Noch keine Aktivitäten. Mit „＋ Aktivität“ trägst du z. B. Fussball am Mittwoch 17:00–18:30 ein.</div>") + "</div>";
        // Wochenübersicht
        var ws2 = weekStart(new Date());
        html += "<div class='card' style='margin-top:14px'><h3>Diese Woche</h3><div class='list'>";
        var any = false;
        for (var k = 0; k < 7; k++) {
          var dd = iso(addDays(ws2, k)), aa = Logic.activitiesOn(st, dd);
          if (!aa.length) continue; any = true;
          html += "<div class='row'><b style='min-width:34px'>" + WD[k] + "</b><span>" + aa.map((a) => esc(a.start || "") + " " + esc(a.icon || "") + " " + esc(a.name) + " <span class='muted'>(" + (a.persons || []).map((pid) => esc((this.person(pid) || {}).name || "")).join(", ") + ")</span>").join(" · ") + "</span></div>";
        }
        html += (any ? "" : "<div class='empty'>Diese Woche keine Aktivitäten</div>") + "</div></div>";
      } else {
        var hs = (st.holidays || []).slice().sort((a, b) => a.from < b.from ? -1 : 1);
        html += "<div class='card'><div class='list'>" + (hs.map((h) => "<div class='task'><span class='ic'>🏖️</span><span class='nm'><b>" + esc(h.name) + "</b><br><span class='small muted'>" + fmtDate(h.from) + " – " + fmtDate(h.to) + (h.to < t ? " · vorbei" : h.from <= t ? " · jetzt" : "") + "</span></span><button class='btn sec sm' data-act='edit' data-col='holidays' data-id='" + h.id + "'>✏️</button></div>").join("") || "<div class='empty'>Noch keine Ferien erfasst. In den Ferien wird der Stundenplan auf der Startseite ausgeblendet und Aktivitäten mit „pausiert in den Ferien“ fallen weg.</div>") + "</div></div>";
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
      html += "<div class='people'>" + kids.map((p) => "<button class='pcol' data-act='pp' data-v='" + p.id + "' style='border:" + (p.id === sel ? "3px solid " + esc(p.color) : "1px solid var(--line)") + ";text-align:left;padding:0'><div class='ph' style='background:" + esc(p.color) + ";color:" + textOn(p.color) + "'>" + this.av(p) + "<span class='pname'>" + esc(p.name) + "</span><span class='pts' style='font-size:22px'>⭐ " + Logic.points(st, p.id) + (Logic.available(st, p.id) !== Logic.points(st, p.id) ? " <small>(" + Logic.available(st, p.id) + " frei)</small>" : "") + "</span></div></button>").join("") + "</div>";
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
      var mo = st.mealie || {};
      var src = this.backend instanceof MockBackend ? "Vorschau" : mo.ok ? "aus Mealie" : mo.error ? "⚠️ Mealie nicht erreichbar" : "Mealie nicht eingerichtet – Plan nur hier gespeichert";
      var html = "<div class='head'><h1>Essensplan</h1><span class='sub'>" + esc(src) + " · Zutaten an Bring: " + beh + "</span></div>";
      html += "<div class='toolbar'><div class='tabs' style='margin:0'><button data-act='mealweek' data-v='0' class='" + (off === 0 ? "on" : "") + "'>Diese Woche</button><button data-act='mealweek' data-v='1' class='" + (off === 1 ? "on" : "") + "'>Nächste Woche</button></div><span style='flex:1'></span>" + (st.settings.mealie.to_bring !== "never" ? "<button class='btn' data-act='weekbring' data-v='" + iso(ws) + "'>🛒 Zutaten der Woche an Bring</button>" : "") + "</div>";
      html += "<div class='card'><div class='meals'><div></div>";
      for (var i = 0; i < 7; i++) { var d = iso(addDays(ws, i)); html += "<div class='h " + (d === t ? "today" : "") + "'>" + WD[i] + " " + parse(d).getDate() + ".</div>"; }
      slotsOf(st).forEach((sl) => {
        html += "<div class='sl'>" + sl[1] + "</div>";
        for (var j = 0; j < 7; j++) {
          var dd = iso(addDays(ws, j)), m = (st.meals[dd] || {})[sl[0]];
          html += "<button class='meal " + (m ? "set" : "") + "' data-act='meal' data-d='" + dd + "' data-s='" + sl[0] + "'>" + (m ? (m.image ? "<img src='" + esc(m.image) + "' alt='' loading='lazy' onerror='this.remove()'>" : "") + esc(m.name) + (m.recipe ? " <span class='muted'>📖</span>" : "") + (m.more ? " <span class='muted'>+" + m.more + "</span>" : "") + (m.servings && m.servings !== this._defServings() ? " <span class='muted'>👥" + m.servings + "</span>" : "") : "<span class='muted'>＋</span>") + "</button>";
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
          return "<div class='card' style='border-left:8px solid " + esc(w.color) + "'><div class='row'><span style='font-size:30px'>" + esc(w.icon) + "</span><b style='font-size:18px'>" + esc(w.name) + "</b><span style='flex:1'></span><button class='btn sec sm' data-act='edit' data-col='waste' data-id='" + w.id + "'>✏️</button></div><div class='small muted' style='margin:6px 0'>" + (r.type === "weekly" ? (r.every_weeks > 1 ? "alle " + r.every_weeks + " Wochen" : "jede Woche") + " am " + WD_LANG[r.weekday] : "nur einzelne Daten") + "</div><div class='list'>" + (ds.map((d) => { var n = daysBetween(todayIso(), d); return "<div class='row'><span>" + fmtDate(d) + "</span><span class='muted small' style='margin-left:auto'>" + (n === 0 ? "heute" : n === 1 ? "morgen" : "in " + n + " Tagen") + "</span></div>"; }).join("") || "<div class='empty'>Keine Termine</div>") + "</div></div>";
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
        "<div class='card set-sec'><h3>🍽️ Mealie & Bring</h3><div class='form'><label class='f'>Zutaten an Bring<select data-chg='mealie' data-k='to_bring'>" + [["auto", "automatisch beim Eintragen"], ["button", "auf Knopfdruck (mit Auswahl)"], ["never", "nie"]].map((o) => "<option value='" + o[0] + "'" + (s.mealie.to_bring === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></label><label class='f'>Einkaufsliste für Zutaten und Einkauf<select data-chg='mealie' data-k='bring_list'><option value=''>– bitte wählen –</option>" + this._todoLists().map((o) => "<option value='" + esc(o.entity_id) + "'" + (s.mealie.bring_list === o.entity_id ? " selected" : "") + ">" + esc(o.name) + (o.platform === "bring" ? " · Bring" : "") + "</option>").join("") + "</select></label><label class='f'>Standard: für wie viele Personen wird gekocht<input type='number' min='1' max='30' data-chg='servings' value='" + esc(this._defServings()) + "'></label><label class='f'>Grundzutaten, die nie vorausgewählt sind (kommagetrennt)<input data-chg='skiplist' value='" + esc(((s.mealie || {}).skip || []).join(", ")) + "'></label><div class='f'><span class='small muted'><b>Zeilen im Essensplan</b></span><div class='grid' style='grid-template-columns:repeat(auto-fill,minmax(130px,1fr))'>" + ALL_SLOTS.map((x) => "<label class='row'><input type='checkbox' data-chg='slot' data-v='" + x[0] + "'" + (slotsOf(st).some((y) => y[0] === x[0]) ? " checked" : "") + ">" + x[1] + "</label>").join("") + "</div></div></div></div>" +
        this._notifySettings(st, s) +
        "<div class='card set-sec'><h3>🖼️ Bilderrahmen</h3><div class='form'><label class='f'>Medienordner (Name unter HA-Medien, z. B. Bilder)<input data-chg='frame' data-k='media' placeholder='Bilder' value='" + esc(s.frame.media) + "'></label>" +
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
        case "nav": if (this._navOut) { this._navOut(v); break; } this.view = v; this.render(); break;
        case "back": navigateTo((this._cfg || {}).zurueck || "/"); break;
        case "reload": location.reload(); break;
        case "notifytest": this.pin(() => this._notifyTest()); break;
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
        case "schooltab": this.sub.school = v; this.render(); break;
        case "schoolp": this.sub.schoolP = v; this.render(); break;
        case "mealweek": this.sub.mealWeek = Number(v); this.render(); break;
        case "pp": this.sub.pp = v; this.render(); break;
        case "done": if (el.getAttribute("data-p")) { el.classList.add("on"); el.textContent = "✓"; } this._complete(id, el.getAttribute("data-p")); break;
        case "undo": el.classList.remove("on"); el.textContent = ""; this._keepScroll = true; this.act("undo_task", { task: id, person: el.getAttribute("data-p") }); break;
        case "rstep": { var wasDone = el.classList.contains("done") || el.classList.contains("on"); el.classList.toggle(el.classList.contains("chk") ? "on" : "done", !wasDone); this._routineStep(el.getAttribute("data-r"), el.getAttribute("data-p"), el.getAttribute("data-s"), wasDone); break; }
        case "calfilter": { var hh = this._calHidden(); hh[v] = !hh[v]; try { localStorage.setItem("fz_cal_hidden", JSON.stringify(hh)); } catch (e2) { /* egal */ } this.render(); break; }
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
        case "shopadd": this._shopAdd(); break;
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
    _defServings() { var m = (this.state && this.state.settings.mealie) || {}; return Number(m.servings) || 4; }
    _shopAdd() {
      var inp = this.shadowRoot.getElementById("shopin");
      var v = inp ? inp.value.trim() : "";
      if (!v) return;
      this._keepScroll = true;
      this.act("shopping_add", { summary: v }).then((r) => {
        if (r && r.added === 0) this.toast("„" + v + "“ steht schon auf der Liste");
        var i2 = this.shadowRoot.getElementById("shopin"); if (i2) i2.focus();
      });
    }
    _notifySettings(st, s) {
      var n = s.notify || {}, ev = n.events || {};
      var box = (key, list) => (list.length ? list.map((o) => "<label class='row'><input type='checkbox' data-chg='nlist' data-k='" + key + "' data-v='" + esc(o.id || o.entity_id) + "'" + ((n[key] || []).indexOf(o.id || o.entity_id) >= 0 ? " checked" : "") + "> " + esc(o.name) + "</label>").join("") : "<div class='small muted'>Nichts gefunden</div>");
      var evRow = (k, label) => { var e = ev[k] || {}; return "<tr><td>" + label + "</td><td style='text-align:center'><input type='checkbox' data-chg='nev' data-e='" + k + "' data-k='push'" + (e.push ? " checked" : "") + "></td><td style='text-align:center'><input type='checkbox' data-chg='nev' data-e='" + k + "' data-k='sonos'" + (e.sonos ? " checked" : "") + "></td></tr>"; };
      return "<div class='card set-sec'><h3>🔔 Benachrichtigungen</h3><div class='form'>" +
        "<div class='f'><span class='small muted'><b>Push und Telegram an</b> (Eltern)</span>" + box("targets", st.notify_targets || []) + "</div>" +
        "<div class='f'><span class='small muted'><b>Ansagen auf Lautsprechern</b></span>" + box("sonos", st.speakers || []) + "</div>" +
        "<div class='row'><label class='f' style='flex:2'>Stimme<select data-chg='notify' data-k='tts'><option value=''>automatisch</option>" + (st.tts_list || []).map((o) => "<option value='" + esc(o.entity_id) + "'" + (n.tts === o.entity_id ? " selected" : "") + ">" + esc(o.name) + "</option>").join("") + "</select></label>" +
        "<label class='f' style='flex:1'>Lautstärke %<input type='number' min='5' max='100' step='5' data-chg='nvol' value='" + Math.round((Number(n.volume) || 0.35) * 100) + "'></label></div>" +
        "<div class='row'><label class='f' style='flex:1'>Keine Ansagen von<input type='time' data-chg='notify' data-k='quiet_from' value='" + esc(n.quiet_from) + "'></label><label class='f' style='flex:1'>bis<input type='time' data-chg='notify' data-k='quiet_to' value='" + esc(n.quiet_to) + "'></label></div>" +
        "<table class='small' style='width:100%;border-collapse:collapse'><tr><th style='text-align:left'>Wann</th><th>📱 Push</th><th>🔊 Ansage</th></tr>" +
        evRow("approval", "Kind hat etwas erledigt / will einlösen (mit Knopf „Bestätigen“ im iPhone)") +
        evRow("waste", "Müll am Vorabend") + evRow("maintenance", "Wartung fällig") + "</table>" +
        "<div class='row'><label class='f' style='flex:1'>Müll-Erinnerung um<input type='time' data-chg='notify' data-k='waste_time' value='" + esc(n.waste_time) + "'></label><label class='f' style='flex:1'>Wartung um<input type='time' data-chg='notify' data-k='maint_time' value='" + esc(n.maint_time) + "'></label></div>" +
        "<label class='f'>Link beim Antippen der Nachricht<input data-chg='notify' data-k='link' placeholder='/familienzentrale' value='" + esc(n.link) + "'></label>" +
        "<button class='btn sec' data-act='notifytest'>📨 Testnachricht senden</button></div></div>";
    }
    _notifyTest() {
      var names = {};
      (this.state.notify_targets || []).forEach((o) => { names[o.id] = o.name; });
      (this.state.speakers || []).forEach((o) => { names[o.entity_id] = "🔊 " + o.name; });
      this.toast("Wird gesendet …");
      this.act("notify_test", {}).then((r) => {
        var rows = ((r && r.results) || []).map((x) => "<div class='row'>" + (x.ok ? "✅" : "⚠️") + " <b>" + esc(names[x.id] || x.id) + "</b>" + (x.ok ? "" : " <span class='small muted'>" + esc(x.error || "") + "</span>") + "</div>").join("");
        this.dialog("📨 Testnachricht", "<p class='small muted'>„✅“ heisst: Home Assistant hat die Nachricht angenommen. Ob sie ankommt, siehst du am Gerät.</p>" + rows, [["OK", ""]]);
      }).catch(() => { /* Meldung kommt aus act */ });
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
        case "nlist": { var lst = (s.notify[k] || []).filter((x) => x !== el.getAttribute("data-v")); if (el.checked) lst.push(el.getAttribute("data-v")); save("notify", Object.assign({}, s.notify, { [k]: lst })); break; }
        case "nev": { var evs = JSON.parse(JSON.stringify(s.notify.events || {})); var en = el.getAttribute("data-e"); evs[en] = Object.assign({}, evs[en] || {}, { [k]: el.checked }); save("notify", Object.assign({}, s.notify, { events: evs })); break; }
        case "nvol": save("notify", Object.assign({}, s.notify, { volume: Math.max(5, Math.min(100, Number(el.value) || 35)) / 100 })); break;
        case "servings": save("mealie", Object.assign({}, s.mealie, { servings: Math.max(1, Math.min(30, Number(el.value) || 4)) })); break;
        case "skiplist": save("mealie", Object.assign({}, s.mealie, { skip: el.value.split(",").map((x) => x.trim()).filter(Boolean) })); break;
        case "slot": { var on = slotsOf(this.state).map((x) => x[0]).filter((x) => x !== el.getAttribute("data-v")); if (el.checked) on.push(el.getAttribute("data-v")); on = ALL_SLOTS.map((x) => x[0]).filter((x) => on.indexOf(x) >= 0); if (!on.length) { el.checked = true; break; } save("mealie", Object.assign({}, s.mealie, { slots: on })); break; }
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
    _routineStep(rid, pid, sid, isDone) {
      var r = this.state.routines.filter((x) => x.id === rid)[0];
      if (!r) return;
      this._keepScroll = true;
      if (isDone) return this.act("undo_step", { routine: rid, person: pid, step: sid });
      var step = (r.steps || []).filter((x) => x.id === sid)[0];
      this.act("complete_step", { routine: rid, person: pid, step: sid }).then(() => this.lob(pid, { points: Number((step || r).points) || 0, needs_approval: r.needs_approval }));
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
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol", t: "icon" },
          { k: "persons", l: "Wer?", t: "persons" },
          { k: "mode", l: "Bei mehreren Personen", t: "select", o: [["jeder", "Jeder erledigt sie für sich"], ["gemeinsam", "Einer für alle (wer zuerst kommt)"], ["reihum", "Reihum, jedes Mal jemand anderes"]] },
          { k: "repeat", l: "Wann?", t: "repeat" },
          { k: "points", l: "Punkte", t: "number" }, { k: "needs_approval", l: "Punkte erst nach Bestätigung durch Eltern", t: "toggle" },
          { k: "room", l: "Raum (optional)", t: "text" }
        ], def: { icon: "✨", persons: [], mode: "jeder", points: 1, repeat: { type: "daily" } } },
        routines: { title: "Routine", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol", t: "icon" },
          { k: "persons", l: "Für wen?", t: "persons" }, { k: "time", l: "Tageszeit", t: "select", o: TIMES },
          { k: "days", l: "An welchen Tagen? (keiner gewählt = täglich)", t: "days" },
          { k: "steps", l: "Schritte (jede Person hakt sie für sich ab)", t: "steps" },
          { k: "points", l: "Punkte, wenn die Routine keine Schritte hat", t: "number" },
          { k: "needs_approval", l: "Punkte erst nach Bestätigung durch Eltern", t: "toggle" }
        ], def: { icon: "🌅", time: "morgen", days: [], steps: [], points: 1, persons: st.persons.filter((p) => p.role === "kind").map((p) => p.id) } },
        rewards: { title: "Belohnung", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol", t: "icon" }, { k: "cost", l: "Preis in Punkten", t: "number" },
          { k: "needs_approval", l: "Eltern müssen bestätigen", t: "toggle" }
        ], def: { icon: "🎁", cost: 20, needs_approval: true } },
        maintenance: { title: "Wartung", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol", t: "icon" },
          { k: "every", l: "Wiederholen alle", t: "number" }, { k: "unit", l: "Einheit", t: "select", o: UNITS },
          { k: "warn_days", l: "Vorwarnung (Tage vorher)", t: "number" }, { k: "next", l: "Nächster Termin", t: "date" },
          { k: "note", l: "Notiz", t: "textarea" }
        ], def: { icon: "🔧", every: 1, unit: "jahre", warn_days: 14, next: todayIso() } },
        timetable: { title: "Lektion", fields: [
          { k: "person", l: "Für", t: "select", o: personOpts }, { k: "subject", l: "Fach", t: "text" }, { k: "icon", l: "Symbol", t: "icon" },
          { k: "days", l: "Tage", t: "days" }, { k: "start", l: "Von", t: "time" }, { k: "end", l: "Bis", t: "time" },
          { k: "room", l: "Zimmer / Lehrperson (optional)", t: "text" }
        ], def: { person: this.sub.schoolP || (st.persons.filter((p) => p.role === "kind")[0] || st.persons[0] || {}).id, icon: "📚", days: [], start: "08:00", end: "08:45" } },
        activities: { title: "Aktivität", fields: [
          { k: "name", l: "Name (z. B. Fussball, Klavier)", t: "text" }, { k: "icon", l: "Symbol", t: "icon" },
          { k: "persons", l: "Wer?", t: "persons" }, { k: "days", l: "Tage", t: "days" },
          { k: "start", l: "Von", t: "time" }, { k: "end", l: "Bis", t: "time" },
          { k: "every_weeks", l: "alle … Wochen (1 = jede Woche)", t: "number" }, { k: "first", l: "Erster Termin (nur bei alle 2+ Wochen)", t: "date" },
          { k: "location", l: "Ort", t: "text" }, { k: "bring", l: "Mitnehmen (z. B. Turnsack, Noten)", t: "text" },
          { k: "season_from", l: "Saison von (optional)", t: "date" }, { k: "season_to", l: "Saison bis (optional)", t: "date" },
          { k: "pause_holidays", l: "In den Ferien keine Aktivität", t: "toggle" }
        ], def: { icon: "⚽", persons: [], days: [], start: "16:00", end: "17:00", every_weeks: 1, pause_holidays: true } },
        holidays: { title: "Ferien / schulfrei", fields: [
          { k: "name", l: "Name (z. B. Herbstferien)", t: "text" }, { k: "from", l: "Von", t: "date" }, { k: "to", l: "Bis", t: "date" }
        ], def: { name: "Ferien", from: todayIso(), to: todayIso() } },
        waste: { title: "Müllart", fields: [
          { k: "name", l: "Name", t: "text" }, { k: "icon", l: "Symbol", t: "icon" }, { k: "color", l: "Farbe", t: "color" },
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
        if (col === "timetable" && !(it.days || []).length) { this.toast("Bitte mindestens einen Tag wählen"); return Promise.reject(new Error("tage")); }
        if (col === "activities") { it.every_weeks = Number(it.every_weeks) || 1; if (!(it.days || []).length) { this.toast("Bitte mindestens einen Tag wählen"); return Promise.reject(new Error("tage")); } }
        if (col === "holidays" && it.from > it.to) { this.toast("„Bis“ liegt vor „Von“"); return Promise.reject(new Error("datum")); }
        if (col === "maintenance") { it.every = Number(it.every) || 1; it.warn_days = Number(it.warn_days) || 0; }
        if (col === "rewards") it.cost = Number(it.cost) || 0;
        if (col === "tasks") { it.points = Number(it.points) || 0; it.done = it.done || {}; delete it.routine; delete it.rotate; }
        if (col === "routines") { it.points = Number(it.points) || 0; it.done = it.done || {}; delete it.person; }
        return this.act("save_item", { collection: col, item: it });
      }, id ? () => this.dialog("Löschen?", "<p>„" + esc(item.name) + "“ wirklich löschen?</p>", [["Abbrechen", "sec"], ["Löschen", "bad", () => this.act("delete_item", { collection: col, id: id })]]) : null);
      // Personen, Belohnungen und Wartung ändern nur Erwachsene
      if (["persons", "rewards", "maintenance", "waste", "tasks", "routines", "timetable", "activities", "holidays"].indexOf(col) >= 0) this.pin(go); else go();
    }

    form(title, fields, vals, onSave, onDelete) {
      var get = (o, k) => k.split(".").reduce((x, p) => (x == null ? undefined : x[p]), o);
      var set = (o, k, v) => { var ps = k.split("."), x = o; ps.slice(0, -1).forEach((p) => { x[p] = x[p] || {}; x = x[p]; }); x[ps[ps.length - 1]] = v; };
      var state = JSON.parse(JSON.stringify(vals || {}));
      var html = "<div class='form'>" + fields.map((f) => {
        var v = get(state, f.k);
        var name = "data-k='" + f.k + "'";
        if (f.t === "pin") return "<label class='f'>" + esc(f.l) + "<input type='password' inputmode='numeric' pattern='[0-9]*' maxlength='4' autocomplete='off' " + name + "></label>";
        if (f.t === "time") return "<label class='f'>" + esc(f.l) + "<input type='time' " + name + " value='" + esc(v == null ? "" : v) + "'></label>";
        if (f.t === "text" || f.t === "number" || f.t === "date") return "<label class='f'>" + esc(f.l) + "<input type='" + f.t + "' " + name + " value='" + esc(v == null ? "" : v) + "'></label>";
        if (f.t === "textarea") return "<label class='f'>" + esc(f.l) + "<textarea " + name + " rows='2'>" + esc(v || "") + "</textarea></label>";
        if (f.t === "color") return "<label class='f'>" + esc(f.l) + "<input type='color' " + name + " value='" + esc(v || "#888888") + "'></label>";
        if (f.t === "toggle") return "<label class='row'><input type='checkbox' " + name + (v ? " checked" : "") + "> " + esc(f.l) + "</label>";
        if (f.t === "select") return "<label class='f'>" + esc(f.l) + "<select " + name + ">" + f.o.map((o) => "<option value='" + esc(o[0]) + "'" + (String(v == null ? "" : v) === String(o[0]) ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select></label>";
        if (f.t === "dates") return "<label class='f'>" + esc(f.l) + "<input " + name + " data-t='dates' value='" + esc((v || []).join(", ")) + "'></label>";
        if (f.t === "photo") return "<label class='f'>" + esc(f.l) + "<input type='file' accept='image/*' " + name + " data-t='photo'></label>";
        if (f.t === "persons") return "<div class='f'><span class='small muted'><b>" + esc(f.l) + "</b></span><div class='who'>" + this.state.persons.map((p) => "<label style='display:flex;align-items:center;gap:8px;background:var(--bg);padding:8px;border-radius:12px'><input type='checkbox' data-k='" + f.k + "' data-t='persons' value='" + p.id + "'" + ((v || []).indexOf(p.id) >= 0 ? " checked" : "") + ">" + this.av(p, "s") + esc(p.name) + "</label>").join("") + "</div></div>";
        if (f.t === "icon") return "<div class='f'><span class='small muted'><b>" + esc(f.l) + "</b></span><div class='row'><button type='button' class='iconbtn' data-iconbtn>" + esc(v || "✨") + "</button><input " + name + " data-t='icon' value='" + esc(v || "") + "' style='width:90px' placeholder='Emoji'><span class='small muted'>antippen zum Auswählen</span></div></div>";
        if (f.t === "days") return "<div class='f'><span class='small muted'><b>" + esc(f.l) + "</b></span><div class='days' data-days='" + f.k + "'>" + WD.map((w, i) => "<button type='button' data-wd='" + i + "' class='" + ((v || []).map(Number).indexOf(i) >= 0 ? "on" : "") + "'>" + w + "</button>").join("") + "</div></div>";
        if (f.t === "steps") return "<div class='f'><span class='small muted'><b>" + esc(f.l) + "</b></span><div data-steps='" + f.k + "'>" + (v || []).map((x) => this._stepRow(x)).join("") + "</div><button type='button' class='btn sec sm' data-addstep style='align-self:flex-start'>＋ Schritt</button></div>";
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
      if (onDelete) btns.unshift(["🗑️ Löschen", "bad", () => { onDelete(); return false; }]);
      var dlg;
      btns.push(["Speichern", "", () => {
        dlg.querySelectorAll("[data-k]").forEach((inp) => {
          var k = inp.getAttribute("data-k"), t = inp.getAttribute("data-t");
          if (t === "persons") return;
          if (t === "photo") return;
          if (inp.closest(".steprow")) return;
          if (inp.type === "checkbox") set(state, k, inp.checked);
          else if (t === "dates") set(state, k, inp.value.split(",").map((x) => x.trim()).filter(Boolean));
          else if (inp.type === "number") set(state, k, inp.value === "" ? null : Number(inp.value));
          else set(state, k, inp.value);
        });
        var pk = dlg.querySelector("[data-t=persons]");
        if (pk) set(state, pk.getAttribute("data-k"), Array.prototype.map.call(dlg.querySelectorAll("[data-t=persons]:checked"), (x) => x.value));
        if (state.repeat && state.repeat.type === "weekly") state.repeat.days = Array.prototype.map.call(dlg.querySelectorAll("[data-day].on"), (b) => Number(b.getAttribute("data-day")));
        if (state.repeat && state.repeat.type === "interval" && !state.repeat.start) state.repeat.start = todayIso();
        dlg.querySelectorAll("[data-days]").forEach((box) => set(state, box.getAttribute("data-days"), Array.prototype.map.call(box.querySelectorAll("[data-wd].on"), (b) => Number(b.getAttribute("data-wd")))));
        dlg.querySelectorAll("[data-steps]").forEach((box) => set(state, box.getAttribute("data-steps"), Array.prototype.map.call(box.querySelectorAll(".steprow"), (row) => ({
          id: row.getAttribute("data-sid") || uid(),
          icon: row.querySelector("[data-st=icon]").value,
          name: row.querySelector("[data-st=name]").value.trim(),
          points: Number(row.querySelector("[data-st=points]").value) || 0
        })).filter((x) => x.name)));
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
      dlg.addEventListener("click", (e) => {
        var b = e.target.closest("[data-day],[data-wd]"); if (b) { b.classList.toggle("on"); return; }
        if (e.target.closest("[data-addstep]")) {
          var box = e.target.closest(".f").querySelector("[data-steps]");
          box.insertAdjacentHTML("beforeend", this._stepRow({ icon: "✨", name: "", points: 1 }));
          var inp = box.lastElementChild.querySelector("[data-st=name]"); if (inp) inp.focus();
          return;
        }
        var del = e.target.closest("[data-delstep]"); if (del) { del.closest(".steprow").remove(); return; }
        var ib = e.target.closest("[data-iconbtn]");
        if (ib) {
          var old = dlg.querySelector(".igrid");
          var same = old && old.__for === ib;
          if (old) old.remove();
          if (same) return;
          var grid = document.createElement("div"); grid.className = "igrid"; grid.__for = ib;
          grid.innerHTML = ICONS.map((g) => "<div class='ig'>" + esc(g[0]) + "</div>" + g[1].map((ic) => "<button type='button' data-emoji='" + ic + "'>" + ic + "</button>").join("")).join("");
          (ib.closest(".steprow") || ib.closest(".f")).insertAdjacentElement("afterend", grid);
          return;
        }
        var em = e.target.closest("[data-emoji]");
        if (em) {
          var g2 = em.closest(".igrid"), tgt = g2.__for, val = em.getAttribute("data-emoji");
          tgt.textContent = val;
          var hold = tgt.parentNode.querySelector("[data-t=icon],[data-st=icon]"); if (hold) hold.value = val;
          g2.remove();
        }
      });
      dlg.addEventListener("input", (e) => { if (e.target.getAttribute("data-t") === "icon") { var bb = e.target.parentNode.querySelector("[data-iconbtn]"); if (bb) bb.textContent = e.target.value || "✨"; } });
    }

    _stepRow(x) {
      return "<div class='steprow' data-sid='" + esc(x.id || "") + "'><button type='button' class='iconbtn' data-iconbtn>" + esc(x.icon || "✨") + "</button><input type='hidden' data-st='icon' value='" + esc(x.icon || "✨") + "'><input data-st='name' placeholder='z. B. Zähne putzen' value='" + esc(x.name || "") + "'><input type='number' min='0' data-st='points' title='Punkte' value='" + esc(x.points == null ? 1 : x.points) + "'><button type='button' class='btn sec sm' data-delstep title='Schritt entfernen'>✕</button></div>";
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
        { k: "allday", l: "Ganztägig", t: "toggle" }, { k: "from", l: "Von", t: "time" }, { k: "to", l: "Bis", t: "time" },
        { k: "rr_freq", l: "🔁 Wiederholen", t: "select", o: [["", "nicht wiederholen"], ["DAILY", "täglich"], ["WEEKLY", "wöchentlich"], ["MONTHLY", "monatlich (gleicher Tag)"], ["YEARLY", "jährlich"]] },
        { k: "rr_interval", l: "alle … (1 = jede/n, 2 = jede zweite …)", t: "number" },
        { k: "rr_days", l: "an Wochentagen (nur bei wöchentlich, leer = Wochentag des Datums)", t: "days" },
        { k: "rr_until", l: "Serie endet am (leer = ohne Ende)", t: "date" },
        { k: "rr_count", l: "oder nach so vielen Terminen", t: "number" }
      ], { date: this.sub.calDate || todayIso(), from: "09:00", to: "10:00", rr_interval: 1, rr_days: [] }, (v) => {
        if (!v.title) { this.toast("Bitte einen Titel eingeben"); return Promise.reject(new Error("titel")); }
        var ev = { title: v.title, person: v.person || null, allday: !!v.allday };
        if (v.allday) { ev.start = v.date; ev.end = iso(addDays(parse(v.date), 1)); }
        else { ev.start = v.date + "T" + (v.from || "09:00") + ":00"; ev.end = v.date + "T" + (v.to || v.from || "10:00") + ":00"; }
        var rr = Logic.buildRrule(v, ev.allday);
        if (rr) ev.rrule = rr;
        return this.act("add_event", ev).then(() => this.toast(rr ? "🔁 Serientermin angelegt" : "✓ Termin angelegt"));
      });
    }
    _editEvent(e) {
      var series = !!(e.rrule || e.recurrence_id);
      var cal = [["", "Alle / Familie"]].concat(this.state.persons.map((p) => [p.id, p.name]));
      var fields = [
        { k: "title", l: "Titel", t: "text" }, { k: "person", l: "Für", t: "select", o: cal }, { k: "date", l: "Datum", t: "date" },
        { k: "allday", l: "Ganztägig", t: "toggle" }, { k: "from", l: "Von", t: "time" }, { k: "to", l: "Bis", t: "time" }
      ];
      if (series) fields.push({ k: "scope", l: "🔁 Änderung gilt für", t: "select", o: [["one", "Nur diesen Termin"], ["all", e.edit_mode === "caldav" ? "Ganze Serie (Titel, Uhrzeit, Person)" : "Diesen und alle folgenden"]] });
      var allday = !!e.allday || String(e.start).length <= 10;
      var vals = { title: e.title, person: e.person || "", date: String(e.start).slice(0, 10), allday: allday, from: allday ? "09:00" : String(e.start).slice(11, 16), to: allday ? "10:00" : String(e.end).slice(11, 16), scope: "one" };
      var days = allday ? Math.max(1, daysBetween(String(e.start).slice(0, 10), String(e.end).slice(0, 10))) : 0;
      this.form("✏️ Termin bearbeiten", fields, vals, (v) => {
        if (!v.title) { this.toast("Bitte einen Titel eingeben"); return Promise.reject(new Error("titel")); }
        var u = { id: e.id, recurrence_id: e.recurrence_id || null, scope: v.scope || "one", title: v.title, person: v.person || null, allday: !!v.allday, description: e.description || "" };
        if (v.allday) { u.start = v.date; u.end = iso(addDays(parse(v.date), days || 1)); }
        else { u.start = v.date + "T" + (v.from || "09:00") + ":00"; u.end = v.date + "T" + (v.to || v.from || "10:00") + ":00"; }
        if (!v.allday && u.end <= u.start) { this.toast("„Bis“ muss nach „Von“ liegen"); return Promise.reject(new Error("zeit")); }
        return this.act("update_event", u).then(() => this.toast("✓ Termin geändert"));
      });
    }
    _eventDlg(id) {
      var e = this.state.events.filter((x) => x.id === id)[0];
      if (!e) return;
      var p = this.person(e.person);
      var series = !!(e.rrule || e.recurrence_id);
      var del = (scope) => () => { this.closeDialog(); (this.state.settings.lock_calendar ? this.pin.bind(this) : (f) => f())(() => this.act("delete_event", { id: id, recurrence_id: e.recurrence_id || null, scope: scope }).then(() => this.toast(scope === "all" && series ? "🗑️ Serie gelöscht" : "🗑️ Termin gelöscht"))); return false; };
      var canDel = e.can_delete !== false, canEdit = e.can_edit !== false;
      this.dialog(esc(e.title), "<p>" + (p ? this.av(p, "s") + " " + esc(p.name) + "<br>" : "") + fmtDate(e.start) + " · " + this._evTime(e) + (e.location ? "<br>📍 " + esc(e.location) : "") + (series ? "<br>🔁 " + esc(Logic.rruleText(e.rrule) || "Serientermin") : "") + "</p>" + (canDel ? "" : "<p class='small muted'>Dieser Kalender erlaubt Home Assistant kein Löschen. Ändern oder löschen bitte in der Kalender-App (z. B. iPhone-Kalender).</p>"),
        (!canDel ? [] : series ? [["🗑️ Nur diesen", "bad", del("one")], ["🗑️ Ganze Serie", "bad", del("all")]] : [["🗑️ Löschen", "bad", del("all")]])
          .concat(canEdit ? [["✏️ Bearbeiten", "", () => { this.closeDialog(); (this.state.settings.lock_calendar ? this.pin.bind(this) : (f) => f())(() => this._editEvent(e)); return false; }]] : [])
          .concat([["Schliessen", "sec"]]));
    }

    _mealDlg(date, slot) {
      var cur = (this.state.meals[date] || {})[slot];
      var dlg = this.dialog("🍽️ " + fmtDate(date) + " · " + (ALL_SLOTS.filter((s) => s[0] === slot)[0] || ["", slot])[1],
        "<div class='form'><div class='row'><span>👥 Für</span><button type='button' class='btn sec sm' data-sv='-1'>−</button><b id='svn' style='min-width:28px;text-align:center'>" + (cur && cur.servings || this._defServings()) + "</b><button type='button' class='btn sec sm' data-sv='1'>＋</button><span>Personen</span><span class='small muted'>(Mengen werden hochgerechnet)</span></div><input id='rq' placeholder='Rezept in Mealie suchen oder frei eintippen' value='" + esc(cur ? cur.name : "") + "'><div id='rl' class='list'><div class='empty'>Suche …</div></div></div>",
        [["🗑️ Leeren", "bad", () => this.act("set_meal", { date: date, slot: slot, meal: null })], ["Abbrechen", "sec"], ["✓ Übernehmen", "", () => { var qv = dlg.querySelector("#rq").value.trim(); if (cur && qv === cur.name) return saveSv().then(() => this.act("noop", {})); return saveSv().then(() => this.act("set_meal", { date: date, slot: slot, meal: qv ? { name: qv } : null })); }]]);
      var q = dlg.querySelector("#rq"), rl = dlg.querySelector("#rl"), timer;
      var sv = Number(cur && cur.servings || this._defServings());
      var saveSv = () => { var n = sv === this._defServings() ? 0 : sv; return this.backend.act("set_servings", { date: date, slot: slot, servings: n }); };
      dlg.addEventListener("click", (e) => { var b = e.target.closest("[data-sv]"); if (!b) return; sv = Math.max(1, Math.min(30, sv + Number(b.getAttribute("data-sv")))); dlg.querySelector("#svn").textContent = sv; });
      var search = () => this.backend.act("search_recipes", { query: q.value === (cur && cur.name) ? "" : q.value }).then((r) => {
        if (r.error) { rl.innerHTML = "<div class='empty'>" + esc(r.error) + " – mit „Übernehmen“ als Freitext eintragen.</div>"; return; }
        rl.innerHTML = (r.recipes || []).slice(0, 24).map((x) => "<button class='task' style='border:0;text-align:left' data-slug='" + esc(x.slug || "") + "' data-rid='" + esc(x.recipe_id || x.slug || "") + "' data-img='" + esc(x.image || "") + "' data-name='" + esc(x.name) + "'>" + (x.image ? "<img class='rimg' src='" + esc(x.image) + "' alt='' loading='lazy' onerror='this.replaceWith(document.createTextNode(\"📖\"))'>" : "<span class='ic'>📖</span>") + "<span class='nm'>" + esc(x.name) + "</span></button>").join("") || "<div class='empty'>Kein Rezept gefunden – mit „Übernehmen“ als Freitext eintragen.</div>";
      }).catch((e) => { rl.innerHTML = "<div class='empty'>Mealie nicht erreichbar: " + esc(e && e.message || e) + "</div>"; });
      q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 250); });
      rl.addEventListener("click", (e) => {
        var b = e.target.closest("[data-slug]"); if (!b) return;
        this.closeDialog();
        saveSv().then(() => this.act("set_meal", { date: date, slot: slot, meal: { name: b.getAttribute("data-name"), recipe: b.getAttribute("data-slug"), recipe_id: b.getAttribute("data-rid") } })).then((r) => {
          if (r && r.added != null) this.toast("🛒 " + r.added + " Zutaten an Bring geschickt");
        });
      });
      search();
    }
    _weekBring(startIso) {
      var st = this.state, ids = [], names = [];
      for (var i = 0; i < 7; i++) {
        var d = iso(addDays(parse(startIso), i));
        slotsOf(st).forEach((sl) => {
          var m = (st.meals[d] || {})[sl[0]]; if (!m) return;
          var rid = m.recipe_id || m.recipe;
          // jedes geplante Essen zählt, auch wenn dasselbe Rezept zweimal vorkommt
          if (rid || m.name) ids.push({ recipe_id: rid || null, name: rid ? null : m.name, servings: m.servings || this._defServings() });
        });
      }
      if (!ids.length) return this.toast("In der angezeigten Woche ist noch nichts geplant");
      this.toast("Zutaten werden geladen …");
      this.backend.act("recipe_ingredients", { entries: ids }).then((r) => {
        var items = (r && r.items) || [];
        if (!items.length) return this.toast("Keine Zutaten gefunden – sind die Gerichte als Rezepte in Mealie geplant?");
        var norm = (x) => String(x || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
        var have = st.shopping.map((x) => norm(x.summary));
        var skip = ((st.settings.mealie || {}).skip || []).map(norm);
        var isSkip = (n) => { var parts = norm(n).split(/\s*(?:,|und|&|\/)\s*/).filter(Boolean); return parts.length > 0 && parts.every((x) => skip.indexOf(x) >= 0); };
        var pre = (it) => have.indexOf(norm(it.name)) < 0 && !isSkip(it.name);
        var dlg = this.dialog("🛒 Zutaten an Bring", "<p class='small muted'>Abwählen, was schon da ist. Was bereits auf der Liste steht und Grundzutaten wie Salz sind abgewählt.</p><div class='list'>" + items.map((it, n) => "<label class='task'><input type='checkbox' data-n='" + n + "'" + (pre(it) ? " checked" : "") + "><span class='nm'>" + esc(it.name) + (it.spec ? " <span class='muted'>" + esc(it.spec) + "</span>" : "") + (it.recipes && it.recipes.length ? "<br><span class='small muted'>" + esc(it.recipes.join(", ")) + "</span>" : "") + "</span></label>").join("") + "</div>",
          [["Abbrechen", "sec"], ["An Bring senden", "", () => {
            var sel = Array.prototype.map.call(dlg.querySelectorAll("input:checked"), (x) => items[Number(x.getAttribute("data-n"))]);
            return this.act("send_to_bring", { items: sel }).then((res) => this.toast("🛒 " + (res && res.added != null ? res.added : sel.length) + " Artikel an Bring"));
          }]]);
      }).catch((e) => this.toast("⚠️ " + (e && e.message || e)));
    }

    // ---------- Dialoge ----------
    dialog(title, html, buttons) {
      var layer = this.shadowRoot.getElementById("layer");
      layer.innerHTML = "<div class='ov'><div class='dlg'><h2>" + title + "</h2>" + html + "<div class='acts'>" + (buttons || []).map((b, i) => "<button class='btn " + (b[1] || "") + "' data-b='" + i + "'>" + b[0] + "</button>").join("") + "</div></div></div>";
      var dlg = layer.querySelector(".dlg");
      layer.querySelector(".ov").addEventListener("click", (e) => { if (e.target.classList.contains("ov")) this.closeDialog(); });
      dlg.querySelectorAll("[data-b]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (dlg.__busy) return;
        var fn = buttons[Number(b.getAttribute("data-b"))][2];
        var r = fn ? fn() : null;
        if (r && r.then) {
          dlg.__busy = true;
          dlg.querySelectorAll("[data-b]").forEach((x) => { x.disabled = true; x.style.opacity = ".5"; });
          r.then(() => this.closeDialog()).catch(() => { dlg.__busy = false; dlg.querySelectorAll("[data-b]").forEach((x) => { x.disabled = false; x.style.opacity = ""; }); });
        }
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
    pin(cb, onCancel) {
      if (this._unlocked()) return cb();
      var val = "";
      var dlg = this.dialog("🔒 Eltern-PIN", "<div class='pindots'>" + [0, 1, 2, 3].map(() => "<i></i>").join("") + "</div><div class='pinpad'>" + [1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((n) => n === "" ? "<span></span>" : "<button data-n='" + n + "'>" + n + "</button>").join("") + "</div>", [["Abbrechen", "sec", () => { if (onCancel) onCancel(); }]]);
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
      this.form("🔑 Neue Eltern-PIN", [{ k: "a", l: "Neue PIN (4 Ziffern)", t: "pin" }, { k: "b", l: "Wiederholen", t: "pin" }], {}, (v) => {
        var a = String(v.a == null ? "" : v.a).trim(), b = String(v.b == null ? "" : v.b).trim();
        if (!/^\d{4}$/.test(a) || a !== b) { this.toast("PINs stimmen nicht überein oder sind nicht 4-stellig"); return Promise.reject(new Error("pin")); }
        return this.act("save_settings", { new_pin: a })
          .then(() => this.backend.act("check_pin", { pin: a }))
          .then((r) => { if (r && r.ok) { this._pinToken = r.token || null; this.unlockedUntil = Date.now() + 5 * 60000 - 5000; } this.render(); this.toast("✓ PIN gespeichert"); });
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

  // ---------- Dashboard-Karten ----------
  // Ganze Familienzentrale als Karte (z. B. in einer Dashboard-Seite vom Typ „Panel“)
  //   type: custom:familienzentrale-card
  //   stil: wand                  durchsichtig, Glas-Kacheln, immer dunkel
  //   zurueck: /wand-ipad/start   Knopf „← Start“
  //   ansicht: einkauf            Bereich beim Öffnen (sonst Start); auch über #einkauf in der Adresse
  //   hoehe: 100vh                Höhe der Karte
  class FamilienzentraleCard extends FamilienzentralePanel {
    setConfig(c) {
      this._cfg = Object.assign({}, c || {});
      this.setAttribute("data-embed", "");
      if (this._cfg.stil) this.setAttribute("data-stil", this._cfg.stil); else this.removeAttribute("data-stil");
      if (this._cfg.hoehe) this.style.setProperty("--fz-hoehe", this._cfg.hoehe); else this.style.removeProperty("--fz-hoehe");
      if (this.state) this.render();
    }
    connectedCallback() {
      super.connectedCallback();
      this.view = this._hashView() || (this._cfg && this._cfg.ansicht) || "start";
      if (this.state) this.render();
      if (!this._onLoc) {
        this._onLoc = () => { var v = this._hashView(); if (v && this.isConnected && v !== this.view) { this.view = v; if (this.state) this.render(); } };
        window.addEventListener("location-changed", this._onLoc);
        window.addEventListener("hashchange", this._onLoc);
      }
    }
    _hashView() { var h = String(location.hash || "").slice(1); return NAV_IDS.indexOf(h) >= 0 ? h : null; }
    _resetIdle() { /* Bilderrahmen nur in der eigenen Seite */ }
    getCardSize() { return 12; }
    getGridOptions() { return { columns: "full", rows: 12 }; }
    static getStubConfig() { return { stil: "wand", zurueck: "/" }; }
  }

  // Kompakte Übersicht „Heute“ für eine Startseite
  //   type: custom:familienzentrale-heute-card
  //   stil: wand
  //   ziel: /wand-ipad/familie    Seite mit der ganzen Familienzentrale (Tippen öffnet sie)
  //   titel: Heute
  class FamilienzentraleHeuteCard extends FamilienzentralePanel {
    setConfig(c) {
      this._cfg = Object.assign({}, c || {});
      if (this._cfg.stil) this.setAttribute("data-stil", this._cfg.stil); else this.removeAttribute("data-stil");
      this.style.height = "100%";
      if (this.state) this.render();
    }
    _navOut(v) { var z = (this._cfg || {}).ziel; if (z) navigateTo(z + (v && v !== "start" ? "#" + v : "")); }
    _resetIdle() { /* Ruhebild siehe unten */ }
    connectedCallback() {
      super.connectedCallback();
      if (this._cfg && this._cfg.ruhebild) this._idleStart();
    }
    disconnectedCallback() { super.disconnectedCallback(); this._idleStop(); }
    // Ruhebild: nach einigen Minuten ohne Bedienung Fotos über das ganze Dashboard (nicht in der Nachtruhe)
    _idleStart() {
      if (!this._idleEv) {
        this._idleEv = () => this._idleKick();
        ["pointerdown", "touchstart", "keydown", "wheel"].forEach((n) => window.addEventListener(n, this._idleEv, { capture: true, passive: true }));
      }
      this._idleKick();
    }
    _idleStop() {
      if (this._idleEv) ["pointerdown", "touchstart", "keydown", "wheel"].forEach((n) => window.removeEventListener(n, this._idleEv, { capture: true }));
      this._idleEv = null; clearTimeout(this._idleT); this._closeShow();
    }
    _idleKick() {
      clearTimeout(this._idleT);
      var f = (this.state && this.state.settings.frame) || {};
      var min = Number(this._cfg.ruhebild_minuten || f.idle_min) || 3;
      this._idleT = setTimeout(() => this._openShow(), min * 60000);
    }
    _openShow() {
      if (this._show || !this.isConnected) return;
      if (document.querySelector("familienzentrale-rahmen-card[data-fz-ruhe]")) return; // es läuft schon eine
      if (this.state && this._isNight()) { this._idleKick(); return; }
      var el = document.createElement("familienzentrale-rahmen-card");
      el.setAttribute("data-fz-ruhe", "");
      el.setConfig({ vollbild: true, abdunkeln: this._cfg.ruhebild_abdunkeln || 0, anpassen: this._cfg.anpassen || "contain" });
      el.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:9999";
      el._onTap = () => { this._closeShow(); this._idleKick(); };
      el.title = "Antippen zum Schliessen";
      el.hass = this._hass;
      document.body.appendChild(el);
      this._show = el;
    }
    _closeShow() {
      // alle laufenden Diashows schliessen; kurz durchsichtig stehen lassen, damit das Antippen
      // nicht zusätzlich etwas auf dem Dashboard darunter auslöst
      this._show = null;
      document.querySelectorAll("familienzentrale-rahmen-card[data-fz-ruhe]").forEach(function (el) {
        el.removeAttribute("data-fz-ruhe");
        el.style.opacity = "0";
        el.style.transition = "opacity .2s";
        setTimeout(function () { el.remove(); }, 500);
      });
    }
    render() {
      if (!this.state) return;
      var st = this.state, t = todayIso(), m = st.settings.modules || {};
      this.setAttribute("data-theme", this._wand() ? "dunkel" : (st.settings.theme || "hell"));
      var n = (st.pending || []).length;
      var head = "<div class='hh'><b data-act='nav' data-v='start'>👪 " + esc((this._cfg || {}).titel || "Heute") + "</b><span style='flex:1'></span>" +
        (n ? "<button class='btn sm' data-act='nav' data-v='punkte'>🔔 " + n + " zu bestätigen</button>" : "") + "</div>";
      var allEv = this._eventsOn(t).filter((e) => !e.person || !this.person(e.person));
      var common = allEv.length ? "<div class='line'>👪 " + allEv.map((e) => "<b>" + esc(this._evTime(e)) + "</b> " + esc(e.title)).join(" · ") + "</div>" : "";
      var food = "";
      if (m.essen !== false) {
        var x = st.meals[t] || {};
        var names = slotsOf(st).filter((sl) => x[sl[0]]).map((sl) => esc(x[sl[0]].name));
        if (names.length) food = "<div class='line' data-act='nav' data-v='essen'>🍽️ " + names.join(" · ") + "</div>";
      }
      var cols = st.persons.map((p) => this._personCol(p, t, true)).join("");
      var body = st.persons.length ? "<div class='people mini'>" + cols + "</div>" : "<div class='empty'>Noch keine Personen erfasst</div>";
      this._root().innerHTML = "<div class='heute'>" + head + "<div class='hb'>" + common + body + food + "</div></div>";
    }
    getCardSize() { return 8; }
    getGridOptions() { return { columns: 12, rows: 8 }; }
    static getStubConfig() { return { stil: "wand", ziel: "/" }; }
  }

  // Bilderrahmen: Fotos aus dem Medienordner (Einstellungen → Bilderrahmen) mit Uhr
  //   type: custom:familienzentrale-rahmen-card
  //   abdunkeln: 0.4        dunkler Schleier (0 – 0.9), z. B. für die Nacht
  //   anpassen: contain     ganzes Foto zeigen; cover = Fläche füllen (schneidet ab)
  //   timer: timer.xyz      Antippen startet diesen Timer (z. B. „Nacht geweckt“)
  //   uhr: true
  class FamilienzentraleRahmenCard extends FamilienzentralePanel {
    setConfig(c) {
      this._cfg = Object.assign({ uhr: true }, c || {});
      if (this._cfg.vollbild) this.setAttribute("data-vollbild", ""); else { this.removeAttribute("data-vollbild"); this.style.height = "100%"; }
      this.setAttribute("data-anpassen", this._cfg.anpassen === "cover" ? "cover" : "contain");
      this.style.setProperty("--fz-dim", String(Math.max(0, Math.min(0.9, Number(this._cfg.abdunkeln) || 0))));
    }
    _resetIdle() { /* hier nicht */ }
    connectedCallback() {
      super.connectedCallback();
      if (!this._tapBound) {
        this._tapBound = true;
        // Antippen: schon beim Berühren reagieren (auf dem iPad kommt „click“ bei solchen Flächen nicht immer an)
        var on = () => { var t = Date.now(); if (t - (this._lastTap || 0) < 700) return; this._lastTap = t; this._tap(); };
        ["pointerdown", "touchstart", "mousedown", "click"].forEach((n) => this.shadowRoot.addEventListener(n, on, { passive: true }));
      }
      clearInterval(this._ct);
      this._ct = setInterval(() => this._tick(), 15000);
      if (this.state) this._go();
    }
    disconnectedCallback() { super.disconnectedCallback(); clearInterval(this._ct); clearTimeout(this._rt); this._running = false; }
    _tap() {
      var c = this._cfg || {};
      if (c.timer && this._hass && this._hass.callService) this._hass.callService("timer", "start", { entity_id: c.timer });
      if (this._onTap) this._onTap();
    }
    _tick() {
      var r = this.shadowRoot, d = new Date();
      var c = r.querySelector(".rclock"); if (c) c.textContent = this._cfg.uhr === false ? "" : this._time();
      var t = r.querySelector(".rdate"); if (t) t.textContent = this._cfg.uhr === false ? "" : WD_LANG[wd(d)] + ", " + d.getDate() + ". " + MON[d.getMonth()];
    }
    render() {
      if (!this.state) return;
      this.setAttribute("data-theme", "dunkel");
      if (!this.shadowRoot.querySelector(".rahmen")) {
        this._root().innerHTML = "<div class='rahmen'><div class='img'></div><div class='img'></div><div class='dim'></div><div class='rc'><b class='rclock'></b><span class='rdate'></span><span class='rmsg'></span></div></div>";
        this._k = 0;
      }
      this._tick();
      this._go();
    }
    _go() {
      if (this._running || !this.isConnected) return;
      this._running = true;
      this._next();
    }
    _next() {
      if (!this._running) return;
      var f = (this.state && this.state.settings.frame) || {};
      var wait = Math.max(3, Number(f.interval_s) || 10) * 1000;
      var k = this._k || 0;
      var msg = this.shadowRoot.querySelector(".rmsg");
      this.backend.act("frame_photo", { index: k }).then((r) => new Promise((res, rej) => {
        var img = new Image();
        img.onload = () => res(r.url);
        img.onerror = () => rej(new Error("Foto konnte nicht geladen werden"));
        img.src = r.url;
      })).then((url) => {
        var imgs = this.shadowRoot.querySelectorAll(".rahmen .img");
        if (imgs.length < 2) return;
        var a = imgs[k % 2], b = imgs[(k + 1) % 2];
        b.style.backgroundImage = "url(\"" + url + "\")"; b.style.opacity = 1; a.style.opacity = 0;
        if (msg) msg.textContent = "";
        this._k = k + 1;
      }).catch((e) => {
        if (msg) msg.textContent = "🖼️ " + String(e && e.message || e);
        this._k = k + 1;
        wait = Math.max(wait, 30000);
      }).then(() => { clearTimeout(this._rt); if (this._running) this._rt = setTimeout(() => this._next(), wait); });
    }
    getCardSize() { return 8; }
    getGridOptions() { return { columns: "full", rows: 8 }; }
    static getStubConfig() { return { abdunkeln: 0.4 }; }
  }

  if (!customElements.get("familienzentrale-panel")) customElements.define("familienzentrale-panel", FamilienzentralePanel);
  if (!customElements.get("familienzentrale-rahmen-card")) customElements.define("familienzentrale-rahmen-card", FamilienzentraleRahmenCard);
  if (!customElements.get("familienzentrale-card")) customElements.define("familienzentrale-card", FamilienzentraleCard);
  if (!customElements.get("familienzentrale-heute-card")) customElements.define("familienzentrale-heute-card", FamilienzentraleHeuteCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some(function (c) { return c.type === "familienzentrale-card"; })) {
    window.customCards.push(
      { type: "familienzentrale-card", name: "Familienzentrale", description: "Die ganze Familienzentrale in einer Dashboard-Seite" },
      { type: "familienzentrale-heute-card", name: "Familienzentrale – Heute", description: "Termine, Routinen und Aufgaben pro Person für heute" },
      { type: "familienzentrale-rahmen-card", name: "Familienzentrale – Bilderrahmen", description: "Fotos aus dem Medienordner mit Uhr" }
    );
  }
  window.FamilienzentraleLogic = Logic;
  window.FamilienzentraleDemoSeed = DEMO_SEED;
})();
