#!/usr/bin/env node
/**
 * Bake computed AP terms metrics into index.html so first paint needs no JavaScript.
 *
 * Usage: node scripts/render-static.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var TERMS = require("../js/terms.js");

var ROOT = path.resolve(__dirname, "..");
var DATA_PATH = path.join(ROOT, "data", "terms.json");
var OUT_PATH = path.join(ROOT, "index.html");

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function monthLabel(ym) {
  if (!ym || typeof ym !== "string" || ym.length < 7) return ym || "—";
  var parts = ym.split("-");
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  if (!year || !month) return ym;
  return new Date(year, month - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function money(n, currency) {
  if (n === null || n === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  } catch (err) {
    return String(n);
  }
}

function daysText(n) {
  var formatted = TERMS.formatDays(n, 1);
  return formatted === null ? "—" : formatted;
}

function pctText(n) {
  var formatted = TERMS.formatPct(n, 1);
  return formatted === null ? "—" : formatted + "%";
}

function trendHtml(mom, unit) {
  if (!mom) return '<span class="trend na">MoM n/a</span>';
  var arrow = mom.direction === "up" ? "↑" : mom.direction === "down" ? "↓" : "→";
  var volume = unit === "volume";
  var cls = mom.flat || volume ? "flat" : mom.improving ? "improving" : "worsening";
  var delta;
  if (mom.flat) {
    delta = unit === "pct" ? "0.0pp" : unit === "money" || volume ? money(0) : "0.0d";
  } else if (unit === "pct") {
    delta = (mom.delta > 0 ? "+" : "") + (mom.delta * 100).toFixed(1) + "pp";
  } else if (unit === "money" || volume) {
    delta = (mom.delta > 0 ? "+" : "") + money(mom.delta);
  } else {
    delta = (mom.delta > 0 ? "+" : "") + mom.delta.toFixed(1) + "d";
  }
  var word = mom.flat ? "unchanged" : mom.improving ? "improving" : volume ? "volume" : "worsening";
  return (
    '<span class="trend ' +
    cls +
    '">' +
    arrow +
    " " +
    esc(delta) +
    " MoM (" +
    word +
    ")</span>"
  );
}

function sparkline(months) {
  var width = 1040;
  var height = 64;
  var values = months.map(function (m) {
    return m.captureRate;
  });
  var usable = values.filter(function (v) {
    return v !== null;
  });
  if (usable.length < 2) return "";
  var min = Math.min.apply(null, usable);
  var max = Math.max.apply(null, usable);
  var span = max - min || 1;
  var coords = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (v === null) continue;
    var x = (i / (values.length - 1)) * width;
    var y = height - ((v - min) / span) * (height - 8) - 4;
    coords.push(x.toFixed(1) + "," + y.toFixed(1));
  }
  var last = months[months.length - 1];
  var first = months[0];
  return (
    '<div class="spark" id="capture-sparkline">' +
    '<p class="note">Capture rate trend (' +
    esc(monthLabel(first.month)) +
    " → " +
    esc(monthLabel(last.month)) +
    ")</p>" +
    '<svg viewBox="0 0 ' +
    width +
    " " +
    height +
    '" role="img" aria-label="Capture rate sparkline from ' +
    esc(pctText(first.captureRate)) +
    " to " +
    esc(pctText(last.captureRate)) +
    '">' +
    '<polyline fill="none" stroke="#0f6e6e" stroke-width="3" points="' +
    coords.join(" ") +
    '" />' +
    "</svg></div>"
  );
}

function cardHtml(latest, key, title, name, valueHtml, unit, momUnit) {
  var mom = latest.mom ? latest.mom[key] : null;
  return (
    '<article class="card" id="card-' +
    key +
    '">' +
    '<p class="label">' +
    esc(title) +
    "</p>" +
    '<p class="name">' +
    esc(name) +
    "</p>" +
    '<p class="metric-value" data-metric="' +
    key +
    '">' +
    valueHtml +
    (unit
      ? ' <span class="unit">' + esc(unit) + "</span>"
      : "") +
    "</p>" +
    '<div class="meta">' +
    trendHtml(mom, momUnit) +
    "</div></article>"
  );
}

function vendorTable(report) {
  var currency = report.currency || "USD";
  var head =
    "<thead><tr>" +
    "<th>Vendor</th><th>Payment terms</th><th>Discount %</th><th>Discount window</th>" +
    "<th>Invoices</th><th>Weighted avg days payable</th>" +
    "<th>Discount $ offered</th><th>Discount $ captured</th><th>Capture rate</th>" +
    "</tr></thead>";
  var rows = report.vendors.map(function (v) {
    return (
      '<tr data-vendor="' +
      esc(v.id || "") +
      '">' +
      "<td>" +
      esc(v.name || "—") +
      "</td>" +
      "<td>" +
      esc(v.termsLabel || "—") +
      "</td>" +
      "<td>" +
      (v.discountPct == null ? "—" : esc(String(v.discountPct)) + "%") +
      "</td>" +
      "<td>" +
      (v.discountWindowDays == null ? "—" : esc(String(v.discountWindowDays)) + " days") +
      "</td>" +
      "<td>" +
      esc(String(v.invoiceCount)) +
      "</td>" +
      "<td data-days-payable=\"" +
      esc(daysText(v.weightedAvgDaysPayable)) +
      '">' +
      esc(daysText(v.weightedAvgDaysPayable)) +
      "</td>" +
      "<td data-discount-offered=\"" +
      esc(money(v.discountOffered, currency)) +
      '">' +
      esc(money(v.discountOffered, currency)) +
      "</td>" +
      "<td data-discount-captured=\"" +
      esc(money(v.discountCaptured, currency)) +
      '">' +
      esc(money(v.discountCaptured, currency)) +
      "</td>" +
      "<td data-capture-rate=\"" +
      esc(pctText(v.captureRate)) +
      '">' +
      esc(pctText(v.captureRate)) +
      "</td></tr>"
    );
  });
  return (
    '<div class="table-wrap"><table id="vendor-terms">' +
    head +
    "<tbody>" +
    rows.join("") +
    "</tbody></table></div>"
  );
}

function monthTable(report) {
  var currency = report.currency || "USD";
  var head =
    "<thead><tr>" +
    "<th>Month</th><th>Invoices</th>" +
    "<th>Weighted avg days payable</th><th>Days payable MoM</th>" +
    "<th>Discount $ offered</th><th>Discount $ captured</th>" +
    "<th>Capture rate</th><th>Capture rate MoM</th>" +
    "</tr></thead>";
  var rows = report.months.map(function (row) {
    var momDays = row.mom && row.mom.weightedAvgDaysPayable;
    var momRate = row.mom && row.mom.captureRate;
    function momShort(mom, unit) {
      if (!mom) return '<span class="trend na">n/a</span>';
      var arrow = mom.direction === "up" ? "↑" : mom.direction === "down" ? "↓" : "→";
      var cls = mom.flat ? "flat" : mom.improving ? "improving" : "worsening";
      var delta;
      if (mom.flat) delta = "0";
      else if (unit === "pct") delta = (mom.delta > 0 ? "+" : "") + (mom.delta * 100).toFixed(1) + "pp";
      else delta = (mom.delta > 0 ? "+" : "") + mom.delta.toFixed(1) + "d";
      return '<span class="trend ' + cls + '">' + arrow + " " + esc(delta) + "</span>";
    }
    return (
      '<tr data-month="' +
      esc(row.month) +
      '">' +
      "<td>" +
      esc(monthLabel(row.month)) +
      ' <span class="note">(' +
      esc(row.month) +
      ")</span></td>" +
      "<td>" +
      esc(String(row.invoiceCount)) +
      "</td>" +
      "<td data-days-payable=\"" +
      esc(daysText(row.weightedAvgDaysPayable)) +
      '">' +
      esc(daysText(row.weightedAvgDaysPayable)) +
      "</td>" +
      "<td>" +
      momShort(momDays, "days") +
      "</td>" +
      "<td>" +
      esc(money(row.discountOffered, currency)) +
      "</td>" +
      "<td>" +
      esc(money(row.discountCaptured, currency)) +
      "</td>" +
      "<td data-capture-rate=\"" +
      esc(pctText(row.captureRate)) +
      '">' +
      esc(pctText(row.captureRate)) +
      "</td>" +
      "<td>" +
      momShort(momRate, "pct") +
      "</td></tr>"
    );
  });
  return (
    '<div class="table-wrap"><table id="monthly-terms">' +
    head +
    "<tbody>" +
    rows.join("") +
    "</tbody></table></div>"
  );
}

function render(dataset) {
  var report = TERMS.computeTracker(dataset);
  if (!report.latest) {
    throw new Error("No months to render");
  }
  var latest = report.latest;
  var overall = report.overall;
  var currency = report.currency || "USD";

  var cards =
    cardHtml(
      latest,
      "weightedAvgDaysPayable",
      "Days payable",
      "Weighted average days payable (amount × days-to-pay)",
      esc(daysText(latest.weightedAvgDaysPayable)),
      "days",
      "days"
    ) +
    cardHtml(
      latest,
      "discountOffered",
      "Discount $ offered",
      "Early-pay discount dollars available this month",
      esc(money(latest.discountOffered, currency)),
      "",
      "volume"
    ) +
    cardHtml(
      latest,
      "discountCaptured",
      "Discount $ captured",
      "Discount dollars taken by paying inside the window",
      esc(money(latest.discountCaptured, currency)),
      "",
      "money"
    ) +
    cardHtml(
      latest,
      "captureRate",
      "Capture rate",
      "Captured / offered",
      esc(pctText(latest.captureRate)),
      "",
      "pct"
    );

  var overallLine =
    "All-time (" +
    report.monthCount +
    " months, " +
    report.vendorCount +
    " vendors, " +
    report.invoiceCount +
    " invoices): weighted avg days payable " +
    daysText(overall.weightedAvgDaysPayable) +
    "d · discount $ offered " +
    money(overall.discountOffered, currency) +
    " · discount $ captured " +
    money(overall.discountCaptured, currency) +
    " · capture rate " +
    pctText(overall.captureRate) +
    ".";

  return (
    "<!DOCTYPE html>\n" +
    '<html lang="en">\n' +
    "<head>\n" +
    '  <meta charset="utf-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    "  <title>AP terms &amp; discount capture — " +
    esc(report.company || "Tracker") +
    "</title>\n" +
    '  <link rel="stylesheet" href="css/style.css" />\n' +
    "</head>\n" +
    "<body>\n" +
    '  <header class="hero">\n' +
    '    <div class="wrap">\n' +
    '      <p class="kicker">Accounts payable</p>\n' +
    "      <h1>AP terms and discount-capture tracker</h1>\n" +
    '      <p class="sub">' +
    esc(report.company || "Sample company") +
    " · " +
    String(report.vendorCount) +
    " vendors · " +
    String(report.monthCount) +
    " months · " +
    String(report.invoiceCount) +
    " invoices. Weighted average days payable, discount $ offered vs captured, and capture rate are baked into this HTML for first paint without JavaScript.</p>\n" +
    '      <div class="formula-strip" aria-label="Formulas">\n' +
    "        <code>weighted avg days payable = Σ(amount × days-to-pay) / Σ(amount)</code>\n" +
    "        <code>discount $ offered = amount × discount %</code>\n" +
    "        <code>discount $ captured = offered if paid within window, else $0</code>\n" +
    "        <code>capture rate = captured / offered</code>\n" +
    "      </div>\n" +
    "    </div>\n" +
    "  </header>\n" +
    '  <main class="wrap">\n' +
    '    <section class="section" id="latest">\n' +
    "      <h2>Latest month · " +
    esc(monthLabel(latest.month)) +
    " (" +
    esc(latest.month) +
    ") — days payable, discount, and capture rate</h2>\n" +
    '      <p class="note">' +
    esc(overallLine) +
    " MoM on the cards is latest month versus the prior month. Lower days payable is treated as faster payment; higher captured $ and capture rate are improving.</p>\n" +
    '      <div class="cards">' +
    cards +
    "</div>\n" +
    sparkline(report.months) +
    "    </section>\n" +
    '    <section class="section" id="vendors">\n' +
    "      <h2>Vendors — terms, days payable, and discount capture</h2>\n" +
    '      <p class="note">Each vendor’s payment terms label, discount %, and discount window days. Capture rate is n/a when no discount is offered (for example net-30 with 0%).</p>\n' +
    vendorTable(report) +
    "    </section>\n" +
    '    <section class="section" id="monthly">\n' +
    "      <h2>Monthly weighted avg days payable, discount $, and capture rate</h2>\n" +
    '      <p class="note">Invoices are bucketed by invoice date month. Discount $ offered vs discount $ captured and capture rate are shown with days-payable MoM.</p>\n' +
    monthTable(report) +
    "    </section>\n" +
    "  </main>\n" +
    '  <footer class="wrap">\n' +
    "    <p>Static snapshot generated from <code>data/terms.json</code> via <code>node scripts/render-static.js</code>. JavaScript only enhances; it does not supply these numbers.</p>\n" +
    "  </footer>\n" +
    '  <script src="js/terms.js" defer></script>\n' +
    '  <script src="js/enhance.js" defer></script>\n' +
    "</body>\n" +
    "</html>\n"
  );
}

function main() {
  var raw = fs.readFileSync(DATA_PATH, "utf8");
  var dataset = JSON.parse(raw);
  var html = render(dataset);
  fs.writeFileSync(OUT_PATH, html);
  var report = TERMS.computeTracker(dataset);
  process.stdout.write(
    "Wrote " +
      path.relative(ROOT, OUT_PATH) +
      " (" +
      report.vendorCount +
      " vendors, " +
      report.monthCount +
      " months, " +
      report.invoiceCount +
      " invoices, latest capture rate " +
      TERMS.formatPct(report.latest.captureRate, 1) +
      "%)\n"
  );
}

main();
