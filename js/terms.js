/**
 * AP terms and discount-capture metrics.
 * Works in the browser (global TERMS) and in Node (module.exports).
 *
 * Formulas:
 *   days payable (invoice)  = paidDate − invoiceDate  (calendar days)
 *   weighted avg days payable = Σ(amount × days payable) / Σ(amount)
 *   discount offered $      = amount × (discountPct / 100)
 *   discount captured $     = offered $ when paid within discountWindowDays, else 0
 *   capture rate            = captured $ / offered $
 *
 * Unsafe inputs (null/empty, non-finite, zero denominators) return null.
 * Never returns NaN or Infinity.
 */
(function (global, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    global.TERMS = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MS_PER_DAY = 86400000;

  function toNum(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    var n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function finiteOrNull(n) {
    if (n === null || n === undefined) return null;
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function parseISODate(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== mo - 1 ||
      dt.getUTCDate() !== d
    ) {
      return null;
    }
    return dt;
  }

  function monthKeyFromDate(value) {
    var dt = parseISODate(value);
    if (!dt) return null;
    var m = dt.getUTCMonth() + 1;
    return dt.getUTCFullYear() + "-" + (m < 10 ? "0" : "") + m;
  }

  /**
   * Calendar-day difference (UTC date-only). Null on missing/invalid dates.
   */
  function daysBetween(from, to) {
    var a = parseISODate(from);
    var b = parseISODate(to);
    if (!a || !b) return null;
    var days = (b.getTime() - a.getTime()) / MS_PER_DAY;
    return finiteOrNull(days);
  }

  function invoiceDaysPayable(invoice) {
    if (!invoice || typeof invoice !== "object") return null;
    var days = daysBetween(invoice.invoiceDate, invoice.paidDate);
    if (days === null) return null;
    if (days < 0) return null;
    return days;
  }

  /**
   * Potential early-pay discount in dollars. pct is whole percent (2 = 2%).
   */
  function roundCents(n) {
    if (n === null || n === undefined) return null;
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100) / 100;
  }

  /**
   * Potential early-pay discount in dollars. pct is whole percent (2 = 2%).
   */
  function discountOffered(amount, discountPct) {
    var amt = toNum(amount);
    var pct = toNum(discountPct);
    if (amt === null || pct === null) return null;
    if (amt < 0 || pct < 0) return null;
    return roundCents(amt * (pct / 100));
  }

  function isDiscountCaptured(invoice, discountWindowDays) {
    var windowDays = toNum(discountWindowDays);
    if (windowDays === null || windowDays < 0) return false;
    var days = invoiceDaysPayable(invoice);
    if (days === null) return false;
    return days <= windowDays;
  }

  function discountCaptured(invoice, discountPct, discountWindowDays) {
    var offered = discountOffered(invoice && invoice.amount, discountPct);
    if (offered === null) return null;
    if (offered === 0) return 0;
    if (!isDiscountCaptured(invoice, discountWindowDays)) return 0;
    return offered;
  }

  function emptyMetrics() {
    return {
      invoiceCount: 0,
      paidCount: 0,
      payableAmount: null,
      weightedAvgDaysPayable: null,
      discountOffered: null,
      discountCaptured: null,
      captureRate: null,
    };
  }

  /**
   * Roll up a list of invoices. Each invoice may carry vendor terms
   * (`discountPct`, `discountWindowDays`) or they can be passed as defaults.
   */
  function summarizeInvoices(invoices, terms) {
    if (!Array.isArray(invoices) || invoices.length === 0) {
      return emptyMetrics();
    }
    var defaults = terms && typeof terms === "object" ? terms : {};
    var count = 0;
    var paidCount = 0;
    var weightSum = 0;
    var amountDays = 0;
    var offeredSum = 0;
    var capturedSum = 0;
    var offeredDefined = false;
    var capturedDefined = false;

    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      if (!inv || typeof inv !== "object") continue;
      count += 1;
      var pct = inv.discountPct != null ? inv.discountPct : defaults.discountPct;
      var windowDays =
        inv.discountWindowDays != null
          ? inv.discountWindowDays
          : defaults.discountWindowDays;
      var amt = toNum(inv.amount);
      var days = invoiceDaysPayable(inv);
      if (amt !== null && amt > 0 && days !== null) {
        amountDays += amt * days;
        weightSum += amt;
        paidCount += 1;
      }
      var offered = discountOffered(inv.amount, pct);
      if (offered !== null) {
        offeredSum += offered;
        offeredDefined = true;
      }
      var captured = discountCaptured(inv, pct, windowDays);
      if (captured !== null) {
        capturedSum += captured;
        capturedDefined = true;
      }
    }

    if (count === 0) {
      return emptyMetrics();
    }

    var wadp = weightSum === 0 ? null : finiteOrNull(amountDays / weightSum);
    var offeredOut = offeredDefined ? roundCents(offeredSum) : null;
    var capturedOut = capturedDefined ? roundCents(capturedSum) : null;
    var rate = null;
    if (offeredOut !== null && offeredOut !== 0 && capturedOut !== null) {
      rate = finiteOrNull(capturedOut / offeredOut);
    }

    return {
      invoiceCount: count,
      paidCount: paidCount,
      payableAmount: weightSum === 0 ? null : finiteOrNull(weightSum),
      weightedAvgDaysPayable: wadp,
      discountOffered: offeredOut,
      discountCaptured: capturedOut,
      captureRate: rate,
    };
  }

  function momTrend(current, previous, higherIsBetter, roundDigits) {
    var c = toNum(current);
    var p = toNum(previous);
    if (c === null || p === null) return null;
    var delta = c - p;
    if (!Number.isFinite(delta)) return null;
    var digits = roundDigits == null ? 1 : roundDigits;
    var factor = Math.pow(10, digits);
    var rounded = Math.round(delta * factor) / factor;
    if (!Number.isFinite(rounded)) return null;
    if (rounded === 0) rounded = 0;
    var direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
    var improving = false;
    if (direction !== "flat" && higherIsBetter != null) {
      improving = higherIsBetter ? rounded > 0 : rounded < 0;
    }
    var pct = p === 0 ? null : finiteOrNull(delta / Math.abs(p));
    return {
      delta: rounded,
      pct: pct,
      direction: direction,
      improving: improving,
      flat: direction === "flat",
    };
  }

  function vendorTerms(vendor) {
    if (!vendor || typeof vendor !== "object") {
      return {
        id: null,
        name: null,
        termsLabel: null,
        discountPct: null,
        discountWindowDays: null,
        netDays: null,
      };
    }
    return {
      id: vendor.id == null ? null : String(vendor.id),
      name: vendor.name == null ? null : String(vendor.name),
      termsLabel: vendor.termsLabel == null ? null : String(vendor.termsLabel),
      discountPct: toNum(vendor.discountPct),
      discountWindowDays: toNum(vendor.discountWindowDays),
      netDays: toNum(vendor.netDays),
    };
  }

  function flattenInvoices(dataset) {
    var rows = [];
    if (!dataset || typeof dataset !== "object") return rows;
    var vendors = Array.isArray(dataset.vendors) ? dataset.vendors : [];
    for (var v = 0; v < vendors.length; v++) {
      var vendor = vendors[v];
      if (!vendor || typeof vendor !== "object") continue;
      var terms = vendorTerms(vendor);
      var invoices = Array.isArray(vendor.invoices) ? vendor.invoices : [];
      for (var i = 0; i < invoices.length; i++) {
        var inv = invoices[i];
        if (!inv || typeof inv !== "object") continue;
        rows.push({
          id: inv.id == null ? null : String(inv.id),
          vendorId: terms.id,
          vendorName: terms.name,
          termsLabel: terms.termsLabel,
          discountPct: terms.discountPct,
          discountWindowDays: terms.discountWindowDays,
          netDays: terms.netDays,
          amount: toNum(inv.amount),
          invoiceDate: inv.invoiceDate == null ? null : String(inv.invoiceDate),
          dueDate: inv.dueDate == null ? null : String(inv.dueDate),
          paidDate: inv.paidDate == null ? null : String(inv.paidDate),
          month: monthKeyFromDate(inv.invoiceDate),
          daysPayable: invoiceDaysPayable(inv),
          discountOffered: discountOffered(inv.amount, terms.discountPct),
          discountCaptured: discountCaptured(
            inv,
            terms.discountPct,
            terms.discountWindowDays
          ),
        });
      }
    }
    return rows;
  }

  function attachMom(months) {
    for (var i = 0; i < months.length; i++) {
      var row = months[i];
      var prev = i === 0 ? null : months[i - 1];
      row.mom = {
        weightedAvgDaysPayable: momTrend(
          row.weightedAvgDaysPayable,
          prev ? prev.weightedAvgDaysPayable : null,
          false,
          1
        ),
        discountOffered: momTrend(
          row.discountOffered,
          prev ? prev.discountOffered : null,
          null,
          2
        ),
        discountCaptured: momTrend(
          row.discountCaptured,
          prev ? prev.discountCaptured : null,
          true,
          2
        ),
        captureRate: momTrend(
          row.captureRate,
          prev ? prev.captureRate : null,
          true,
          3
        ),
      };
    }
  }

  function emptyResult() {
    return {
      company: null,
      currency: null,
      overall: emptyMetrics(),
      months: [],
      vendors: [],
      latest: null,
      invoiceCount: 0,
      vendorCount: 0,
      monthCount: 0,
    };
  }

  function computeVendor(vendor) {
    var terms = vendorTerms(vendor);
    var invoices =
      vendor && Array.isArray(vendor.invoices) ? vendor.invoices : [];
    var metrics = summarizeInvoices(invoices, terms);
    return {
      id: terms.id,
      name: terms.name,
      termsLabel: terms.termsLabel,
      discountPct: terms.discountPct,
      discountWindowDays: terms.discountWindowDays,
      netDays: terms.netDays,
      invoiceCount: metrics.invoiceCount,
      paidCount: metrics.paidCount,
      payableAmount: metrics.payableAmount,
      weightedAvgDaysPayable: metrics.weightedAvgDaysPayable,
      discountOffered: metrics.discountOffered,
      discountCaptured: metrics.discountCaptured,
      captureRate: metrics.captureRate,
    };
  }

  function computeTracker(dataset) {
    if (!dataset || typeof dataset !== "object") {
      return emptyResult();
    }
    var rawVendors = Array.isArray(dataset.vendors) ? dataset.vendors : [];
    var vendors = [];
    for (var v = 0; v < rawVendors.length; v++) {
      if (!rawVendors[v] || typeof rawVendors[v] !== "object") continue;
      vendors.push(computeVendor(rawVendors[v]));
    }

    var flat = flattenInvoices(dataset);
    var byMonth = {};
    for (var i = 0; i < flat.length; i++) {
      var row = flat[i];
      var key = row.month;
      if (!key) continue;
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(row);
    }
    var monthKeys = Object.keys(byMonth).sort();
    var months = [];
    for (var m = 0; m < monthKeys.length; m++) {
      var mk = monthKeys[m];
      var metrics = summarizeInvoices(byMonth[mk], {});
      months.push({
        month: mk,
        invoiceCount: metrics.invoiceCount,
        paidCount: metrics.paidCount,
        payableAmount: metrics.payableAmount,
        weightedAvgDaysPayable: metrics.weightedAvgDaysPayable,
        discountOffered: metrics.discountOffered,
        discountCaptured: metrics.discountCaptured,
        captureRate: metrics.captureRate,
      });
    }
    attachMom(months);

    var overall = summarizeInvoices(flat, {});
    var result = {
      company: dataset.company == null ? null : String(dataset.company),
      currency: dataset.currency == null ? null : String(dataset.currency),
      overall: overall,
      months: months,
      vendors: vendors,
      latest: months.length ? months[months.length - 1] : null,
      invoiceCount: overall.invoiceCount,
      vendorCount: vendors.length,
      monthCount: months.length,
    };
    return result;
  }

  function formatDays(value, digits) {
    var n = toNum(value);
    if (n === null) return null;
    var d = digits == null ? 1 : digits;
    return n.toFixed(d);
  }

  function formatPct(value, digits) {
    var n = toNum(value);
    if (n === null) return null;
    var d = digits == null ? 1 : digits;
    return (n * 100).toFixed(d);
  }

  function formatMoney(value, digits) {
    var n = toNum(value);
    if (n === null) return null;
    var d = digits == null ? 2 : digits;
    return n.toFixed(d);
  }

  return {
    toNum: toNum,
    daysBetween: daysBetween,
    monthKeyFromDate: monthKeyFromDate,
    invoiceDaysPayable: invoiceDaysPayable,
    discountOffered: discountOffered,
    discountCaptured: discountCaptured,
    isDiscountCaptured: isDiscountCaptured,
    summarizeInvoices: summarizeInvoices,
    momTrend: momTrend,
    flattenInvoices: flattenInvoices,
    computeVendor: computeVendor,
    computeTracker: computeTracker,
    formatDays: formatDays,
    formatPct: formatPct,
    formatMoney: formatMoney,
  };
});
