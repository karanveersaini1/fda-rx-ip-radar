/* RxIP Radar frontend. No dependencies. All API-derived strings enter the DOM via
   textContent (never innerHTML) — names and titles are untrusted data. */

"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";

const SERIES = {
  "new-drug": { label: "New drugs (NDA)", badge: "NDA §505(b)(1)", color: "var(--series-1)" },
  biologic: { label: "Biologics (BLA)", badge: "BLA §351(a)", color: "var(--series-2)" },
  generic: { label: "Generics (ANDA)", badge: "ANDA §505(j)", color: "var(--series-3)" },
  supplement: { label: "Supplements", badge: "Supplement", color: "var(--series-4)" },
};
const ORDER = ["new-drug", "biologic", "generic", "supplement"];

const PATENT_KINDS = {
  compound: { label: "Composition of matter", color: "var(--series-1)" },
  formulation: { label: "Formulation (drug product)", color: "var(--series-2)" },
  use: { label: "Method of use (§ viii carve-out possible)", color: "var(--series-3)" },
  listed: { label: "Listed patent (unclassified)", color: "var(--text-muted)" },
  excl: { label: "Regulatory exclusivity", color: "var(--series-4)" },
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const state = { month: "all", category: "originals", query: "", shown: 60, fedregAll: false };
let DATA = null; // {approvals, meta, fedreg, months}

/* ---------- tiny DOM helpers ---------- */

const $ = (sel) => document.querySelector(sel);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function svg(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  return n;
}
function monthLabel(ym) {
  return `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/* ---------- theme ---------- */

function initTheme() {
  const saved = localStorage.getItem("rxip-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme-toggle").addEventListener("click", () => {
    const isDark =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("rxip-theme", next);
  });
}

/* ---------- tabs ---------- */

const TABS = ["radar", "approvals", "fedreg", "primer", "how"];

function initTabs() {
  const nav = $("#tabs");
  const activate = (id) => {
    if (!TABS.includes(id)) id = "radar";
    for (const b of nav.querySelectorAll("button[data-tab]"))
      b.setAttribute("aria-selected", String(b.dataset.tab === id));
    for (const t of TABS) $(`#panel-${t}`).classList.toggle("active", t === id);
    // Filters scope the data tabs; hide them where they'd be inert.
    $("#filters").style.display = id === "radar" || id === "approvals" ? "" : "none";
  };
  nav.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    activate(b.dataset.tab);
    history.replaceState(null, "", `#${b.dataset.tab}`);
  });
  window.addEventListener("hashchange", () => activate(location.hash.slice(1)));
  activate(location.hash.slice(1));
}

/* ---------- filtering ---------- */

function activeCategories() {
  if (state.category === "originals") return ["new-drug", "biologic", "generic"];
  if (state.category === "all") return ORDER.slice();
  return [state.category];
}

function eventCategory(rec, ev) {
  if (ev.type !== "ORIG") return "supplement";
  if (rec.app.startsWith("ANDA")) return "generic";
  if (rec.app.startsWith("BLA")) return "biologic";
  if (rec.app.startsWith("NDA")) return "new-drug";
  return "supplement";
}

function matchesQuery(rec, q) {
  if (!q) return true;
  return [rec.app, rec.sponsor, ...rec.brands, ...rec.generics].join(" ").toLowerCase().includes(q);
}

/** Records passing all filters, each annotated with its matching events.
    ignoreMonth: the 30-day timeline is inherently a recency strip, so it honors
    category + search but not the month chip. */
function filteredRecords(ignoreMonth = false) {
  const cats = new Set(activeCategories());
  const q = state.query.trim().toLowerCase();
  const out = [];
  for (const rec of DATA.approvals) {
    if (!matchesQuery(rec, q)) continue;
    const events = rec.events.filter(
      (ev) => cats.has(eventCategory(rec, ev)) && (ignoreMonth || state.month === "all" || ev.date.startsWith(state.month))
    );
    if (events.length) out.push({ ...rec, matched: events });
  }
  out.sort((a, b) => (a.matched[0].date < b.matched[0].date ? 1 : -1));
  return out;
}

/* ---------- stat tiles ---------- */

