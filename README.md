# AP terms and discount-capture tracker

Public accounts-payable dashboard for **weighted average days payable**, **discount $ offered vs captured**, and **capture rate**. The first paint of `index.html` already contains the full metrics summary plus vendor and monthly tables — no JavaScript required.

Sample series: **5 vendors**, **18 months** (Apr 2024–Sep 2025), **162 invoices** for Northwind Components.

## Formulas

Each invoice contributes **days-to-pay** (calendar days from `invoiceDate` to `paidDate`) and an early-pay discount opportunity from the vendor’s terms.

| Metric | Formula | Meaning |
| --- | --- | --- |
| **Days payable (invoice)** | `paidDate − invoiceDate` | How long that invoice took to pay. Unpaid or invalid dates → excluded. |
| **Weighted avg days payable** | `Σ(amount × days payable) / Σ(amount)` | Amount-weighted pay speed. Zero paid amount → `null`. |
| **Discount $ offered** | `amount × (discountPct / 100)` | Potential early-pay discount. `discountPct` is whole percent (`2` = 2%). |
| **Discount $ captured** | offered, if paid within `discountWindowDays` (inclusive); else `$0` | Discount actually taken. Unpaid invoices do not capture. |
| **Capture rate** | `captured $ / offered $` | Share of available discount taken. Zero offered → `null`. |

Invoices are rolled up **by invoice-date month** for MoM, and **by vendor** for the terms table.

Unsafe math returns `null` (never `NaN` or `Infinity`):

- missing / non-finite / empty inputs
- zero invoices / empty vendor list / null dataset
- zero paid amount → weighted avg days payable is `null`
- `discountPct = 0` (e.g. net 30) → offered `$0`, capture rate `null`
- unpaid invoice → not in the days-payable average; offered still counts; captured `$0`
- negative days-to-pay (paid before invoice date) → excluded from days payable

**MoM:** current month minus previous month. Lower days payable is treated as faster payment (improving). Higher captured $ and capture rate are improving. Offered $ is volume (not scored). The first month has no MoM.

## How to re-render

Edit `data/terms.json`, then bake `index.html`:

```bash
node scripts/render-static.js
```

That overwrites `index.html` with computed cards, the vendor table, and the monthly table. Commit both the JSON and the generated HTML so GitHub Pages first-paint stays complete.

Optional: regenerate the sample invoices, then re-render:

```bash
node scripts/generate-sample.js
node scripts/render-static.js
```

```bash
bash scripts/test.sh
```

## Files

- `data/terms.json` — vendors (name, payment terms label, discount %, discount window days) and monthly invoices (amount, invoice / due / paid dates)
- `js/terms.js` — browser + Node module for all metrics
- `js/enhance.js` — optional class flag only; does not supply numbers
- `scripts/render-static.js` — static HTML baker
- `scripts/generate-sample.js` — optional sample-data generator
- `index.html` — first-paint snapshot
- `css/style.css` — minimal layout
- `.nojekyll` — serve as plain files on GitHub Pages

## Suggested next improvements

- Pull invoices from the AP subledger or bill-pay tool instead of a hand-edited JSON file
- Flag invoices paid after net terms (late vs on-net vs inside the discount window)
- Annualize captured discounts versus the implicit cost of paying early (lost float)
- Per-approver or per-entity capture rates, not only vendor and month
- What-if: pay every discount-eligible invoice on the last window day and show incremental $ captured
