/*
 * Payout Bridge - SYNTHETIC EXAMPLE DATA ONLY. Not from any real store.
 * Same content as sample-payout-transactions.csv and sample-orders.csv
 * (embedded here so "Load sample data" works when the page is opened from disk).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.PayoutBridgeSamples = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var payoutCsv = [
    'Transaction Date,Type,Order,Card Brand,Card Source,Payout Status,Payout Date,Payout ID,Available On,Amount,Fee,Net,Currency',
    '2026-01-03 10:12:40 -0500,charge,#1001,visa,online,paid,2026-01-05,SYNTHETIC-P1,2026-01-05,120.00,3.78,116.22,USD',
    '2026-01-03 14:30:11 -0500,charge,#1002,mastercard,online,paid,2026-01-05,SYNTHETIC-P1,2026-01-05,85.50,2.78,82.72,USD',
    '2026-01-04 09:05:52 -0500,charge,#1003,visa,online,paid,2026-01-05,SYNTHETIC-P1,2026-01-05,"1,250.00",36.55,"1,213.45",USD',
    '2026-01-04 16:20:03 -0500,refund,#1001,visa,online,paid,2026-01-05,SYNTHETIC-P1,2026-01-05,-40.00,0.00,-40.00,USD',
    '2026-01-05 11:00:00 -0500,charge,#1004,visa,online,paid,2026-01-07,SYNTHETIC-P2,2026-01-07,64.00,2.16,61.84,USD',
    '2026-01-05 12:45:19 -0500,charge,#1005,amex,online,paid,2026-01-07,SYNTHETIC-P2,2026-01-07,30.00,1.17,28.83,USD',
    '2026-01-06 08:00:00 -0500,adjustment,,,,paid,2026-01-07,SYNTHETIC-P2,2026-01-07,-15.00,0.00,-15.00,USD',
    '2026-01-06 13:10:44 -0500,charge,#1099,visa,online,paid,2026-01-07,SYNTHETIC-P2,2026-01-07,22.00,0.94,21.06,USD'
  ].join('\n') + '\n';

  var ordersCsv = [
    'Name,Email,Financial Status,Paid at,Fulfillment Status,Currency,Subtotal,Shipping,Taxes,Total,Discount Code,Refunded Amount,Lineitem quantity,Lineitem name,Lineitem price,Notes,Billing Name',
    '#1001,customer-a@example.com,partially_refunded,2026-01-03 10:12:00 -0500,fulfilled,USD,110.00,10.00,0.00,120.00,,40.00,1,Synthetic Product A,110.00,,Synthetic Customer A',
    '#1002,customer-b@example.com,paid,2026-01-03 14:30:00 -0500,fulfilled,USD,75.50,10.00,0.00,85.50,,0.00,1,Synthetic Product B,45.50,"Gift wrap, please',
    'leave at the door",Synthetic Customer B',
    '#1002,customer-b@example.com,,,,,,,,,,,1,Synthetic Strap,30.00,,',
    '#1003,customer-c@example.com,paid,2026-01-04 09:05:00 -0500,fulfilled,USD,"1,240.00",10.00,0.00,"1,250.00",SAMPLE10,0.00,10,Synthetic Product A (case of 10),124.00,,Synthetic Business C',
    '#1004,customer-d@example.com,paid,2026-01-05 10:59:00 -0500,fulfilled,USD,59.00,10.00,0.00,69.00,,0.00,1,Synthetic Product C,59.00,,Synthetic Customer D',
    '#1005,customer-e@example.com,paid,2026-01-05 12:45:00 -0500,unfulfilled,USD,20.00,10.00,0.00,30.00,,0.00,1,Synthetic Product D,20.00,,Synthetic Customer E',
    '#1006,customer-f@example.com,paid,2026-01-08 09:30:00 -0500,unfulfilled,USD,38.00,10.00,0.00,48.00,,0.00,1,Synthetic Product E,38.00,,Synthetic Customer F',
    '#1007,customer-g@example.com,pending,,unfulfilled,USD,15.00,10.00,0.00,25.00,,0.00,1,Synthetic Product F,15.00,,Synthetic Customer G'
  ].join('\n') + '\n';

  return {
    label: 'Synthetic example data (not from any real store)',
    payoutCsv: payoutCsv,
    ordersCsv: ordersCsv,
    payoutFileName: 'sample-payout-transactions.csv',
    ordersFileName: 'sample-orders.csv'
  };
});