function renderTiles(recs) {
  const counts = { "new-drug": 0, biologic: 0, generic: 0, supplement: 0 };
  for (const rec of recs)
    for (const ev of rec.matched) counts[eventCategory(rec, ev)] += 1;

  const runways = [];
  let patentTotal = 0;
  for (const rec of recs) {
    if (!rec.matched.some((ev) => ev.type === "ORIG") || !rec.app.startsWith("NDA")) continue;
    patentTotal += rec.cliff.patent_count;
    const last = rec.cliff.last_patent_expiry;
    const orig = rec.matched.find((ev) => ev.type === "ORIG");
    if (last && orig) runways.push((Date.parse(last) - Date.parse(orig.date)) / 31557600000);
  }
  runways.sort((a, b) => a - b);
  const median = runways.length
    ? (runways.length % 2 ? runways[(runways.length - 1) / 2] : (runways[runways.length / 2 - 1] + runways[runways.length / 2]) / 2)
    : null;

  const tiles = [
    ["New drug approvals", counts["new-drug"], "NDA — FDCA § 505(b)(1)"],
    ["Biologic licenses", counts.biologic, "BLA — PHSA § 351(a)"],
    ["Generic approvals", counts.generic, "ANDA — FDCA § 505(j)"],
    ["Supplement actions", counts.supplement, "post-approval changes"],
    ["Median patent runway", median == null ? "—" : `${median.toFixed(1)} yr`, "approval → last listed patent expiry"],
    ["Orange Book patents", patentTotal, "listed per 21 U.S.C. § 355(b)(1)"],
  ];
  const box = $("#tiles");
  box.replaceChildren();
  for (const [label, value, hint] of tiles) {
    const t = el("div", "tile");
    t.append(el("div", "label", label), el("div", "value", String(value)), el("div", "hint", hint));
    box.append(t);
  }
}

/* ---------- last-30-days timeline ---------- */

const CAT_PRIORITY = { "new-drug": 0, biologic: 1, generic: 2, supplement: 3 };

function renderTimeline30(recs) {
  const endIso = DATA.meta.window.end;
  const endMs = Date.parse(endIso);
  const days = Array.from({ length: 30 }, (_, i) => new Date(endMs - (29 - i) * 86400000).toISOString().slice(0, 10));
  const byDay = new Map(days.map((d) => [d, []]));
  for (const rec of recs)
    for (const ev of rec.matched) {
      const bucket = byDay.get(ev.date);
      if (bucket) bucket.push({ rec, ev, cat: eventCategory(rec, ev) });
    }
  for (const bucket of byDay.values()) bucket.sort((a, b) => CAT_PRIORITY[a.cat] - CAT_PRIORITY[b.cat]);

  const present = new Set();
  for (const bucket of byDay.values()) for (const e of bucket) present.add(e.cat);
  const legend = $("#tl-legend");
  legend.replaceChildren();
  for (const c of ORDER)
    if (present.has(c)) {
      const key = el("span", "key");
      const swatch = el("span", "swatch");
      swatch.style.background = SERIES[c].color;
      swatch.style.borderRadius = "50%";
      key.append(swatch, el("span", null, SERIES[c].label));
      legend.append(key);
    }

  const W = 960, H = 178, PAD = 18, BASE = 144, MAXDOTS = 8, DOT_STEP = 11, R = 4.5;
  const slot = (W - PAD * 2) / days.length;
  const cx = (i) => PAD + slot * i + slot / 2;
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Approval actions in the last 30 days" });

  chart.append(svg("line", { x1: PAD, x2: W - PAD, y1: BASE, y2: BASE, stroke: "var(--baseline)", "stroke-width": 1 }));
  for (const i of [0, 7, 14, 21, 29]) {
    const [, m, d] = days[i].split("-");
    const t = svg("text", { x: cx(i), y: BASE + 18, "text-anchor": "middle", "font-size": 11, fill: "var(--text-muted)" });
    t.textContent = `${MONTH_NAMES[Number(m) - 1]} ${Number(d)}`;
    chart.append(t);
    chart.append(svg("line", { x1: cx(i), x2: cx(i), y1: BASE, y2: BASE + 5, stroke: "var(--baseline)", "stroke-width": 1 }));
  }

  const labeled = [];
  let total = 0;
  days.forEach((day, i) => {
    const bucket = byDay.get(day);
    total += bucket.length;
    bucket.slice(0, MAXDOTS).forEach((e, j) => {
      const cy = BASE - 10 - j * DOT_STEP;
      chart.append(svg("circle", { cx: cx(i), cy, r: R, fill: SERIES[e.cat].color, stroke: "var(--surface-1)", "stroke-width": 2 }));
      if (e.cat === "new-drug" && e.ev.type === "ORIG")
        labeled.push({ x: cx(i), top: cy - R, name: e.rec.brands[0] || e.rec.generics[0] || e.rec.app });
    });
    if (bucket.length > MAXDOTS) {
      const t = svg("text", { x: cx(i), y: BASE - 10 - MAXDOTS * DOT_STEP, "text-anchor": "middle", "font-size": 10, fill: "var(--text-muted)" });
      t.textContent = `+${bucket.length - MAXDOTS}`;
      chart.append(t);
    }

    const hit = svg("rect", { x: PAD + slot * i, y: 6, width: slot, height: BASE - 6, class: "hitband", tabindex: "0", "aria-label": `${day}: ${bucket.length} approval actions` });
    hit.addEventListener("pointerenter", () => showDayTip(day, bucket, hit));
    hit.addEventListener("focus", () => showDayTip(day, bucket, hit));
    hit.addEventListener("pointerleave", hideDayTip);
    hit.addEventListener("blur", hideDayTip);
    chart.append(hit);
  });

  // Direct labels for new drugs only — the series the story is about — on two
  // staggered rows with leader lines down to their dots.
  labeled.sort((a, b) => a.x - b.x);
  const rowEnds = [-Infinity, -Infinity];
  labeled.forEach((d, i) => {
    const wpx = d.name.length * 5.9 + 6;
    const row = i % 2;
    const rowY = row === 0 ? 16 : 32;
    let lx = Math.max(d.x - wpx / 2, rowEnds[row] + 8, PAD);
    lx = Math.min(lx, W - PAD - wpx);
    rowEnds[row] = lx + wpx;
    const center = lx + wpx / 2;
    const t = svg("text", { x: center, y: rowY, "text-anchor": "middle", "font-size": 10.5, fill: "var(--text-secondary)" });
    t.textContent = d.name;
    chart.append(t);
    const elbow = Math.abs(center - d.x) > 4 ? `M${center},${rowY + 4} L${d.x},${rowY + 4} L${d.x},${d.top - 2}` : `M${d.x},${rowY + 4} L${d.x},${d.top - 2}`;
    chart.append(svg("path", { d: elbow, fill: "none", stroke: "var(--grid)", "stroke-width": 1 }));
  });

  if (!total) {
    const t = svg("text", { x: W / 2, y: 80, "text-anchor": "middle", "font-size": 13, fill: "var(--text-muted)" });
    t.textContent = "No approval actions in the trailing 30 days under the current filters.";
    chart.append(t);
  }

  const box = $("#tl-box");
  for (const node of [...box.children]) if (node.tagName === "svg") node.remove();
  box.append(chart);
}

