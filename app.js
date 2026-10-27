/* Payout Bridge - page logic. Uses PayoutBridgeCore (core.js) and PayoutBridgeSamples (samples.js).
 * No network calls. Files are read with FileReader. All text is inserted with textContent. MIT License. */
(function () {
  'use strict';
  var C = window.PayoutBridgeCore;
  var S = window.PayoutBridgeSamples;
  var money = function (c) { return C.formatCents(c); };

  var state = {
    payout: null, orders: null,          // { headers, rows, name }
    payoutMap: null, ordersMap: null,
    result: null
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function readFile(file, cb) {
    var r = new FileReader();
    r.onload = function () { cb(null, String(r.result)); };
    r.onerror = function () { cb(r.error || new Error('Could not read file')); };
    r.readAsText(file);
  }

  function loadTable(kind, text, name) {
    var t = C.tableFromCSV(text);
    t.name = name;
    var fields = kind === 'orders' ? C.ORDER_FIELDS : C.PAYOUT_FIELDS;
    if (kind === 'orders') { state.orders = t; state.ordersMap = C.guessColumns(t.headers, fields); }
    else { state.payout = t; state.payoutMap = C.guessColumns(t.headers, fields); }
    var info = $(kind === 'orders' ? 'ordersInfo' : 'payoutInfo');
    info.textContent = name + ': ' + t.rows.length + ' data rows, ' + t.headers.length + ' columns.';
    state.result = null;
    $('resultsSection').hidden = true;
    renderMappings();
  }

  function onFile(kind, input) {
    var f = input.files && input.files[0];
    if (!f) return;
    readFile(f, function (err, text) {
      if (err) { $(kind === 'orders' ? 'ordersInfo' : 'payoutInfo').textContent = 'Could not read this file.'; return; }
      loadTable(kind, text, f.name);
    });
  }

  function renderMapping(kind) {
    var box = $(kind === 'orders' ? 'ordersMapping' : 'payoutMapping');
    clear(box);
    var table = kind === 'orders' ? state.orders : state.payout;
    var map = kind === 'orders' ? state.ordersMap : state.payoutMap;
    var fields = kind === 'orders' ? C.ORDER_FIELDS : C.PAYOUT_FIELDS;
    box.appendChild(el('h3', { text: kind === 'orders' ? 'Orders file' : 'Payout transactions file' }));
    if (!table) { box.appendChild(el('p', { class: 'empty', text: 'No file chosen yet.' })); return; }
    box.appendChild(el('p', { class: 'muted', text: table.name }));
    if (!table.headers.length) { box.appendChild(el('p', { class: 'error', text: 'This file looks empty.' })); return; }
    fields.forEach(function (f) {
      var id = 'map-' + kind + '-' + f.key;
      var sel = el('select', { id: id });
      sel.appendChild(el('option', { value: '-1', text: '(not in this file)' }));
      table.headers.forEach(function (h, i) {
        var o = el('option', { value: String(i), text: h || ('Column ' + (i + 1)) });
        if (map[f.key] === i) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        map[f.key] = parseInt(sel.value, 10);
        renderProblems();
        $('resultsSection').hidden = true;
      });
      var label = el('label', { for: id }, [f.label, f.required ? el('span', { class: 'req', text: ' *' }) : null,
        map[f.key] >= 0 ? el('span', { class: 'tag', text: 'guessed' }) : el('span', { class: 'tag', text: 'not found' })]);
      box.appendChild(el('div', { class: 'map-row' }, [label, sel]));
    });
    if (kind !== 'orders') box.appendChild(el('p', { class: 'muted', text: 'Map at least one of Fee or Net. If there is no Payout ID column, lines are grouped by payout date.' }));
  }

  function renderProblems() {
    var box = $('mappingProblems');
    clear(box);
    var probs = [];
    if (!state.payout) probs.push('Choose a payout transactions CSV.');
    else C.validateMapping(state.payoutMap, 'payout').forEach(function (p) { probs.push('Payout file: ' + p); });
    if (!state.orders) probs.push('Choose an orders CSV.');
    else C.validateMapping(state.ordersMap, 'orders').forEach(function (p) { probs.push('Orders file: ' + p); });
    probs.forEach(function (p) { box.appendChild(el('p', { class: 'error', text: p })); });
    $('runBtn').disabled = probs.length > 0;
    return probs;
  }

  function renderMappings() {
    $('mappingSection').hidden = false;
    renderMapping('payout');
    renderMapping('orders');
    renderProblems();
  }

  function tableOf(headers, rows, numCols) {
    var thead = el('thead', null, [el('tr', null, headers.map(function (h, i) {
      return el('th', { class: numCols.indexOf(i) >= 0 ? 'num' : '', scope: 'col', text: h });
    }))]);
    var tbody = el('tbody', null, rows.map(function (r) {
      return el('tr', null, r.map(function (v, i) {
        return el('td', { class: numCols.indexOf(i) >= 0 ? 'num' : '', text: v == null ? '' : String(v) });
      }));
    }));
    return el('div', { class: 'table-wrap', tabindex: '0' }, [el('table', null, [thead, tbody])]);
  }

  function section(title, intro, content) {
    return el('div', { class: 'block' }, [el('h3', { text: title, style: 'margin-top:20px' }), intro ? el('p', { class: 'muted', text: intro }) : null, content]);
  }

  function renderResults(r) {
    var box = $('results');
    clear(box);
    box.appendChild(el('p', null, ['Read ' + r.counts.payoutLines + ' payout lines in ' + r.payouts.length + ' payout group(s), and ' +
      r.counts.orders + ' orders. Found ' + r.mismatches.length + ' amount difference(s), ' + r.unmatchedOrders.length +
      ' order(s) with no payout line, and ' + r.unmatchedLines.length + ' payout line(s) with no matching order.']));
    if (state.payout && state.payout.name === S.payoutFileName) box.appendChild(el('p', { class: 'warn', text: 'You are looking at synthetic example data, not a real store.' }));
    r.warnings.forEach(function (w) { box.appendChild(el('p', { class: 'warn', text: w })); });

    // Per payout
    var cards = el('div', { class: 'payout-cards' });
    r.payouts.forEach(function (g) {
      var dl = el('dl', { class: 'sum' }, [
        el('dt', { text: 'Lines' }), el('dd', { text: String(g.lineCount) }),
        el('dt', { text: 'Charges' }), el('dd', { text: money(g.chargesC) }),
        el('dt', { text: 'Refunds' }), el('dd', { text: money(g.refundsC) }),
        el('dt', { text: 'Adjustments and other' }), el('dd', { text: money(g.adjustmentsC) }),
        el('dt', { text: 'Fees' }), el('dd', { text: money(-g.feesC) }),
        el('dt', { class: 'total', text: 'Payout net total' }), el('dd', { class: 'total', text: money(g.netC) + (g.currencies.length ? ' ' + g.currencies.join('/') : '') })
      ]);
      cards.appendChild(el('div', { class: 'card' }, [
        el('h3', { text: /^(payout|no payout|all lines)/i.test(g.key) ? g.key : 'Payout ' + g.key }),
        g.payoutDate ? el('p', { class: 'muted', text: 'Payout date: ' + g.payoutDate }) : null,
        dl,
        el('p', { class: 'explain', text: g.explanation }),
        g.balanced ? null : el('p', { class: 'error', text: 'The lines do not add up to the Net column. See the warnings above.' })
      ]));
    });
    box.appendChild(section('Per payout', 'Fees are shown as a deduction. Compare the payout net total with the deposit on your bank statement.', cards));

    box.appendChild(section('Orders whose total differs from the payout amount',
      'Difference = payout value minus order value. A charge can differ from the order total when an order was edited, partly paid another way, or paid in several captures.',
      r.mismatches.length ? tableOf(['Order', 'What was compared', 'Order value', 'Payout value', 'Difference', 'Payout'],
        r.mismatches.map(function (x) { return [x.order, x.kind, money(x.orderValueC), money(x.payoutValueC), money(x.diffC), x.payouts]; }), [2, 3, 4])
        : el('p', { class: 'ok', text: 'No differences found between matched orders and payout charges.' })));

    box.appendChild(section('Orders with no matching payout line', null,
      r.unmatchedOrders.length ? tableOf(['Order', 'Order total', 'Financial status', 'Paid at', 'Possible reason'],
        r.unmatchedOrders.map(function (x) { return [x.order, money(x.totalC), x.financialStatus, x.paidAt, x.hint]; }), [1])
        : el('p', { class: 'ok', text: 'Every order has at least one charge line in the payout file.' })));

    box.appendChild(section('Payout lines with no matching order', 'These lines name an order that is not in the orders file. The orders export may cover different dates.',
      r.unmatchedLines.length ? tableOf(['Payout', 'Order', 'Type', 'Amount', 'Net', 'File row (header not counted)'],
        r.unmatchedLines.map(function (x) { return [x.payout, x.order, x.type, money(x.amountC), money(x.netC), x.line]; }), [3, 4, 5])
        : el('p', { class: 'ok', text: 'Every payout line with an order name was found in the orders file.' })));

    if (r.badLines.length) {
      box.appendChild(section('Skipped lines', null, tableOf(['File row (header not counted)', 'Reason'], r.badLines.map(function (x) { return [x.line, x.reason]; }), [0])));
    }
    $('resultsSection').hidden = false;
  }

  function run() {
    if (renderProblems().length) return;
    try {
      state.result = C.reconcile(state.payout, state.payoutMap, state.orders, state.ordersMap);
      renderResults(state.result);
      $('step3').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      var box = $('mappingProblems');
      box.appendChild(el('p', { class: 'error', text: e.message }));
    }
  }

  function download() {
    if (!state.result) return;
    var csv = '\ufeff' + C.resultsToCSV(state.result);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: 'payout-bridge-results.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  $('payoutFile').addEventListener('change', function () { onFile('payout', this); });
  $('ordersFile').addEventListener('change', function () { onFile('orders', this); });
  $('loadSample').addEventListener('click', function () {
    $('payoutFile').value = ''; $('ordersFile').value = '';
    loadTable('payout', S.payoutCsv, S.payoutFileName);
    loadTable('orders', S.ordersCsv, S.ordersFileName);
    $('payoutInfo').textContent += ' (synthetic example data)';
    $('ordersInfo').textContent += ' (synthetic example data)';
  });
  $('runBtn').addEventListener('click', run);
  $('downloadBtn').addEventListener('click', download);
})();
