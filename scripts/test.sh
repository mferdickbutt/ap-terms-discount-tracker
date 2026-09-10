#!/usr/bin/env bash
# AP terms & discount-capture tracker tests: metric edge cases + static first-paint HTML.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

passed=0
failed=0

pass() {
  echo "PASS: $1"
  passed=$((passed + 1))
}

fail() {
  echo "FAIL: $1"
  failed=$((failed + 1))
}

node_ok() {
  local name="$1"
  local code="$2"
  if node -e "$code"; then
    pass "$name"
  else
    fail "$name"
  fi
}

# --- Metric engine ---

node_ok "days payable is paidDate minus invoiceDate" '
const TERMS = require("./js/terms.js");
const v = TERMS.invoiceDaysPayable({ invoiceDate: "2024-01-01", paidDate: "2024-01-11" });
if (v !== 10) { console.error(v); process.exit(1); }
'

node_ok "weighted avg days payable amount times days over amount" '
const TERMS = require("./js/terms.js");
const s = TERMS.summarizeInvoices([
  { amount: 10000, invoiceDate: "2024-01-01", paidDate: "2024-01-11", discountPct: 2, discountWindowDays: 10 },
  { amount: 5000, invoiceDate: "2024-01-01", paidDate: "2024-01-15", discountPct: 2, discountWindowDays: 10 }
], {});
const expected = (10000 * 10 + 5000 * 14) / 15000;
if (Math.abs(s.weightedAvgDaysPayable - expected) > 1e-9) { console.error(s); process.exit(1); }
'

node_ok "discount offered is amount times percent" '
const TERMS = require("./js/terms.js");
const v = TERMS.discountOffered(10000, 2);
if (v !== 200) { console.error(v); process.exit(1); }
'

node_ok "discount captured when paid within window" '
const TERMS = require("./js/terms.js");
const v = TERMS.discountCaptured(
  { amount: 10000, invoiceDate: "2024-01-01", paidDate: "2024-01-11" },
  2, 10
);
if (v !== 200) { console.error(v); process.exit(1); }
'

node_ok "discount not captured when paid after window" '
const TERMS = require("./js/terms.js");
const v = TERMS.discountCaptured(
  { amount: 10000, invoiceDate: "2024-01-01", paidDate: "2024-01-12" },
  2, 10
);
if (v !== 0) { console.error(v); process.exit(1); }
'

node_ok "capture rate is captured over offered" '
const TERMS = require("./js/terms.js");
const s = TERMS.summarizeInvoices([
  { amount: 10000, invoiceDate: "2024-01-01", paidDate: "2024-01-11", discountPct: 2, discountWindowDays: 10 },
  { amount: 5000, invoiceDate: "2024-01-01", paidDate: "2024-01-15", discountPct: 2, discountWindowDays: 10 }
], {});
if (Math.abs(s.discountOffered - 300) > 1e-9) process.exit(1);
if (Math.abs(s.discountCaptured - 200) > 1e-9) process.exit(1);
if (Math.abs(s.captureRate - 200 / 300) > 1e-9) process.exit(1);
'

node_ok "zero invoices returns null metrics not NaN" '
const TERMS = require("./js/terms.js");
const s = TERMS.summarizeInvoices([], {});
if (s.weightedAvgDaysPayable !== null) process.exit(1);
if (s.discountOffered !== null) process.exit(1);
if (s.discountCaptured !== null) process.exit(1);
if (s.captureRate !== null) process.exit(1);
if (Number.isNaN(s.weightedAvgDaysPayable) || s.captureRate === Infinity) process.exit(1);
'

node_ok "empty series returns empty months and null latest" '
const TERMS = require("./js/terms.js");
const r = TERMS.computeTracker({ company: "T", vendors: [] });
if (r.months.length !== 0 || r.latest !== null) process.exit(1);
if (r.overall.weightedAvgDaysPayable !== null || r.overall.captureRate !== null) process.exit(1);
'

node_ok "null dataset is safe" '
const TERMS = require("./js/terms.js");
const r = TERMS.computeTracker(null);
if (!r || r.months.length !== 0 || r.latest !== null) process.exit(1);
if (r.overall.captureRate !== null) process.exit(1);
'