function showDayTip(day, bucket, hit) {
  const tip = $("#tl-tooltip");
  tip.replaceChildren(el("div", "t-title", `${day} · ${bucket.length} action${bucket.length === 1 ? "" : "s"}`));
  for (const e of bucket.slice(0, 6)) {
    const r = el("div", "t-row");
    const key = el("span", "t-key");
    key.style.background = SERIES[e.cat].color;
    r.append(key, el("span", null, e.rec.brands[0] || e.rec.generics[0] || e.rec.app), el("span", "t-val", SERIES[e.cat].badge));
    tip.append(r);
  }
  if (bucket.length > 6) tip.append(el("div", "t-title", `+ ${bucket.length - 6} more — click a row below for detail`));
  tip.style.display = "block";
  const boxRect = $("#tl-box").getBoundingClientRect();
  const hitRect = hit.getBoundingClientRect();
  let x = hitRect.left - boxRect.left + hitRect.width / 2 + 10;
  if (x + tip.offsetWidth > boxRect.width - 4) x = x - tip.offsetWidth - 20;
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = "10px";
}
function hideDayTip() {
  $("#tl-tooltip").style.display = "none";
}

/* ---------- legal impact brief ---------- */

function renderImpact(recs) {
  const list = $("#impact-list");
  list.replaceChildren();

  let estates = 0, estatePatents = 0, bareNewDrugs = 0, nceClocks = 0, generics = 0, efficacy = 0, biologics = 0;
  let pivMin = null, pivMax = null;
  for (const rec of recs) {
    const hasOrig = rec.matched.some((ev) => ev.type === "ORIG");
    if (rec.category === "new-drug" && hasOrig) {
      if (rec.cliff.patent_count) {
        estates += 1;
        estatePatents += rec.cliff.patent_count;
      } else bareNewDrugs += 1;
      const nce = rec.exclusivities.find((e) => e.code.startsWith("NCE") && e.expires);
      if (nce) {
        nceClocks += 1;
        const yr = Number(nce.expires.slice(0, 4)) - 1;
        pivMin = pivMin == null ? yr : Math.min(pivMin, yr);
        pivMax = pivMax == null ? yr : Math.max(pivMax, yr);
      }
    }
    if (rec.category === "biologic" && hasOrig) biologics += 1;
    if (rec.category === "generic" && hasOrig) generics += 1;
    for (const ev of rec.matched)
      if (ev.type !== "ORIG" && /efficacy/i.test(ev.class || "")) efficacy += 1;
  }

  const add = (color, strongText, rest) => {
    const li = el("li");
    li.style.setProperty("--dot", color);
    li.append(el("strong", null, strongText), document.createTextNode(" " + rest));
    list.append(li);
  };

  if (estates)
    add("var(--series-1)", `${estates} new Hatch-Waxman estates —`,
      `${estatePatents} listed patents became statutory gates on generic entry (21 U.S.C. § 355(b)(1)), each now enforceable on an ANDA filing under 35 U.S.C. § 271(e)(2).`);
  if (nceClocks)
    add("var(--series-1)", `${nceClocks} NCE exclusivity clocks started —`,
      `Paragraph IV challenge windows open ${pivMin === pivMax ? pivMin : `${pivMin}–${pivMax}`}; expect the first patent litigation over these drugs then.`);
  if (bareNewDrugs)
    add("var(--text-muted)", `${bareNewDrugs} new approvals show no patent listings yet —`,
      `sponsors have 30 days to file Orange Book listings; the estate is still forming.`);
  if (generics)
    add("var(--series-3)", `${generics} markets opened to generic competition —`,
      `each ANDA approval means the brand's patent and exclusivity wall expired, was carved around (§ viii), or fell to a Paragraph IV challenge.`);
  if (efficacy)
    add("var(--series-4)", `${efficacy} efficacy supplements —`,
      `new indications are how estates grow after approval: each can add method-of-use patents and 3-year (I-code) exclusivity.`);
  if (biologics)
    add("var(--series-2)", `${biologics} biologic licenses entered the BPCIA regime —`,
      `12-year reference-product exclusivity begins; patent disputes will run through the private § 262(l) exchange, invisible to this public dataset.`);
  if (!list.children.length) list.append(el("li", "empty", "Nothing matches the current filters."));
}

