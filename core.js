/*
 * Payout Bridge - core functions (no DOM, no network).
 * Loaded as a classic <script> in the page (exposes window.PayoutBridgeCore)
 * and via require() in Node tests (module.exports). MIT License.
 * All money is handled as integer cents to avoid floating point drift.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.PayoutBridgeCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------- CSV parsing ----------

  function stripBOM(text) {
    text = String(text == null ? '' : text);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  // Guess delimiter from the first line (outside quotes): comma, semicolon or tab.
  function detectDelimiter(text) {
    text = stripBOM(text);
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '"') inQ = !inQ;
      else if (!inQ && (c === '\n' || c === '\r')) break;
      else if (!inQ && counts.hasOwnProperty(c)) counts[c]++;
    }
    var best = ',';
    if (counts[';'] > counts[best]) best = ';';
    if (counts['\t'] > counts[best]) best = '\t';
    return best;
  }

  // RFC 4180-style parser: quoted fields, "" escapes, commas and newlines inside quotes,
  // CRLF/LF/CR line endings, UTF-8 BOM. Returns an array of rows (arrays of strings).
  function parseCSV(text, delimiter) {
    text = stripBOM(text);
    var d = delimiter || detectDelimiter(text);
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var n = text.length;
    while (i < n) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === d) { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = ''; i++; continue;
      }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) {
      return !r.every(function (v) { return String(v).trim() === ''; });
    });
  }

  // Returns { headers: [...], rows: [[...], ...] } with every row padded to header length.
  function tableFromCSV(text) {
    var all = parseCSV(text);
    if (!all.length) return { headers: [], rows: [] };
    var headers = all[0].map(function (h) { return String(h).trim(); });
    var rows = all.slice(1).map(function (r) {
      var out = r.slice(0, headers.length);
      while (out.length < headers.length) out.push('');
      return out;
    });
    return { headers: headers, rows: rows };
  }

  // ---------- Column mapping ----------

  var PAYOUT_FIELDS = [
    { key: 'type', label: 'Transaction type', required: true, aliases: ['type', 'transaction type', 'kind'] },
    { key: 'order', label: 'Order name / number', required: true, aliases: ['order', 'order name', 'order number', 'order id'] },
    { key: 'amount', label: 'Amount (before fee)', required: true, aliases: ['amount', 'gross', 'gross amount', 'amount gross'] },
    { key: 'fee', label: 'Fee', required: false, aliases: ['fee', 'fees', 'fee amount', 'processing fee'] },
    { key: 'net', label: 'Net', required: false, aliases: ['net', 'net amount'] },
    { key: 'payoutId', label: 'Payout ID', required: false, aliases: ['payout id', 'payout', 'payout number', 'payout reference'] },
    { key: 'payoutDate', label: 'Payout date', required: false, aliases: ['payout date', 'paid out on', 'payout paid on'] },
    { key: 'currency', label: 'Currency', required: false, aliases: ['currency', 'currency code'] },
    { key: 'status', label: 'Payout status', required: false, aliases: ['payout status', 'status'] }
  ];

  var ORDER_FIELDS = [
    { key: 'name', label: 'Order name', required: true, aliases: ['name', 'order', 'order name', 'order number'] },
    { key: 'total', label: 'Order total', required: true, aliases: ['total', 'total price', 'order total', 'total amount'] },
    { key: 'financialStatus', label: 'Financial status', required: false, aliases: ['financial status', 'payment status'] },
    { key: 'paidAt', label: 'Paid at', required: false, aliases: ['paid at', 'paid date', 'payment date'] },
    { key: 'refunded', label: 'Refunded amount', required: false, aliases: ['refunded amount', 'refunded', 'total refunded', 'refund amount'] },
    { key: 'currency', label: 'Currency', required: false, aliases: ['currency', 'currency code'] }
  ];

  // Lowercase, drop "(...)" parts, treat _ - . as spaces, collapse whitespace.
  function normalizeHeader(h) {
    return String(h == null ? '' : h)
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Exact (normalized, case-insensitive) alias match. Aliases earlier in the list win.
  // A header column is never assigned to two fields. Returns { key: columnIndex | -1 }.
  function guessColumns(headers, fields) {
    var norm = (headers || []).map(normalizeHeader);
    var used = {};
    var map = {};
    fields.forEach(function (f) {
      map[f.key] = -1;
      for (var a = 0; a < f.aliases.length; a++) {
        for (var i = 0; i < norm.length; i++) {
          if (!used[i] && norm[i] === f.aliases[a]) {
            map[f.key] = i; used[i] = true; a = f.aliases.length; break;
          }
        }
      }
    });
    return map;
  }

  function isMapped(map, key) {
    return map && typeof map[key] === 'number' && map[key] >= 0;
  }

  // Returns a list of plain-English problems; empty list means OK to run.
  function validateMapping(map, kind) {
    var fields = kind === 'orders' ? ORDER_FIELDS : PAYOUT_FIELDS;
    var problems = [];
    fields.forEach(function (f) {
      if (f.required && !isMapped(map, f.key)) problems.push('Missing column for "' + f.label + '".');
    });
    if (kind !== 'orders' && !isMapped(map, 'fee') && !isMapped(map, 'net')) {
      problems.push('Map at least one of "Fee" or "Net".');
    }
    var seen = {};
    fields.forEach(function (f) {
      if (isMapped(map, f.key)) {
        var idx = map[f.key];
        if (seen[idx]) problems.push('The same column is used for "' + seen[idx] + '" and "' + f.label + '".');
        else seen[idx] = f.label;
      }
    });
    return problems;
  }

  // ---------- Values ----------

  // "#1001" -> "1001", " 1001 " -> "1001", "#shop-12" -> "SHOP-12"
  function normalizeOrderName(v) {
    return String(v == null ? '' : v).trim().replace(/^#+/, '').replace(/\s+/g, '').toUpperCase();
  }

  // Money text -> integer cents, or null if not a number.
  // Accepts "1,234.50", "-12.00", "(12.00)", "$1,234.50", "USD 12", "12.5".
  // Does NOT accept European "1.234,50" (returns null).
  function parseMoney(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) || 0 : null;
    var s = String(v).trim();
    if (!s) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[\u2212\u2012\u2013\u2014]/g, '-');
    s = s.replace(/[^0-9.,+\-]/g, '');
    if (s.charAt(0) === '-') { neg = !neg; s = s.slice(1); }
    else if (s.charAt(0) === '+') s = s.slice(1);
    if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/.test(s) || s === '' || s === '.') return null;
    s = s.replace(/,/g, '');
    var parts = s.split('.');
    var whole = parts[0] ? parseInt(parts[0], 10) : 0;
    var frac = (parts[1] || '') + '000';
    var cents = whole * 100 + parseInt(frac.slice(0, 2), 10) + (frac.charAt(2) >= '5' ? 1 : 0);
    if (!isFinite(cents)) return null;
    return neg && cents !== 0 ? -cents : cents;
  }

  function formatCents(c, opts) {
    if (c == null || !isFinite(c)) return '';
    var thousands = !opts || opts.thousands !== false;
    var neg = c < 0;
    var abs = Math.abs(c);
    var whole = String(Math.floor(abs / 100));
    var frac = String(abs % 100);
    if (frac.length < 2) frac = '0' + frac;
    if (thousands) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + whole + '.' + frac;
  }

  function classifyType(t) {
    t = String(t == null ? '' : t).trim().toLowerCase();
    if (!t) return 'other';
    if (/refund/.test(t)) return 'refund';
    if (/charge ?back|dispute/.test(t)) return 'other';
    if (/charge|sale|payment|capture/.test(t)) return 'charge';
    if (/adjust/.test(t)) return 'adjustment';
    return 'other';
  }

  function cell(row, map, key) {
    return isMapped(map, key) ? String(row[map[key]] == null ? '' : row[map[key]]).trim() : '';
  }

  // ---------- Reconcile ----------

  function reconcile(payoutTable, payoutMap, ordersTable, ordersMap) {
    var p1 = validateMapping(payoutMap, 'payout');
    var p2 = validateMapping(ordersMap, 'orders');
    if (p1.length || p2.length) {
      var err = new Error('Column mapping incomplete: ' + p1.concat(p2).join(' '));
      err.problems = { payout: p1, orders: p2 };
      throw err;
    }

    var warnings = [];
    var badLines = [];
    var lines = [];
    var hasPayoutCol = isMapped(payoutMap, 'payoutId') || isMapped(payoutMap, 'payoutDate');
    if (!hasPayoutCol) warnings.push('No payout ID or payout date column is mapped, so all lines are shown as one group.');

    payoutTable.rows.forEach(function (row, idx) {
      var lineNo = idx + 1;
      var amountC = parseMoney(cell(row, payoutMap, 'amount'));
      if (amountC == null) {
        badLines.push({ line: lineNo, reason: 'Amount is empty or not a number: "' + cell(row, payoutMap, 'amount') + '"' });
        return;
      }
      var feeC = isMapped(payoutMap, 'fee') ? parseMoney(cell(row, payoutMap, 'fee')) : null;
      var netC = isMapped(payoutMap, 'net') ? parseMoney(cell(row, payoutMap, 'net')) : null;
      var consistent = true;
      if (feeC == null && netC == null) feeC = 0;
      if (netC == null) netC = amountC - feeC;
      else if (feeC == null) feeC = amountC - netC;
      else if (amountC - feeC !== netC) {
        if (amountC + feeC === netC) feeC = -feeC; // fee exported as a negative number
        else consistent = false;
      }
      var payoutId = cell(row, payoutMap, 'payoutId');
      var payoutDate = cell(row, payoutMap, 'payoutDate');
      var status = cell(row, payoutMap, 'status');
      var key;
      if (!hasPayoutCol) key = 'All lines';
      else if (payoutId) key = payoutId;
      else if (payoutDate) key = 'Payout date ' + payoutDate;
      else key = status ? 'No payout yet (' + status + ')' : 'No payout ID';
      var typeRaw = cell(row, payoutMap, 'type');
      var orderRaw = cell(row, payoutMap, 'order');
      lines.push({
        line: lineNo,
        typeRaw: typeRaw,
        category: classifyType(typeRaw),
        orderRaw: orderRaw,
        orderKey: normalizeOrderName(orderRaw),
        amountC: amountC,
        feeC: feeC,
        netC: netC,
        consistent: consistent,
        payoutKey: key,
        payoutDate: payoutDate,
        currency: cell(row, payoutMap, 'currency').toUpperCase()
      });
      if (!consistent) {
        warnings.push('Line ' + lineNo + ': amount ' + formatCents(amountC) + ' minus fee ' + formatCents(feeC) +
          ' does not equal net ' + formatCents(netC) + '. The net value from the file is used.');
      }
    });

    // Group by payout, keeping first-seen order.
    var groups = [];
    var byKey = {};
    lines.forEach(function (l) {
      var g = byKey[l.payoutKey];
      if (!g) {
        g = byKey[l.payoutKey] = {
          key: l.payoutKey, payoutDate: l.payoutDate, currencies: [], lineCount: 0,
          chargesC: 0, refundsC: 0, adjustmentsC: 0, feesC: 0, netC: 0
        };
        groups.push(g);
      }
      g.lineCount++;
      if (l.category === 'charge') g.chargesC += l.amountC;
      else if (l.category === 'refund') g.refundsC += l.amountC;
      else g.adjustmentsC += l.amountC;
      g.feesC += l.feeC;
      g.netC += l.netC;
      if (l.currency && g.currencies.indexOf(l.currency) < 0) g.currencies.push(l.currency);
      if (!g.payoutDate && l.payoutDate) g.payoutDate = l.payoutDate;
    });
    groups.forEach(function (g) {
      g.computedC = g.chargesC + g.refundsC + g.adjustmentsC - g.feesC;
      g.balanced = g.computedC === g.netC;
      g.explanation = explainPayout(g);
    });

    // Orders: one entry per normalized order name (extra line-item rows are merged).
    var orders = [];
    var orderByKey = {};
    var skippedOrderRows = 0;
    ordersTable.rows.forEach(function (row) {
      var raw = cell(row, ordersMap, 'name');
      var k = normalizeOrderName(raw);
      if (!k) { skippedOrderRows++; return; }
      var o = orderByKey[k];
      if (!o) {
        o = orderByKey[k] = { key: k, name: raw, totalC: null, refundedC: null, financialStatus: '', paidAt: '', currency: '', rowCount: 0 };
        orders.push(o);
      }
      o.rowCount++;
      if (o.totalC == null) o.totalC = parseMoney(cell(row, ordersMap, 'total'));
      if (o.refundedC == null && isMapped(ordersMap, 'refunded')) o.refundedC = parseMoney(cell(row, ordersMap, 'refunded'));
      if (!o.financialStatus) o.financialStatus = cell(row, ordersMap, 'financialStatus');
      if (!o.paidAt) o.paidAt = cell(row, ordersMap, 'paidAt');
      if (!o.currency) o.currency = cell(row, ordersMap, 'currency').toUpperCase();
    });

    // Index payout lines by order.
    var byOrder = {};
    lines.forEach(function (l) {
      if (!l.orderKey) return;
      var e = byOrder[l.orderKey] || (byOrder[l.orderKey] = { chargeC: 0, refundC: 0, charges: 0, refunds: 0, others: 0, payouts: [] });
      if (l.category === 'charge') { e.chargeC += l.amountC; e.charges++; }
      else if (l.category === 'refund') { e.refundC += l.amountC; e.refunds++; }
      else e.others++;
      if (e.payouts.indexOf(l.payoutKey) < 0) e.payouts.push(l.payoutKey);
    });

    var unmatchedLines = lines.filter(function (l) { return l.orderKey && !orderByKey[l.orderKey]; }).map(function (l) {
      return { payout: l.payoutKey, order: l.orderRaw, type: l.typeRaw, amountC: l.amountC, netC: l.netC, line: l.line };
    });

    var unmatchedOrders = [];
    var mismatches = [];
    orders.forEach(function (o) {
      var e = byOrder[o.key];
      if (!e || e.charges === 0) {
        var status = o.financialStatus.toLowerCase();
        var hint;
        if (e) hint = 'Only refund or other lines were found for this order in the payout file, no charge line.';
        else if (/pending|authori[sz]ed|unpaid|voided/.test(status)) hint = 'Order is marked "' + o.financialStatus + '", so the payment may not have been captured yet.';
        else hint = 'Not in this payout file. It may be in a later payout, outside the export date range, or paid with a different payment method.';
        unmatchedOrders.push({ order: o.name, totalC: o.totalC, financialStatus: o.financialStatus, paidAt: o.paidAt, hint: hint });
        return;
      }
      if (o.totalC != null && e.chargeC !== o.totalC) {
        mismatches.push({
          order: o.name, kind: 'Charge vs order total', orderValueC: o.totalC, payoutValueC: e.chargeC,
          diffC: e.chargeC - o.totalC, payouts: e.payouts.join(' / ')
        });
      }
      if (o.refundedC != null) {
        var refundAbs = Math.abs(e.refundC);
        if (refundAbs !== o.refundedC) {
          mismatches.push({
            order: o.name, kind: 'Refund vs order refunded amount', orderValueC: o.refundedC, payoutValueC: refundAbs,
            diffC: refundAbs - o.refundedC, payouts: e.payouts.join(' / ')
          });
        }
      }
    });

    // Currency check.
    var currencies = [];
    lines.forEach(function (l) { if (l.currency && currencies.indexOf(l.currency) < 0) currencies.push(l.currency); });
    orders.forEach(function (o) { if (o.currency && currencies.indexOf(o.currency) < 0) currencies.push(o.currency); });
    if (currencies.length > 1) {
      warnings.push('More than one currency found (' + currencies.join(', ') + '). This version does not convert currencies, so totals that mix them are not meaningful.');
    }
    var notPaidOut = payoutTable.rows.filter(function (row) { return /pending|in.?transit|scheduled/i.test(cell(row, payoutMap, 'status')); }).length;
    if (notPaidOut) warnings.push(notPaidOut + ' payout line(s) have a payout status such as "pending". They may not be in your bank yet, and their payout date may only be an estimate.');
    if (badLines.length) warnings.push(badLines.length + ' payout line(s) were skipped because the amount was not a number.');

    return {
      payouts: groups,
      unmatchedOrders: unmatchedOrders,
      unmatchedLines: unmatchedLines,
      mismatches: mismatches,
      warnings: warnings,
      badLines: badLines,
      currencies: currencies,
      counts: { payoutLines: lines.length, orders: orders.length, skippedOrderRows: skippedOrderRows }
    };
  }

  function explainPayout(g) {
    var f = function (c) { return formatCents(c); };
    var refundPart = g.refundsC <= 0 ? ' - refunds ' + f(-g.refundsC) : ' + refunds ' + f(g.refundsC);
    var adjPart = g.adjustmentsC >= 0 ? ' + adjustments ' + f(g.adjustmentsC) : ' - adjustments ' + f(-g.adjustmentsC);
    var text = 'Net = charges ' + f(g.chargesC) + ' - fees ' + f(g.feesC) + refundPart + adjPart + ' = ' + f(g.computedC);
    if (!g.balanced) text += ' (the Net column adds up to ' + f(g.netC) + ', see warnings)';
    return text;
  }

  // ---------- Results CSV ----------

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    // Guard against spreadsheet formula injection for text cells (numbers like -12.00 are left alone).
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s))) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  var RESULT_HEADERS = ['Section', 'Payout', 'Order', 'Type', 'Lines', 'Charges', 'Refunds', 'Adjustments and other',
    'Fees', 'Net', 'Order value', 'Payout value', 'Difference', 'Note'];

  function resultsToCSV(result) {
    var m = function (c) { return formatCents(c, { thousands: false }); };
    var out = [RESULT_HEADERS];
    result.payouts.forEach(function (g) {
      out.push(['Payout summary', g.key, '', '', g.lineCount, m(g.chargesC), m(g.refundsC), m(g.adjustmentsC), m(g.feesC), m(g.netC), '', '', '', g.explanation]);
    });
    result.mismatches.forEach(function (x) {
      out.push(['Amount difference', x.payouts, x.order, x.kind, '', '', '', '', '', '', m(x.orderValueC), m(x.payoutValueC), m(x.diffC), '']);
    });
    result.unmatchedOrders.forEach(function (x) {
      out.push(['Order with no payout line', '', x.order, x.financialStatus, '', '', '', '', '', '', m(x.totalC), '', '', x.hint]);
    });
    result.unmatchedLines.forEach(function (x) {
      out.push(['Payout line with no order', x.payout, x.order, x.type, '', '', '', '', '', m(x.netC), '', m(x.amountC), '', 'Order not found in the orders file']);
    });
    return out.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  return {
    stripBOM: stripBOM,
    detectDelimiter: detectDelimiter,
    parseCSV: parseCSV,
    tableFromCSV: tableFromCSV,
    PAYOUT_FIELDS: PAYOUT_FIELDS,
    ORDER_FIELDS: ORDER_FIELDS,
    normalizeHeader: normalizeHeader,
    guessColumns: guessColumns,
    validateMapping: validateMapping,
    normalizeOrderName: normalizeOrderName,
    parseMoney: parseMoney,
    formatCents: formatCents,
    classifyType: classifyType,
    reconcile: reconcile,
    explainPayout: explainPayout,
    csvCell: csvCell,
    resultsToCSV: resultsToCSV,
    RESULT_HEADERS: RESULT_HEADERS
  };
});
