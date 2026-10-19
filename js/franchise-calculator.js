/* Pure calculation logic for the franchise 300 vs. 2'500 calculator.
 * No DOM, no fetch, no state — safe to unit-test and safe to run in the browser.
 * Formula (adults, ordinary treatment only):
 *   annualCost = 12 * monthlyPremium + min(costs, franchise) + min(0.10 * max(costs - franchise, 0), 700)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FranchiseCalc = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FRANCHISE_LOW = 300;
  var FRANCHISE_HIGH = 2500;
  var COINSURANCE_RATE = 0.10;
  var COINSURANCE_CAP = 700;

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Out-of-pocket cost-sharing for a given franchise (excludes the premium itself).
  function costShare(costs, franchise) {
    var c = Math.max(0, costs);
    var f = Math.max(0, franchise);
    return round2(Math.min(c, f) + Math.min(COINSURANCE_RATE * Math.max(c - f, 0), COINSURANCE_CAP));
  }

  // Full annual cost: 12 monthly premiums plus cost-sharing on top.
  function annualCost(monthlyPremium, franchise, costs) {
    return round2(12 * monthlyPremium + costShare(costs, franchise));
  }

  // The cost-sharing ceiling for a franchise as treatment costs grow without bound
  // (premiums and the hospital daily contribution are not included).
  function maxCostShare(franchise) {
    return Math.max(0, franchise) + COINSURANCE_CAP;
  }

  function diffAt(premiumLow, premiumHigh, costs) {
    return annualCost(premiumLow, FRANCHISE_LOW, costs) - annualCost(premiumHigh, FRANCHISE_HIGH, costs);
  }

  // Finds the treatment-cost level at which both options cost exactly the same.
  // diffAt(costs) = cost(300) - cost(2500) is piecewise-linear in `costs` and
  // monotonically non-increasing (a higher franchise can only ever cost you more
  // or the same out of pocket for the same treatment costs), so there is at most
  // one crossing point. We walk the formula's own breakpoints and interpolate.
  function findBreakeven(premiumLow, premiumHigh) {
    var capLow = FRANCHISE_LOW + COINSURANCE_CAP / COINSURANCE_RATE;
    var capHigh = FRANCHISE_HIGH + COINSURANCE_CAP / COINSURANCE_RATE;
    var raw = [0, FRANCHISE_LOW, FRANCHISE_HIGH, capLow, capHigh];
    raw.sort(function (a, b) { return a - b; });
    var breakpoints = [];
    raw.forEach(function (p) {
      if (breakpoints.indexOf(p) === -1) breakpoints.push(p);
    });

    var d0 = diffAt(premiumLow, premiumHigh, 0);
    if (d0 <= 0) {
      // Franchise 300 is already cheaper (or tied) with no treatment costs at all,
      // and the gap only widens in its favor as costs rise — it wins everywhere.
      return { exists: true, costs: 0, alwaysCheaper: 'low' };
    }

    var lastPoint = breakpoints[breakpoints.length - 1];
    var dLast = diffAt(premiumLow, premiumHigh, lastPoint);
    if (dLast > 0) {
      return { exists: false, alwaysCheaper: 'high' };
    }

    for (var i = 0; i < breakpoints.length - 1; i++) {
      var a = breakpoints[i];
      var b = breakpoints[i + 1];
      var da = diffAt(premiumLow, premiumHigh, a);
      var db = diffAt(premiumLow, premiumHigh, b);
      if (da === 0) {
        return { exists: true, costs: a, alwaysCheaper: null };
      }
      if (da > 0 && db <= 0) {
        var t = da / (da - db);
        return { exists: true, costs: Math.round(a + t * (b - a)), alwaysCheaper: null };
      }
    }

    return { exists: false, alwaysCheaper: 'high' };
  }

  // Full comparison for a given pair of premiums and an expected yearly cost.
  function compare(premiumLow, premiumHigh, costs) {
    var cost300 = annualCost(premiumLow, FRANCHISE_LOW, costs);
    var cost2500 = annualCost(premiumHigh, FRANCHISE_HIGH, costs);
    var rawDiff = round2(cost300 - cost2500);
    var cheaper = rawDiff < 0 ? 'low' : (rawDiff > 0 ? 'high' : 'tie');
    return {
      cost300: cost300,
      cost2500: cost2500,
      diff: Math.abs(rawDiff),
      cheaper: cheaper,
      breakeven: findBreakeven(premiumLow, premiumHigh),
      maxCostShare300: maxCostShare(FRANCHISE_LOW),
      maxCostShare2500: maxCostShare(FRANCHISE_HIGH)
    };
  }

  return {
    FRANCHISE_LOW: FRANCHISE_LOW,
    FRANCHISE_HIGH: FRANCHISE_HIGH,
    COINSURANCE_RATE: COINSURANCE_RATE,
    COINSURANCE_CAP: COINSURANCE_CAP,
    costShare: costShare,
    annualCost: annualCost,
    maxCostShare: maxCostShare,
    findBreakeven: findBreakeven,
    compare: compare
  };
}));
