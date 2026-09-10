#!/usr/bin/env node
/**
 * One-shot sample generator for data/terms.json.
 * Deterministic invoice activity for Northwind Components.
 */
"use strict";

var fs = require("fs");
var path = require("path");

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function iso(y, m, d) {
  return y + "-" + pad(m) + "-" + pad(d);
}

function addDays(dateStr, n) {
  var parts = dateStr.split("-").map(Number);
  var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + n);
  return (
    dt.getUTCFullYear() +
    "-" +
    pad(dt.getUTCMonth() + 1) +
    "-" +
    pad(dt.getUTCDate())
  );
}

function monthList() {
  var out = [];
  for (var y = 2024; y <= 2025; y++) {
    var start = y === 2024 ? 4 : 1;
    var end = y === 2024 ? 12 : 9;
    for (var m = start; m <= end; m++) out.push({ y: y, m: m, key: iso(y, m, 1).slice(0, 7) });
  }
  return out;
}

var MONTHS = monthList();

function payDelay(vendorIndex, monthIndex, invoiceIndex) {
  // Later months pay faster so capture rate trends up MoM.
  var base = [18, 9, 22, 28, 14][vendorIndex];
  var improve = Math.floor(monthIndex / 2);
  var jitter = invoiceIndex === 0 ? -2 : 3;
  var days = base - improve + jitter;
  if (days < 4) days = 4;
  return days;
}

function amount(vendorIndex, monthIndex, invoiceIndex) {
  var bases = [52000, 18500, 12000, 7800, 26500];
  var step = [900, 250, 180, 80, 400][vendorIndex];
  return bases[vendorIndex] + monthIndex * step + invoiceIndex * 1500;
}

var VENDORS = [
  {
    id: "acme-steel",
    name: "Acme Steel Co.",
    termsLabel: "2/10 net 30",
    discountPct: 2,
    discountWindowDays: 10,
    netDays: 30,
  },
  {
    id: "harbor-plastics",
    name: "Harbor Plastics",
    termsLabel: "1/10 net 30",
    discountPct: 1,
    discountWindowDays: 10,
    netDays: 30,
  },
  {
    id: "pacific-freight",
    name: "Pacific Freight LLC",
    termsLabel: "2/15 net 45",
    discountPct: 2,
    discountWindowDays: 15,
    netDays: 45,
  },
  {
    id: "metro-packaging",
    name: "Metro Packaging",
    termsLabel: "net 30",
    discountPct: 0,
    discountWindowDays: 0,
    netDays: 30,
  },
  {
    id: "summit-chemicals",
    name: "Summit Chemicals",
    termsLabel: "1.5/10 net 60",
    discountPct: 1.5,
    discountWindowDays: 10,
    netDays: 60,
  },
];

var vendors = VENDORS.map(function (v, vi) {
  var invoices = [];
  MONTHS.forEach(function (mo, mi) {
    var perMonth = vi === 3 ? 1 : 2;
    for (var n = 0; n < perMonth; n++) {
      var day = n === 0 ? 5 : 18;
      var invoiceDate = iso(mo.y, mo.m, day);
      var dueDate = addDays(invoiceDate, v.netDays);
      var paidDate = addDays(invoiceDate, payDelay(vi, mi, n));
      invoices.push({
        id: "INV-" + v.id.split("-")[0].toUpperCase() + "-" + mo.key.replace("-", "") + "-" + (n + 1),
        amount: amount(vi, mi, n),
        invoiceDate: invoiceDate,
        dueDate: dueDate,
        paidDate: paidDate,
      });
    }
  });
  return {
    id: v.id,
    name: v.name,
    termsLabel: v.termsLabel,
    discountPct: v.discountPct,
    discountWindowDays: v.discountWindowDays,
    netDays: v.netDays,
    invoices: invoices,
  };
});

var dataset = {
  company: "Northwind Components",
  currency: "USD",
  asOf: "2025-09-30",
  vendors: vendors,
};

var out = path.resolve(__dirname, "../data/terms.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(dataset, null, 2) + "\n");
process.stdout.write(
  "Wrote " +
    path.relative(path.resolve(__dirname, ".."), out) +
    " (" +
    vendors.length +
    " vendors, " +
    vendors.reduce(function (n, v) {
      return n + v.invoices.length;
    }, 0) +
    " invoices, " +
    MONTHS.length +
    " months)\n"
);