/* ---------- monthly chart ---------- */

function niceStep(max) {
  const raw = Math.max(max, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

function topRoundedPath(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function renderChart(recs) {
  const cats = activeCategories();
  const months = state.month === "all" ? DATA.months : [state.month];
  const perMonth = months.map((m) => {
    const row = { month: m, total: 0 };
    for (const c of cats) row[c] = 0;
    return row;
  });
  const index = new Map(perMonth.map((r) => [r.month, r]));
  for (const rec of recs)
    for (const ev of rec.matched) {
      const row = index.get(ev.date.slice(0, 7));
      if (!row) continue;
      row[eventCategory(rec, ev)] += 1;
      row.total += 1;
    }

  // Legend (only for >= 2 series; a single series is named by the card title).
  const legend = $("#chart-legend");
  legend.replaceChildren();
  if (cats.length >= 2)
    for (const c of cats) {
      const key = el("span", "key", "");
      const swatch = el("span", "swatch");
      swatch.style.background = SERIES[c].color;
      key.prepend(swatch);
      key.append(el("span", null, SERIES[c].label));
      legend.append(key);
    }
  $("#chart-sub").textContent = "counts individual approval actions";

  const W = 960, H = 280, L = 46, R = 12, T = 16, B = 32;
  const plotW = W - L - R, plotH = H - T - B;
  const maxTotal = Math.max(1, ...perMonth.map((r) => r.total));
  const step = niceStep(maxTotal);
  const yMax = Math.ceil(maxTotal / step) * step;
  const y = (v) => T + plotH - (v / yMax) * plotH;
  const band = plotW / perMonth.length;
  const barW = Math.min(24, band * 0.55);

  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Approval actions by month, stacked by type" });

  for (let v = 0; v <= yMax; v += step) {
    chart.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: v === 0 ? "var(--baseline)" : "var(--grid)", "stroke-width": 1 }));
    const t = svg("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--text-muted)" });
    t.style.fontVariantNumeric = "tabular-nums";
    t.textContent = String(v);
    chart.append(t);
  }

  perMonth.forEach((row, i) => {
    const cx = L + band * i + band / 2;
    const x0 = cx - barW / 2;
    let cursor = y(0);
    const present = cats.filter((c) => row[c] > 0);
    present.forEach((c, j) => {
      const h = (row[c] / yMax) * plotH;
      const top = cursor - h;
      const isTop = j === present.length - 1;
      const isBottom = j === 0;
      const drawH = Math.max(isBottom ? h : h - 2, 0.75);
      if (isTop) chart.append(svg("path", { d: topRoundedPath(x0, top, barW, drawH, 4), fill: SERIES[c].color }));
      else chart.append(svg("rect", { x: x0, y: top, width: barW, height: drawH, fill: SERIES[c].color }));
      cursor = top;
    });
    if (row.total > 0) {
      const cap = svg("text", { x: cx, y: cursor - 6, "text-anchor": "middle", "font-size": 11, fill: "var(--text-secondary)" });
      cap.textContent = String(row.total);
      chart.append(cap);
    }
    const label = svg("text", { x: cx, y: H - 10, "text-anchor": "middle", "font-size": 11, fill: "var(--text-muted)" });
    label.textContent = monthLabel(row.month).slice(0, 3) + (months.length > 8 ? "" : ` ’${row.month.slice(2, 4)}`);
    chart.append(label);

    // Hit target: the whole month band, keyboard-focusable.
    const hit = svg("rect", { x: L + band * i, y: T, width: band, height: plotH, class: "hitband", tabindex: "0", "aria-label": `${monthLabel(row.month)}: ${row.total} approval actions` });
    hit.style.cursor = "default";
    hit.addEventListener("pointerenter", () => showChartTip(row, cats, hit));
    hit.addEventListener("focus", () => showChartTip(row, cats, hit));
    hit.addEventListener("pointerleave", hideChartTip);
    hit.addEventListener("blur", hideChartTip);
    chart.append(hit);
  });

  const box = $("#chart-box");
  for (const node of [...box.children]) if (node.tagName === "svg") node.remove();
  box.append(chart);

  renderChartTable(perMonth, cats);
}