node_ok "zero offered discount yields null capture rate not Infinity" '
const TERMS = require("./js/terms.js");
const s = TERMS.summarizeInvoices([
  { amount: 8000, invoiceDate: "2024-02-01", paidDate: "2024-02-20", discountPct: 0, discountWindowDays: 0 }
], {});
if (s.discountOffered !== 0) process.exit(1);
if (s.captureRate !== null) process.exit(1);
if (s.captureRate === Infinity || Number.isNaN(s.captureRate)) process.exit(1);
'

node_ok "null invoice dates and amounts return null not NaN" '
const TERMS = require("./js/terms.js");
const s = TERMS.summarizeInvoices([
  { amount: null, invoiceDate: null, paidDate: null, discountPct: null, discountWindowDays: null }
], {});
if (s.weightedAvgDaysPayable !== null) process.exit(1);
if (s.discountOffered !== null) process.exit(1);
if (s.discountCaptured !== null) process.exit(1);
if (s.captureRate !== null) process.exit(1);
if (Number.isNaN(s.weightedAvgDaysPayable)) process.exit(1);
if (TERMS.invoiceDaysPayable(null) !== null) process.exit(1);
if (TERMS.discountOffered(null, null) !== null) process.exit(1);
'

node_ok "unpaid invoice excluded from days payable and does not capture" '
const TERMS = require("./js/terms.js");
const s = TERMS.summarizeInvoices([
  { amount: 10000, invoiceDate: "2024-03-01", paidDate: null, discountPct: 2, discountWindowDays: 10 }
], {});
if (s.weightedAvgDaysPayable !== null) process.exit(1);
if (s.discountOffered !== 200) process.exit(1);
if (s.discountCaptured !== 0) process.exit(1);
if (s.captureRate !== 0) process.exit(1);
'

node_ok "never emits NaN or Infinity on sample data" '
const TERMS = require("./js/terms.js");
const data = require("./data/terms.json");
const r = TERMS.computeTracker(data);
const keys = ["weightedAvgDaysPayable", "discountOffered", "discountCaptured", "captureRate"];
function check(obj) {
  for (const key of keys) {
    const v = obj[key];
    if (v === null) continue;
    if (!Number.isFinite(v)) process.exit(1);
  }
}
check(r.overall);
for (const row of r.months) check(row);
for (const v of r.vendors) check(v);
if (r.monthCount < 12) process.exit(1);
'

node_ok "MoM is null on first month and signed after" '
const TERMS = require("./js/terms.js");
const data = require("./data/terms.json");
const r = TERMS.computeTracker(data);
if (r.months[0].mom.captureRate !== null) process.exit(1);
if (r.months[0].mom.weightedAvgDaysPayable !== null) process.exit(1);
const second = r.months[1];
if (!second.mom.captureRate || typeof second.mom.captureRate.delta !== "number") process.exit(1);
if (!Number.isFinite(second.mom.captureRate.delta)) process.exit(1);
if (!second.mom.weightedAvgDaysPayable || !Number.isFinite(second.mom.weightedAvgDaysPayable.delta)) process.exit(1);
'

node_ok "momTrend null previous or current returns null" '
const TERMS = require("./js/terms.js");
if (TERMS.momTrend(null, 1, true) !== null) process.exit(1);
if (TERMS.momTrend(1, null, true) !== null) process.exit(1);
if (TERMS.momTrend(null, null, true) !== null) process.exit(1);
const t = TERMS.momTrend(0.8, 0.5, true);
if (!t || Math.abs(t.delta - 0.3) > 1e-9 || t.improving !== true) process.exit(1);
'

# --- Sample data shape ---

node_ok "sample data has 5 vendors and at least 12 months of invoices" '
const data = require("./data/terms.json");
if (!Array.isArray(data.vendors) || data.vendors.length < 3) process.exit(1);
const months = new Set();
let invoices = 0;
for (const v of data.vendors) {
  if (!v.name || v.termsLabel == null || v.discountPct == null || v.discountWindowDays == null) process.exit(1);
  if (!Array.isArray(v.invoices) || v.invoices.length === 0) process.exit(1);
  for (const inv of v.invoices) {
    invoices += 1;
    if (inv.amount == null || !inv.invoiceDate) process.exit(1);
    months.add(String(inv.invoiceDate).slice(0, 7));
  }
}
if (months.size < 12) process.exit(1);
if (invoices < 12) process.exit(1);
'

