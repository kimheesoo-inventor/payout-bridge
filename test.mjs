// Payout Bridge tests. Run: node test.mjs   (no dependencies, Node built-ins only)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require('./core.js');
const S = require('./samples.js');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message)); }
}

function sampleRun() {
  const pt = C.tableFromCSV(readFileSync(join(here, 'sample-payout-transactions.csv'), 'utf8'));
  const ot = C.tableFromCSV(readFileSync(join(here, 'sample-orders.csv'), 'utf8'));
  const pm = C.guessColumns(pt.headers, C.PAYOUT_FIELDS);
  const om = C.guessColumns(ot.headers, C.ORDER_FIELDS);
  return { pt, ot, pm, om, r: C.reconcile(pt, pm, ot, om) };
}

// --- CSV parsing ---
t('parse simple rows', () => assert.deepEqual(C.parseCSV('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]));
t('quoted field with comma', () => assert.deepEqual(C.parseCSV('a,b\n"1,234.50",x'), [['a', 'b'], ['1,234.50', 'x']]));
t('escaped double quotes', () => assert.deepEqual(C.parseCSV('a\n"say ""hi"""'), [['a'], ['say "hi"']]));
t('newline inside quotes', () => assert.deepEqual(C.parseCSV('a,b\n"line1\nline2",z\n'), [['a', 'b'], ['line1\nline2', 'z']]));
t('CRLF line endings', () => assert.deepEqual(C.parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]));
t('UTF-8 BOM removed from first header', () => {
  const tb = C.tableFromCSV('\ufeffType,Amount\ncharge,1.00');
  assert.equal(tb.headers[0], 'Type');
  assert.equal(C.guessColumns(tb.headers, C.PAYOUT_FIELDS).type, 0);
});
t('semicolon delimiter detected', () => assert.deepEqual(C.parseCSV('a;b\n1;2'), [['a', 'b'], ['1', '2']]));
t('blank lines skipped, short rows padded', () => {
  const tb = C.tableFromCSV('a,b,c\n\n1\n');
  assert.deepEqual(tb.rows, [['1', '', '']]);
});

// --- money ---
t('parseMoney "1,234.50"', () => assert.equal(C.parseMoney('1,234.50'), 123450));
t('parseMoney "-12.00"', () => assert.equal(C.parseMoney('-12.00'), -1200));
t('parseMoney other formats', () => {
  assert.equal(C.parseMoney('(12.00)'), -1200);
  assert.equal(C.parseMoney('$1,234.50'), 123450);
  assert.equal(C.parseMoney('USD 7'), 700);
  assert.equal(C.parseMoney('0.005'), 1);
  assert.equal(C.parseMoney('-0.00'), 0);
});
t('parseMoney rejects empty / text / bad grouping', () => {
  assert.equal(C.parseMoney(''), null);
  assert.equal(C.parseMoney('abc'), null);
  assert.equal(C.parseMoney('1,23'), null);
  assert.equal(C.parseMoney('1.234,50'), null);
});
t('formatCents', () => {
  assert.equal(C.formatCents(123450), '1,234.50');
  assert.equal(C.formatCents(-4000), '-40.00');
  assert.equal(C.formatCents(5, { thousands: false }), '0.05');
});

// --- order names ---
t('normalizeOrderName', () => {
  assert.equal(C.normalizeOrderName('#1001'), '1001');
  assert.equal(C.normalizeOrderName(' 1001 '), '1001');
  assert.equal(C.normalizeOrderName('#shop-12'), 'SHOP-12');
  assert.equal(C.normalizeOrderName(''), '');
});

// --- column guessing ---
t('guess payout columns from Shopify Help Center names (case-insensitive)', () => {
  const h = ['Transaction Date', 'TYPE', 'Order', 'Card Brand', 'Card Source', 'Payout Status', 'payout date', 'Available On', 'Amount', 'Fee', 'Net'];
  const m = C.guessColumns(h, C.PAYOUT_FIELDS);
  assert.deepEqual([m.type, m.order, m.amount, m.fee, m.net, m.payoutDate, m.status, m.payoutId, m.currency], [1, 2, 8, 9, 10, 6, 5, -1, -1]);
});
t('guess orders columns: "Name" not "Billing Name"', () => {
  const m = C.guessColumns(['Billing Name', 'Name', 'Total', 'Financial Status', 'Paid at', 'Refunded Amount', 'Currency'], C.ORDER_FIELDS);
  assert.deepEqual([m.name, m.total, m.financialStatus, m.paidAt, m.refunded, m.currency], [1, 2, 3, 4, 5, 6]);
});
t('missing columns reported by validateMapping', () => {
  const m = C.guessColumns(['Type', 'Order'], C.PAYOUT_FIELDS);
  const probs = C.validateMapping(m, 'payout');
  assert.ok(probs.some((p) => p.includes('Amount')));
  assert.ok(probs.some((p) => p.includes('Fee') && p.includes('Net')));
  assert.deepEqual(C.validateMapping(C.guessColumns(['Total'], C.ORDER_FIELDS), 'orders'), ['Missing column for "Order name".']);
});
t('reconcile refuses to run with missing required columns', () => {
  const pt = C.tableFromCSV('Type,Order\ncharge,#1');
  const ot = C.tableFromCSV('Name,Total\n#1,1.00');
  assert.throws(() => C.reconcile(pt, C.guessColumns(pt.headers, C.PAYOUT_FIELDS), ot, C.guessColumns(ot.headers, C.ORDER_FIELDS)), /mapping incomplete/);
});

// --- sample data ---
t('sample CSV files match the embedded copies in samples.js', () => {
  assert.equal(readFileSync(join(here, 'sample-payout-transactions.csv'), 'utf8'), S.payoutCsv);
  assert.equal(readFileSync(join(here, 'sample-orders.csv'), 'utf8'), S.ordersCsv);
});
t('sample: two payouts, 8 lines, 7 orders (line-item rows merged)', () => {
  const { r } = sampleRun();
  assert.deepEqual(r.payouts.map((g) => g.key), ['SYNTHETIC-P1', 'SYNTHETIC-P2']);
  assert.equal(r.counts.payoutLines, 8);
  assert.equal(r.counts.orders, 7);
  assert.deepEqual(r.warnings, []);
});
t('sample payout 1 totals', () => {
  const g = sampleRun().r.payouts[0];
  assert.deepEqual([g.lineCount, g.chargesC, g.refundsC, g.adjustmentsC, g.feesC, g.netC, g.balanced], [4, 145550, -4000, 0, 4311, 137239, true]);
});
t('sample payout 2 totals', () => {
  const g = sampleRun().r.payouts[1];
  assert.deepEqual([g.lineCount, g.chargesC, g.refundsC, g.adjustmentsC, g.feesC, g.netC, g.balanced], [4, 11600, 0, -1500, 427, 9673, true]);
});
t('sample payout explanation lines', () => {
  const r = sampleRun().r;
  assert.equal(r.payouts[0].explanation, 'Net = charges 1,455.50 - fees 43.11 - refunds 40.00 + adjustments 0.00 = 1,372.39');
  assert.equal(r.payouts[1].explanation, 'Net = charges 116.00 - fees 4.27 - refunds 0.00 - adjustments 15.00 = 96.73');
});
t('sample: orders with no payout line are #1006 (paid) and #1007 (pending)', () => {
  const u = sampleRun().r.unmatchedOrders;
  assert.deepEqual(u.map((x) => x.order), ['#1006', '#1007']);
  assert.match(u[1].hint, /pending/);
});
t('sample: payout line with no order is #1099', () => {
  const u = sampleRun().r.unmatchedLines;
  assert.deepEqual(u.map((x) => [x.order, x.amountC, x.payout]), [['#1099', 2200, 'SYNTHETIC-P2']]);
});
t('sample: mismatch detected for #1004 (69.00 vs 64.00), refund for #1001 matches', () => {
  const m = sampleRun().r.mismatches;
  assert.equal(m.length, 1);
  assert.deepEqual([m[0].order, m[0].orderValueC, m[0].payoutValueC, m[0].diffC], ['#1004', 6900, 6400, -500]);
});

// --- other reconcile cases ---
const PH = 'Type,Order,Amount,Fee,Net,Payout Date\n';
const OH = 'Name,Total,Refunded Amount\n';
function run(p, o) {
  const pt = C.tableFromCSV(PH + p);
  const ot = C.tableFromCSV(OH + o);
  return C.reconcile(pt, C.guessColumns(pt.headers, C.PAYOUT_FIELDS), ot, C.guessColumns(ot.headers, C.ORDER_FIELDS));
}
t('refund mismatch: order says 10.00 refunded, payout shows 7.00', () => {
  const r = run('charge,1,50.00,1.00,49.00,2026-02-01\nrefund,#1,-7.00,0,-7.00,2026-02-01\n', '#1,50.00,10.00\n');
  assert.deepEqual(r.mismatches.map((x) => [x.kind, x.orderValueC, x.payoutValueC, x.diffC]), [['Refund vs order refunded amount', 1000, 700, -300]]);
});
t('fee exported as negative number is handled', () => {
  const r = run('charge,#1,50.00,-1.50,48.50,2026-02-01\n', '#1,50.00,0\n');
  assert.deepEqual([r.payouts[0].feesC, r.payouts[0].netC, r.payouts[0].balanced, r.warnings.length], [150, 4850, true, 0]);
});
t('net that does not equal amount - fee is warned about', () => {
  const r = run('charge,#1,50.00,1.00,40.00,2026-02-01\n', '#1,50.00,0\n');
  assert.equal(r.payouts[0].balanced, false);
  assert.ok(r.warnings.some((w) => w.includes('does not equal net')));
});
t('no payout ID column: grouped by payout date', () => {
  const r = run('charge,#1,10.00,0.50,9.50,2026-02-01\ncharge,#2,20.00,0.80,19.20,2026-02-03\n', '#1,10.00,0\n#2,20.00,0\n');
  assert.deepEqual(r.payouts.map((g) => g.key), ['Payout date 2026-02-01', 'Payout date 2026-02-03']);
});
t('bad amount line skipped with warning; multiple currencies warned', () => {
  const pt = C.tableFromCSV('Type,Order,Amount,Net,Currency\ncharge,#1,abc,1,USD\ncharge,#2,5.00,4.50,CAD\ncharge,#3,5.00,4.50,USD\n');
  const ot = C.tableFromCSV('Name,Total\n#2,5.00\n#3,5.00\n');
  const r = C.reconcile(pt, C.guessColumns(pt.headers, C.PAYOUT_FIELDS), ot, C.guessColumns(ot.headers, C.ORDER_FIELDS));
  assert.equal(r.badLines.length, 1);
  assert.ok(r.warnings.some((w) => w.includes('currency')));
  assert.equal(r.payouts[0].feesC, 100);
});
t('results CSV: header, one row per finding, parses back', () => {
  const r = sampleRun().r;
  const rows = C.parseCSV(C.resultsToCSV(r));
  assert.deepEqual(rows[0], C.RESULT_HEADERS);
  assert.equal(rows.length, 1 + 2 + 1 + 2 + 1);
  assert.equal(rows.find((x) => x[0] === 'Amount difference')[12], '-5.00');
});
t('results CSV guards formula-like text but keeps negative numbers', () => {
  assert.equal(C.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(C.csvCell('-12.00'), '-12.00');
  assert.equal(C.csvCell('a,b'), '"a,b"');
});
t('classifyType', () => {
  assert.deepEqual(['charge', 'Refund', 'adjustment', 'chargeback', 'dispute', 'reserved_funds'].map(C.classifyType),
    ['charge', 'refund', 'adjustment', 'other', 'other', 'other']);
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed) process.exit(1);