function showChartTip(row, cats, hit) {
  const tip = $("#chart-tooltip");
  tip.replaceChildren(el("div", "t-title", monthLabel(row.month)));
  for (const c of cats) {
    const r = el("div", "t-row");
    const key = el("span", "t-key");
    key.style.background = SERIES[c].color;
    r.append(key, el("span", null, SERIES[c].label), el("span", "t-val", String(row[c])));
    tip.append(r);
  }
  if (cats.length > 1) {
    const r = el("div", "t-row");
    r.append(el("span", "t-key"), el("span", null, "Total"), el("span", "t-val", String(row.total)));
    tip.append(r);
  }
  tip.style.display = "block";
  const boxRect = $("#chart-box").getBoundingClientRect();
  const hitRect = hit.getBoundingClientRect();
  let x = hitRect.left - boxRect.left + hitRect.width / 2 + 10;
  if (x + tip.offsetWidth > boxRect.width - 4) x = x - tip.offsetWidth - 20;
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = "12px";
}
function hideChartTip() {
  $("#chart-tooltip").style.display = "none";
}

function renderChartTable(perMonth, cats) {
  const holder = $("#chart-table");
  holder.replaceChildren();
  const table = el("table", "data");
  const head = el("tr");
  head.append(el("th", null, "Month"));
  for (const c of cats) head.append(el("th", null, SERIES[c].label));
  if (cats.length > 1) head.append(el("th", null, "Total"));
  table.append(head);
  for (const row of perMonth) {
    const tr = el("tr");
    tr.append(el("td", null, monthLabel(row.month)));
    for (const c of cats) tr.append(el("td", null, String(row[c])));
    if (cats.length > 1) tr.append(el("td", null, String(row.total)));
    table.append(tr);
  }
  holder.append(table);
}

/* ---------- approvals list ---------- */

function ipSummary(rec) {
  if (rec.is_biologic) return "No public patent list — BPCIA patent dance";
  const n = rec.cliff.patent_count;
  if (!n) {
    return rec.app.startsWith("ANDA")
      ? "Entered against the brand's listed patents"
      : "No unexpired Orange Book patents";
  }
  let s = `${n} listed patent${n > 1 ? "s" : ""} · protection to ${rec.cliff.last_patent_expiry.slice(0, 4)}`;
  if (rec.cliff.exclusivity_end) s += ` · exclusivity to ${rec.cliff.exclusivity_end.slice(0, 4)}`;
  return s;
}

function renderList(recs) {
  $("#list-count").textContent = `showing ${Math.min(state.shown, recs.length)} of ${recs.length} applications`;
  const box = $("#approvals");
  box.replaceChildren();
  if (!recs.length) {
    box.append(el("div", "empty", "Nothing matches the current filters."));
    $("#show-more").hidden = true;
    return;
  }
  for (const rec of recs.slice(0, state.shown)) box.append(approvalNode(rec));
  $("#show-more").hidden = recs.length <= state.shown;
}

function approvalNode(rec) {
  const wrap = el("div", "approval");
  const row = el("div", "a-row");
  row.append(el("span", "caret", "▸"));
  row.append(el("span", "a-date", rec.matched[0].date));

  const badge = el("span", "badge");
  const dot = el("span", "dot");
  dot.style.background = SERIES[rec.category] ? SERIES[rec.category].color : "var(--text-muted)";
  badge.append(dot, document.createTextNode(SERIES[rec.category] ? SERIES[rec.category].badge : "Other"));
  row.append(badge);

  const name = el("span", "a-name", rec.brands[0] || rec.generics[0] || rec.app);
  if (rec.generics.length && rec.brands.length) name.append(el("span", "gen", ` — ${rec.generics.join(" / ")}`));
  row.append(name);
  row.append(el("span", "a-sub", [rec.sponsor, rec.app].filter(Boolean).join(" · ")));
  row.append(el("span", "a-ip", ipSummary(rec)));
  wrap.append(row);

  const detail = el("div", "a-detail");
  wrap.append(detail);
  let built = false;
  row.addEventListener("click", () => {
    wrap.classList.toggle("open");
    if (!built) {
      buildDetail(detail, rec);
      built = true;
    }
  });
  return wrap;
}

