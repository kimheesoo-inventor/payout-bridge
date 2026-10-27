# Payout Bridge (v0)

A free, open-source, browser-only page that helps a small Shopify seller (or their bookkeeper) see why a
Shopify Payments bank payout is different from the order totals.

You give it two CSV exports from your Shopify admin:

1. **Payout transactions CSV** - Finance > Payouts, open one payout (or View transactions), then Export. Shopify emails you the CSV.
2. **Orders CSV** - Orders > Export.

It shows, in plain English:

- **Per payout:** number of lines, charges, refunds, adjustments and other types, fees, and the payout net total,
  plus a one-line explanation such as
  `Net = charges 1,455.50 - fees 43.11 - refunds 40.00 + adjustments 0.00 = 1,372.39`.
- **Orders with no matching payout line** (matched by order name, `#1001` = `1001`), with a possible reason.
- **Payout lines with no matching order.**
- **Orders whose total differs from the matched charge amount** (both values and the difference), and orders
  whose refunded amount differs from the refund lines in the payout file.
- A **Download results as CSV** button (the file is created in your browser).

## How to use

1. Open `index.html` in a browser (double-click works; no install, no server).
2. Choose your two CSV files, or click **Load sample data** to try it with synthetic example data.
3. Check the **column mapping**. Each field is guessed from the column titles (not case-sensitive). Column names
   can differ between stores and export versions, so check every select box and fix any wrong guess.
4. Click **Compare payouts and orders**.

## Privacy

- Everything runs locally in your browser tab. Files are read with the browser's FileReader and are not uploaded.
- Once the page has loaded, it makes no network calls, has no analytics, and loads no outside scripts or fonts. A Content Security
  Policy tag blocks network connections (`connect-src 'none'`).
- The sample files (`sample-payout-transactions.csv`, `sample-orders.csv`) are **synthetic example data**.
  They are made up and do not come from any real store.

## Limits

- Not accounting or tax advice.
- Does not connect to Shopify or to a bank. It only reads the two files you choose.
- Column names may differ by store, language or export version; check the mapping.
- Version 0 does not handle multiple currencies (it warns if it sees more than one) or other payment providers
  such as PayPal or Amazon Pay.
- Amounts must use a dot for decimals (`1,234.50`, `-12.00`, `(12.00)`); `1.234,50` is not read.
- If there is no Payout ID column, lines are grouped by payout date. One payout date can include more than one payout, so a group may cover more than one bank deposit.
- Reserves, held funds, gift cards and orders paid partly another way are not modelled; they may show up as
  differences that are expected for your store.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page (HTML + CSS). |
| `app.js` | Page logic (file reading, mapping UI, results, CSV download). |
| `core.js` | Pure functions shared by the page and the tests: CSV parsing, column guessing, money parsing, order-name matching, reconciliation, results CSV. |
| `samples.js` | The two synthetic sample files embedded, so "Load sample data" works when the page is opened from disk. |
| `sample-payout-transactions.csv`, `sample-orders.csv` | The same synthetic sample data as files. |
| `test.mjs` | Tests. Run `node test.mjs` (Node 18+, no dependencies). |

## License

MIT. Copyright (c) 2026 Heesoo Kim. See `LICENSE`.
Not affiliated with or endorsed by Shopify.
