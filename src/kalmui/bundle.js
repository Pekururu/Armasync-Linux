/* @ds-bundle: {"format":4,"namespace":"KalmUI","components":[{"name":"Button"},{"name":"AppShell"},{"name":"AppBar"},{"name":"Card"},{"name":"ListRow"},{"name":"Chip"},{"name":"TextField"},{"name":"Switch"},{"name":"Slider"},{"name":"Status"},{"name":"StatusPicker"},{"name":"Disclosure"},{"name":"Sheet"},{"name":"Toast"},{"name":"Banner"},{"name":"EmptyState"},{"name":"FocusCard"},{"name":"ComfortPanel"},{"name":"ProgressRing"},{"name":"Achievement"}]} */
/* KalmUI: plain-DOM helpers. No framework. Every helper works on markup that uses the k- classes in bundle.css. */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement;

  // ---------- Icons: 24px, 2px stroke, round caps ----------
  var OPEN = '<svg class="k-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var PATHS = {
    todo: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2.6 3.1"/>',
    doing: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
    done: '<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path class="k-cut" d="M7.8 12.4l2.8 2.8 5.6-5.8"/>',
    exception: '<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path class="k-cut" d="M12 7.2v5.8"/><path class="k-cut" d="M12 16.7h.01" stroke-width="2.8"/>',
    na: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12h7.6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    more: '<circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none"/>',
    chevron: '<path d="M6 9.5l6 6 6-6"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    back: '<path d="M14.5 6l-6 6 6 6"/>',
    next: '<path d="M9.5 6l6 6-6 6"/>',
    list: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><circle cx="4.8" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="17.5" r="1.1" fill="currentColor" stroke="none"/>',
    focus: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    progress: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5"/><path d="M12 3.5V12h8.5A8.5 8.5 0 0 0 12 3.5z" fill="currentColor" stroke="none" opacity=".35"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.8h.01" stroke-width="2.6"/>',
    alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4"/><path d="M12 16.9h.01" stroke-width="2.6"/>',
    check: '<path d="M5.5 12.5l4 4 9-9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    undo: '<path d="M9 7.5L4.5 12 9 16.5"/><path d="M5 12h9.5a5 5 0 0 1 0 10H12"/>',
    medal: '<circle cx="12" cy="14.5" r="6"/><path d="M8.3 3.5l2.4 5M15.7 3.5l-2.4 5"/><path d="M12 11.6l1 2 2.1.3-1.5 1.5.4 2.1-2-1-2 1 .4-2.1-1.5-1.5 2.1-.3z" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    note: '<path d="M6 4.5h8.5L19 9v10.5H6z"/><path d="M9 12h6.5M9 15.5h4"/>',
    spark: '<path d="M12 4l1.8 4.9 4.9 1.8-4.9 1.8L12 17.4l-1.8-4.9-4.9-1.8 4.9-1.8z"/>',
    skip: '<path d="M6 6.5l7 5.5-7 5.5z"/><path d="M17.5 6.5v11"/>',
    empty: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 13h4.5l1.5 2h4l1.5-2H20"/>'
  };
  function icon(name) { return OPEN + (PATHS[name] || "") + "</svg>"; }

  // ---------- Status set ----------
  var STATUSES = [
    { key: "todo", label: "Not started", short: "Not started", resolved: false, desc: "You haven't looked at this yet." },
    { key: "doing", label: "In progress", short: "In progress", resolved: false, desc: "You're working on it or comparing options." },
    { key: "done", label: "Done", short: "Done", resolved: true, desc: "Finished. Nothing left to do here." },
    { key: "exception", label: "Exception", short: "Exception", resolved: true, desc: "You chose to keep things as they are, on purpose. Note why." },
    { key: "na", label: "Not applicable", short: "N/A", resolved: true, desc: "This doesn't apply to you." }
  ];
  function statuses(labels) {
    return STATUSES.map(function (s) { var o = {}; for (var k in s) o[k] = s[k]; if (labels && labels[s.key]) { for (var j in labels[s.key]) o[j] = labels[s.key][j]; } return o; });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ---------- Comfort settings: text size, motion, sound, celebrations ----------
  var KEY = "kalmui-comfort-v1";
  var DEFAULTS = { scale: 1, motion: "system", sound: false, celebrate: true, calm: false };
  var prefs = (function () { try { var p = JSON.parse(localStorage.getItem(KEY) || "{}"); var o = {}; for (var k in DEFAULTS) o[k] = k in p ? p[k] : DEFAULTS[k]; return o; } catch (e) { return Object.assign({}, DEFAULTS); } })();
  var listeners = [];
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduceMotion() { return prefs.motion === "reduce" || (prefs.motion === "system" && !!(mq && mq.matches)); }
  function apply() {
    root.style.setProperty("--k-scale", String(prefs.scale));
    if (reduceMotion()) root.setAttribute("data-motion", "reduce"); else root.removeAttribute("data-motion");
    if (prefs.calm) root.setAttribute("data-calm", ""); else root.removeAttribute("data-calm");
  }
  function setPref(patch) {
    for (var k in patch) if (k in DEFAULTS) prefs[k] = patch[k];
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {}
    apply();
    listeners.forEach(function (fn) { try { fn(prefs); } catch (e) {} });
  }
  if (mq && mq.addEventListener) mq.addEventListener("change", apply);
  apply();

  function switchRow(id, title, sub, checked) {
    return '<label class="k-switch-row" for="' + id + '"><span class="k-switch-text"><span>' + esc(title) + '</span><span>' + esc(sub) +
      '</span></span><input class="k-switch" type="checkbox" role="switch" id="' + id + '"' + (checked ? " checked" : "") + "></label>";
  }
  // Mounts the standard settings panel into el. opts.play: show the celebrations switch. opts.calm: show the calm-mode switch with this label.
  function mountComfort(el, opts) {
    opts = opts || {};
    var pct = Math.round(prefs.scale * 100);
    el.classList.add("k-comfort");
    el.innerHTML =
      '<div class="k-comfort-group k-comfort-size"><div class="k-comfort-size-head"><b>Text Size</b><span id="k-cf-pct">' + pct + '%</span></div>' +
      '<input class="k-slider" type="range" id="k-cf-scale" min="90" max="140" step="10" value="' + pct + '" aria-label="Text size">' +
      '<div class="k-slider-ends" aria-hidden="true"><span>A</span><span style="font-size:1.3em">A</span></div></div>' +
      '<div class="k-comfort-group">' +
      switchRow("k-cf-motion", "Reduce Motion", "Fewer animations. Follows your device until you change it.", reduceMotion()) +
      (opts.calm ? switchRow("k-cf-calm", opts.calm.title || "Calm Mode", opts.calm.sub || "Hide extra hints and suggestions.", prefs.calm) : "") +
      '</div><div class="k-comfort-group">' +
      switchRow("k-cf-sound", "Sounds", "A soft chime when you finish something. Off by default.", prefs.sound) +
      (opts.play ? switchRow("k-cf-celebrate", "Celebrations", "Confetti when you finish a group or earn a badge.", prefs.celebrate) : "") +
      "</div>";
    var range = el.querySelector("#k-cf-scale");
    var paint = function () { range.style.setProperty("--p", ((range.value - 90) / 50 * 100) + "%"); };
    paint();
    range.addEventListener("input", function () { paint(); el.querySelector("#k-cf-pct").textContent = range.value + "%"; setPref({ scale: range.value / 100 }); });
    el.querySelector("#k-cf-motion").addEventListener("change", function (e) { setPref({ motion: e.target.checked ? "reduce" : "full" }); });
    el.querySelector("#k-cf-sound").addEventListener("change", function (e) { setPref({ sound: e.target.checked }); if (e.target.checked) chime("done", true); });
    var c = el.querySelector("#k-cf-celebrate"); if (c) c.addEventListener("change", function (e) { setPref({ celebrate: e.target.checked }); });
    var m = el.querySelector("#k-cf-calm"); if (m) m.addEventListener("change", function (e) { setPref({ calm: e.target.checked }); });
  }

  // ---------- Slider fill ----------
  function slider(input) {
    var paint = function () { var min = +input.min || 0, max = +input.max || 100; input.style.setProperty("--p", ((input.value - min) / (max - min) * 100) + "%"); };
    input.addEventListener("input", paint); paint();
  }

  // ---------- App bar: sets --t from 0 (expanded) to 1 (collapsed) ----------
  function appBar(el, scroller) {
    var hero = el.querySelector(".k-appbar-hero");
    var target = scroller || window;
    var tick = function () {
      var y = target === window ? window.scrollY : target.scrollTop;
      var h = hero ? Math.max(hero.offsetHeight - 40, 1) : 120;
      el.style.setProperty("--t", Math.min(1, Math.max(0, y / h)).toFixed(3));
    };
    target.addEventListener("scroll", tick, { passive: true }); tick();
    return tick;
  }

  // ---------- Status picker: five tiles as a radiogroup, description underneath ----------
  function picker(el, opts) {
    opts = opts || {};
    var list = statuses(opts.labels), value = opts.value || "todo";
    el.classList.add("k-picker"); el.setAttribute("role", "radiogroup");
    if (opts.label) el.setAttribute("aria-label", opts.label);
    var desc = doc.createElement("p"); desc.className = "k-picker-desc"; desc.setAttribute("aria-live", "polite");
    el.innerHTML = "";
    var tiles = list.map(function (s) {
      var b = doc.createElement("button");
      b.type = "button"; b.className = "k-picker-tile"; b.setAttribute("role", "radio"); b.dataset.status = s.key;
      b.innerHTML = icon(s.key) + "<span>" + esc(s.short) + "</span>";
      b.addEventListener("click", function () { set(s.key, true); });
      b.addEventListener("keydown", function (e) {
        var i = list.indexOf(s), n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!n) return; e.preventDefault(); var t = tiles[(i + n + tiles.length) % tiles.length]; t.focus(); t.click();
      });
      el.appendChild(b); return b;
    });
    el.after(desc);
    function set(v, fromUser) {
      value = v;
      tiles.forEach(function (t) { var on = t.dataset.status === v; t.setAttribute("aria-checked", String(on)); t.tabIndex = on ? 0 : -1; });
      var s = list.filter(function (x) { return x.key === v; })[0];
      desc.innerHTML = s ? "<b>" + esc(s.label) + ".</b> " + esc(s.desc) : "";
      if (fromUser && opts.onChange) opts.onChange(v, s);
    }
    set(value, false);
    return { set: function (v) { set(v, false); }, get: function () { return value; }, statuses: list };
  }

  // ---------- Toast: one at a time, with an optional action such as Undo ----------
  var toastEl, toastTimer;
  function toast(text, opts) {
    opts = opts || {};
    if (!toastEl) {
      toastEl = doc.createElement("div"); toastEl.className = "k-toast"; toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite");
      toastEl.innerHTML = '<span class="k-toast-text"></span><button type="button" class="k-btn" hidden></button>';
      doc.body.appendChild(toastEl);
      toastEl.addEventListener("mouseenter", function () { clearTimeout(toastTimer); });
      toastEl.addEventListener("mouseleave", function () { toastTimer = setTimeout(hideToast, 2500); });
    }
    toastEl.querySelector(".k-toast-text").textContent = text;
    var btn = toastEl.querySelector("button");
    btn.hidden = !opts.action;
    btn.textContent = opts.action || "";
    btn.onclick = function () { hideToast(); if (opts.onAction) opts.onAction(); };
    toastEl.classList.add("is-open");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.duration || (opts.action ? 6000 : 3000));
  }
  function hideToast() { if (toastEl) toastEl.classList.remove("is-open"); }

  // ---------- Sheet: bottom sheet on phones, side sheet on desktop ----------
  var openSheetEl = null, lastFocus = null, scrimEl = null;
  function openSheet(el) {
    if (openSheetEl) closeSheet();
    if (!scrimEl) { scrimEl = doc.createElement("div"); scrimEl.className = "k-scrim"; scrimEl.hidden = true; scrimEl.addEventListener("click", function () { closeSheet(); }); doc.body.appendChild(scrimEl); }
    lastFocus = doc.activeElement; openSheetEl = el;
    el.hidden = false; scrimEl.hidden = false;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add("is-open"); scrimEl.classList.add("is-open"); }); });
    var f = el.querySelector("[autofocus], button, input, textarea, select, a[href]"); if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, 60);
  }
  function closeSheet() {
    var el = openSheetEl; if (!el) return; openSheetEl = null;
    el.classList.remove("is-open"); scrimEl.classList.remove("is-open");
    var done = function () { if (!el.classList.contains("is-open")) el.hidden = true; if (!openSheetEl) scrimEl.hidden = true; };
    setTimeout(done, reduceMotion() ? 0 : 340);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openSheetEl) { e.preventDefault(); closeSheet(); }
    if (e.key === "Tab" && openSheetEl) {
      var f = Array.prototype.filter.call(openSheetEl.querySelectorAll("button, input, textarea, select, a[href], [tabindex='0']"), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && doc.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  // ---------- Progress ring: parts [{value, status}] or a single value ----------
  function ring(opts) {
    var size = opts.size || 120, stroke = opts.stroke || 12, total = opts.total || 1;
    var r = (size - stroke) / 2, C = 2 * Math.PI * r, c = size / 2, off = 0, arcs = "";
    var parts = opts.parts || [{ value: opts.value || 0 }];
    parts.forEach(function (p) {
      var len = Math.max(0, p.value) / total * C;
      if (len > 0) {
        var gap = parts.length > 1 && len > 3 ? 1.5 : 0;
        arcs += '<circle class="k-ring-arc"' + (p.status ? ' data-status="' + p.status + '"' : "") + ' cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke-width="' + stroke +
          '" stroke-dasharray="' + Math.max(len - gap, 0.01).toFixed(2) + " " + C.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" stroke-linecap="butt" transform="rotate(-90 ' + c + " " + c + ')"/>';
      }
      off += len;
    });
    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '" aria-hidden="true"><circle class="k-ring-track" cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke-width="' + stroke + '"/>' + arcs + "</svg>";
    var center = opts.center != null ? '<div class="k-ring-center"><span class="k-ring-value" style="font-size:' + Math.round(size * 0.22) + 'px">' + esc(opts.center) + "</span>" + (opts.label ? '<span class="k-ring-label">' + esc(opts.label) + "</span>" : "") + "</div>" : "";
    return '<div class="k-ring" role="img" aria-label="' + esc(opts.ariaLabel || "") + '">' + svg + center + "</div>";
  }

  // ---------- Play layer: chime and a small, quiet burst ----------
  var ac = null;
  var CHIMES = { done: [659.25, 987.77], group: [523.25, 659.25, 783.99], badge: [587.33, 739.99, 880, 1174.66] };
  function chime(kind, force) {
    if (!prefs.sound && !force) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      (CHIMES[kind] || CHIMES.done).forEach(function (f, i) {
        var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.09;
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.75);
      });
    } catch (e) {}
  }
  function celebrate(opts) {
    opts = opts || {};
    chime(opts.chime || "group");
    if (!prefs.celebrate || reduceMotion()) return false;
    var cv = doc.createElement("canvas"); cv.className = "k-fx"; doc.body.appendChild(cv);
    var ctx = cv.getContext("2d"), dpr = window.devicePixelRatio || 1, W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cs = getComputedStyle(root);
    var cols = ["--accent", "--status-done", "--status-doing", "--status-exception"].map(function (v) { return cs.getPropertyValue(v).trim() || "#5cf074"; });
    var ox = opts.x != null ? opts.x : W / 2, oy = opts.y != null ? opts.y : H * 0.6;
    var parts = [];
    for (var i = 0; i < 42; i++) parts.push({ x: ox, y: oy, vx: (Math.random() - 0.5) * 7, vy: -5 - Math.random() * 6, r: 3 + Math.random() * 4, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.25, c: cols[i % cols.length], round: i % 3 === 0 });
    var start = performance.now(), LIFE = 1300;
    (function frame(now) {
      var t = now - start; ctx.clearRect(0, 0, W, H);
      parts.forEach(function (p) {
        p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t / LIFE); ctx.fillStyle = p.c; ctx.translate(p.x, p.y); ctx.rotate(p.a);
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.r / 1.6, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx.restore();
      });
      if (t < LIFE) requestAnimationFrame(frame); else cv.remove();
    })(start);
    return true;
  }

  // ---------- Focus card transition ----------
  function swap(card, render) {
    if (reduceMotion()) { render(); return; }
    card.classList.remove("is-entering"); card.classList.add("is-leaving");
    setTimeout(function () { render(); card.classList.remove("is-leaving"); void card.offsetWidth; card.classList.add("is-entering"); }, 200);
  }

  window.KalmUI = {
    version: "1.0.0",
    icon: icon, icons: Object.keys(PATHS), esc: esc,
    statuses: statuses,
    prefs: function () { return Object.assign({}, prefs); }, setPref: setPref, onPrefs: function (fn) { listeners.push(fn); }, reduceMotion: reduceMotion,
    mountComfort: mountComfort, slider: slider, appBar: appBar, picker: picker,
    toast: toast, hideToast: hideToast, openSheet: openSheet, closeSheet: closeSheet,
    ring: ring, chime: chime, celebrate: celebrate, swap: swap
  };
})();