function buildDetail(detail, rec) {
  detail.append(el("h4", null, "Approval actions in window"));
  const ul = el("ul", "events");
  for (const ev of rec.events) {
    const li = el("li");
    li.append(document.createTextNode(`${ev.date} — ${ev.type === "ORIG" ? "Original approval" : "Supplement"}${ev.class ? ` · ${ev.class}` : ""}${ev.priority === "PRIORITY" ? " · Priority review" : ""} `));
    if (ev.letter_url && /^https?:\/\/(www\.)?accessdata\.fda\.gov\//.test(ev.letter_url)) {
      const a = el("a", null, "approval letter");
      a.href = ev.letter_url;
      a.target = "_blank";
      a.rel = "noopener";
      li.append(a);
    }
    ul.append(li);
  }
  detail.append(ul);

  detail.append(el("h4", null, "Legal impact"));
  detail.append(el("p", "note", impactStatement(rec)));

  detail.append(el("h4", null, "Patent & exclusivity runway"));
  if (rec.is_biologic) {
    detail.append(
      el("p", "note",
        "Biologics have no Orange Book equivalent: the BPCIA “patent dance” exchanges patent lists privately between the innovator and biosimilar applicants. The transparency gap is a feature of the statute — you cannot compute a generic-entry date for this product from public FDA data.")
    );
    return;
  }
  const rows = timelineRows(rec);
  if (!rows.length) {
    detail.append(
      el("p", "note",
        rec.app.startsWith("ANDA")
          ? "Generic applications do not list their own patents; this § 505(j) approval means every patent and exclusivity barrier the brand listed has expired, been designed around (§ viii carve-out), or been certified against (Paragraph I–IV)."
          : "No unexpired patents or exclusivities listed in the current Orange Book edition. New approvals can lag: the NDA holder has 30 days to submit its patent lists for publication.")
    );
    return;
  }

  if (rec.app.startsWith("NDA")) detail.append(el("p", "note", posture(rec)));
  else if (rec.app.startsWith("ANDA"))
    detail.append(
      el("p", "note",
        "Generic (§ 505(j)) approval — any exclusivity below is the generic's own reward (e.g., 180-day first-filer exclusivity under § 505(j)(5)(B)(iv), or competitive generic therapy exclusivity), earned by challenging or being first against the brand.")
    );

  const legend = el("div", "legend");
  for (const kind of new Set(rows.map((r) => r.kind))) {
    const key = el("span", "key");
    const swatch = el("span", "swatch");
    swatch.style.background = PATENT_KINDS[kind].color;
    key.append(swatch, el("span", null, PATENT_KINDS[kind].label));
    legend.append(key);
  }
  detail.append(legend);

  const tl = el("div", "timeline-box");
  tl.append(timelineSVG(rec, rows));
  detail.append(tl);
}

function impactStatement(rec) {
  const name = rec.brands[0] || rec.generics[0] || rec.app;
  if (rec.category === "new-drug")
    return (
      `This original approval activates the Hatch-Waxman machinery for ${name}: its Orange Book listings become statutory ` +
      `gates on generic entry, any ANDA challenge is litigable the day it is certified (35 U.S.C. § 271(e)(2)), and the ` +
      `sponsor may restore FDA review time to one patent via a § 156 patent term extension. The estate can keep growing — ` +
      `watch for later-listed formulation and method-of-use patents.`
    );
  if (rec.category === "biologic")
    return (
      `Licensure starts the BPCIA clocks for ${name}: 12-year reference-product exclusivity (no biosimilar application ` +
      `for 4 years), with patent disputes routed through the private § 262(l) "patent dance" rather than any public listing.`
    );
  if (rec.category === "generic")
    return (
      `The Hatch-Waxman bargain pays out: this ANDA approval means every patent and exclusivity barrier the brand listed ` +
      `has expired, been carved around (§ viii skinny label), or fallen to a Paragraph IV challenge — the moment brand ` +
      `pricing power typically collapses.`
    );
  return (
    `Post-approval changes move IP posture too: efficacy supplements (new indications) can add method-of-use patents and ` +
    `3-year (I-code) exclusivity — the classic evergreening toolkit — while labeling and manufacturing changes rarely do.`
  );
}