# --- Static HTML first paint ---

if [[ ! -f index.html ]]; then
  fail "index.html exists"
else
  pass "index.html exists"
fi

if grep -qi "Loading" index.html; then
  fail "static HTML has no Loading shell"
else
  pass "static HTML has no Loading shell"
fi

if grep -qi "capture rate" index.html && grep -qi "discount" index.html && grep -qi "days payable" index.html; then
  pass "static HTML contains capture rate / discount / days payable content"
else
  fail "static HTML contains capture rate / discount / days payable content"
fi

node_ok "static HTML contains computed latest metric numbers" '
const fs = require("fs");
const TERMS = require("./js/terms.js");
const data = require("./data/terms.json");
const html = fs.readFileSync("index.html", "utf8");
const r = TERMS.computeTracker(data);
const days = TERMS.formatDays(r.latest.weightedAvgDaysPayable, 1);
const rate = TERMS.formatPct(r.latest.captureRate, 1);
if (!days || !html.includes(days)) { console.error("missing days", days); process.exit(1); }
if (!rate || !html.includes(rate + "%")) { console.error("missing rate", rate); process.exit(1); }
if (!html.includes("data-metric=\"captureRate\"")) process.exit(1);
if (!html.includes("data-metric=\"weightedAvgDaysPayable\"")) process.exit(1);
if (!html.includes("<table")) process.exit(1);
if (!html.includes("id=\"vendor-terms\"") || !html.includes("id=\"monthly-terms\"")) process.exit(1);
'

node_ok "static HTML has a row for every sample month and vendor" '
const fs = require("fs");
const TERMS = require("./js/terms.js");
const data = require("./data/terms.json");
const html = fs.readFileSync("index.html", "utf8");
const r = TERMS.computeTracker(data);
if (r.months.length < 12) process.exit(1);
for (const row of r.months) {
  if (!html.includes(row.month)) { console.error("missing month", row.month); process.exit(1); }
}
for (const v of r.vendors) {
  if (!html.includes(v.name)) { console.error("missing vendor", v.name); process.exit(1); }
}
'

# curl first-paint (no JS execution)
PORT=8765
python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/terms-http.log 2>&1 &
HTTP_PID=$!
cleanup() { kill "$HTTP_PID" 2>/dev/null || true; }
trap cleanup EXIT

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:${PORT}/" >/dev/null; then
    ready=1
    break
  fi
  sleep 0.2
done

if [[ "$ready" -ne 1 ]]; then
  fail "local HTTP server started for curl"
else
  pass "local HTTP server started for curl"
  HTML="$(curl -sL "http://127.0.0.1:${PORT}/")"
  if echo "$HTML" | grep -qi "capture rate" && echo "$HTML" | grep -qi "discount" && echo "$HTML" | grep -qi "days payable"; then
    pass "curl first-paint contains capture rate / discount / days payable content"
  else
    fail "curl first-paint contains capture rate / discount / days payable content"
  fi
  if echo "$HTML" | grep -Eq "[0-9]+(\\.[0-9]+)?%"; then
    pass "curl first-paint contains capture rate numbers"
  else
    fail "curl first-paint contains capture rate numbers"
  fi
  if echo "$HTML" | grep -q "data-month="; then
    pass "curl first-paint contains monthly table rows"
  else
    fail "curl first-paint contains monthly table rows"
  fi
  if echo "$HTML" | grep -q "data-vendor="; then
    pass "curl first-paint contains vendor table rows"
  else
    fail "curl first-paint contains vendor table rows"
  fi
  if echo "$HTML" | grep -qi "Loading"; then
    fail "curl first-paint has no Loading shell"
  else
    pass "curl first-paint has no Loading shell"
  fi
fi

echo "Summary: ${passed} passed, ${failed} failed"
if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
exit 0