function minusOneYear(iso) {
  return `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
}

function posture(rec) {
  const parts = [];
  const n = rec.cliff.patent_count;
  if (n)
    parts.push(
      `${n} patent${n > 1 ? "s" : ""} listed under 21 U.S.C. § 355(b)(1); the longest runs to ${rec.cliff.last_patent_expiry}. ` +
      `A § 505(j) generic applicant must certify to each — and a Paragraph IV certification is itself an artificial act of ` +
      `infringement (35 U.S.C. § 271(e)(2)(A)) that lets the brand sue at once and, if it does so within 45 days, ` +
      `win an automatic 30-month stay of generic approval.`
    );
  const nce = rec.exclusivities.find((e) => e.code.startsWith("NCE") && e.expires);
  if (nce)
    parts.push(
      `NCE exclusivity bars ANDA submission until ${nce.expires}, except that a Paragraph IV challenge may be filed from ` +
      `${minusOneYear(nce.expires)} — the "NCE-1" date, marked on the timeline below.`
    );
  return "Hatch-Waxman posture: " + parts.join(" ");
}

function timelineRows(rec) {
  const rows = [];
  for (const p of rec.patents) {
    if (!p.expires) continue;
    const kind = p.drug_substance ? "compound" : p.drug_product ? "formulation" : p.use_code ? "use" : "listed";
    rows.push({
      kind,
      label: `US${p.patent_no}`,
      href: `https://patents.google.com/patent/US${p.patent_no.replace(/[^A-Za-z0-9]/g, "")}`,
      end: p.expires,
      title: `US ${p.patent_no} — ${PATENT_KINDS[kind].label}${p.use_code ? ` (${p.use_code})` : ""}, expires ${p.expires}`,
    });
  }
  for (const e of rec.exclusivities) {
    if (!e.expires) continue;
    rows.push({ kind: "excl", label: e.code, end: e.expires, title: `${e.label} — runs to ${e.expires}` });
  }
  rows.sort((a, b) => (a.end < b.end ? -1 : 1));
  return rows;
}

function timelineSVG(rec, rows) {
  const origin = rec.events[rec.events.length - 1].date;
  const startYear = Number(origin.slice(0, 4));
  const endYear = Math.max(...rows.map((r) => Number(r.end.slice(0, 4))), startYear + 1) + 1;
  const W = 900, LBL = 150, R = 44, T = 20, rowH = 24, B = 22;
  const H = T + rows.length * rowH + B;
  const x = (iso) => {
    const t = (Date.parse(iso) - Date.parse(`${startYear}-01-01`)) / (Date.parse(`${endYear + 1}-01-01`) - Date.parse(`${startYear}-01-01`));
    return LBL + t * (W - LBL - R);
  };
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Patent and exclusivity timeline for ${rec.brands[0] || rec.app}` });

  const span = endYear - startYear + 1;
  const stepY = span > 24 ? 5 : span > 12 ? 2 : 1;
  for (let yr = startYear; yr <= endYear + 1; yr += stepY) {
    const xx = x(`${yr}-01-01`);
    chart.append(svg("line", { x1: xx, x2: xx, y1: T - 4, y2: H - B, stroke: "var(--grid)", "stroke-width": 1 }));
    const t = svg("text", { x: xx, y: H - 6, "text-anchor": "middle", "font-size": 11, fill: "var(--text-muted)" });
    t.style.fontVariantNumeric = "tabular-nums";
    t.textContent = String(yr);
    chart.append(t);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (today > `${startYear}-01-01` && today < `${endYear + 1}-01-01`) {
    const tx = x(today);
    chart.append(svg("line", { x1: tx, x2: tx, y1: T - 4, y2: H - B, stroke: "var(--text-muted)", "stroke-width": 1 }));
    const t = svg("text", { x: tx + 4, y: T + 4, "font-size": 10, fill: "var(--text-muted)" });
    t.textContent = "today";
    chart.append(t);
  }

  // NCE-1: the fourth anniversary of approval, when Paragraph IV challenges may first be filed.
  const nce = rec.exclusivities.find((e) => e.code.startsWith("NCE") && e.expires);
  if (nce) {
    const pIV = minusOneYear(nce.expires);
    if (pIV > `${startYear}-01-01` && pIV < `${endYear + 1}-01-01`) {
      const px = x(pIV);
      chart.append(svg("line", { x1: px, x2: px, y1: T - 4, y2: H - B, stroke: "var(--text-muted)", "stroke-width": 1 }));
      const t = svg("text", { x: px + 4, y: T + 15, "font-size": 10, fill: "var(--text-muted)" });
      t.textContent = "¶IV window opens";
      chart.append(t);
    }
  }

  rows.forEach((r, i) => {
    const yTop = T + i * rowH + 6;
    const x1 = x(origin), x2 = Math.max(x(r.end), x1 + 6);
    const g = svg("g", {});
    const title = svg("title", {});
    title.textContent = r.title;
    g.append(title);

    const label = svg("text", { x: 2, y: yTop + 10, "font-size": 11, fill: "var(--text-secondary)" });
    label.textContent = r.label;
    if (r.href) {
      const a = svg("a", { href: r.href, target: "_blank", rel: "noopener" });
      a.append(label);
      g.append(a);
    } else g.append(label);

    const w = x2 - x1, rr = Math.min(4, w / 2);
    g.append(svg("path", {
      d: `M${x1},${yTop} H${x2 - rr} Q${x2},${yTop} ${x2},${yTop + rr} V${yTop + 12 - rr} Q${x2},${yTop + 12} ${x2 - rr},${yTop + 12} H${x1} Z`,
      fill: PATENT_KINDS[r.kind].color,
    }));

    const endLbl = svg("text", { x: x2 + 5, y: yTop + 10, "font-size": 11, fill: "var(--text-muted)" });
    endLbl.style.fontVariantNumeric = "tabular-nums";
    endLbl.textContent = r.end.slice(0, 4);
    g.append(endLbl);
    chart.append(g);
  });
  return chart;
}

/* ---------- Federal Register ---------- */

function renderFedreg() {
  const docs = state.fedregAll ? DATA.fedreg : DATA.fedreg.slice(0, 12);
  $("#fedreg-sub").textContent = `last 30 days · ${DATA.fedreg.length} documents`;
  const box = $("#fedreg");
  box.replaceChildren();
  for (const d of docs) {
    const item = el("div", "fr-item");
    item.append(el("span", "fr-date", d.date));
    const body = el("div", "fr-body");
    const line = el("div");
    const badge = el("span", "badge", d.type || "Document");
    line.append(badge, document.createTextNode(" "));
    if (d.url && /^https:\/\/www\.federalregister\.gov\//.test(d.url)) {
      const a = el("a", null, d.title || "(untitled)");
      a.href = d.url;
      a.target = "_blank";
      a.rel = "noopener";
      line.append(a);
    } else line.append(el("span", null, d.title || "(untitled)"));
    body.append(line);
    if (d.abstract) body.append(el("p", "abstract", d.abstract));
    item.append(body);
    box.append(item);
  }
  $("#fedreg-more").hidden = state.fedregAll || DATA.fedreg.length <= 12;
}

/* ---------- wiring ---------- */

function renderAll() {
  const recs = filteredRecords();
  renderTiles(recs);
  renderTimeline30(state.month === "all" ? recs : filteredRecords(true));
  renderImpact(recs);
  renderChart(recs);
  renderList(recs);
}

function buildMonthChips() {
  const holder = $("#month-chips");
  holder.replaceChildren();
  const mk = (value, text) => {
    const b = el("button", "chip", text);
    b.setAttribute("aria-pressed", String(state.month === value));
    b.addEventListener("click", () => {
      state.month = value;
      state.shown = 60;
      for (const c of holder.children) c.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-pressed", "true");
      renderAll();
    });
    return b;
  };
  holder.append(mk("all", "All months"));
  for (const m of DATA.months) holder.append(mk(m, MONTH_NAMES[Number(m.slice(5, 7)) - 1]));
}

async function main() {
  initTheme();
  initTabs();
  const [approvals, meta, fedreg] = await Promise.all(
    ["data/approvals.json", "data/meta.json", "data/fedreg.json"].map((u) => fetch(u).then((r) => r.json()))
  );
  const months = [];
  let cur = meta.window.start.slice(0, 7);
  const last = meta.window.end.slice(0, 7);
  while (cur <= last) {
    months.push(cur);
    const [y, m] = cur.split("-").map(Number);
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  DATA = { approvals, meta, fedreg, months };

  $("#meta-line").textContent =
    `Window ${meta.window.start} → ${meta.window.end} · sources: openFDA (Drugs@FDA) · FDA Orange Book · Federal Register`;

  buildMonthChips();
  $("#category").addEventListener("change", (e) => {
    state.category = e.target.value;
    state.shown = 60;
    renderAll();
  });
  let debounce;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.query = e.target.value;
      state.shown = 60;
      renderAll();
    }, 120);
  });
  $("#show-more").addEventListener("click", () => {
    state.shown += 120;
    renderList(filteredRecords());
  });
  $("#table-toggle").addEventListener("click", (e) => {
    const table = $("#chart-table");
    const showTable = table.hidden;
    table.hidden = !showTable;
    $("#chart-box").style.display = showTable ? "none" : "";
    e.target.textContent = showTable ? "Chart view" : "Table view";
    e.target.setAttribute("aria-pressed", String(showTable));
  });
  $("#fedreg-more").addEventListener("click", () => {
    state.fedregAll = true;
    renderFedreg();
  });

  renderAll();
  renderFedreg();
}

main().catch((err) => {
  $("#meta-line").textContent = `Failed to load data: ${err.message}. If you opened index.html directly from disk, serve it instead: python3 -m http.server (fetch() cannot read local files).`;
});
