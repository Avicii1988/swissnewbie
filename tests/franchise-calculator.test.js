import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FranchiseCalc = require('../js/franchise-calculator.js');

test('zero treatment costs: only the premium counts', () => {
  assert.equal(FranchiseCalc.costShare(0, 300), 0);
  assert.equal(FranchiseCalc.costShare(0, 2500), 0);
  assert.equal(FranchiseCalc.annualCost(300, 300, 0), 12 * 300);
  assert.equal(FranchiseCalc.annualCost(250, 2500, 0), 12 * 250);
});

test('costs exactly equal to the franchise: coinsurance has not started yet', () => {
  assert.equal(FranchiseCalc.costShare(300, 300), 300);
  assert.equal(FranchiseCalc.costShare(2500, 2500), 2500);
});

test('costs above the 10% coinsurance cap: out-of-pocket flattens at franchise + 700', () => {
  // 700 / 10% = 7000 of costs above the franchise reaches the cap.
  assert.equal(FranchiseCalc.costShare(300 + 7000, 300), 300 + 700);
  assert.equal(FranchiseCalc.costShare(300 + 50000, 300), 300 + 700);
  assert.equal(FranchiseCalc.costShare(2500 + 7000, 2500), 2500 + 700);
  assert.equal(FranchiseCalc.maxCostShare(300), 1000);
  assert.equal(FranchiseCalc.maxCostShare(2500), 3200);
});

test('break-even: finds the exact treatment-cost crossing point', () => {
  // premium300=300, premium2500=250 -> annual premium gap = 600.
  // Within 300 < costs <= 2500: costShare(c,300) - costShare(c,2500) = 270 - 0.9c.
  // Solve 600 + 270 - 0.9c = 0 -> c = 966.666... -> rounded to 967.
  const be = FranchiseCalc.findBreakeven(300, 250);
  assert.equal(be.exists, true);
  assert.equal(be.costs, 967);

  const atBreakeven = FranchiseCalc.compare(300, 250, be.costs);
  // At the rounded break-even point the two options are within a franc of each other.
  assert.ok(atBreakeven.diff <= 1);
});

test('break-even: franchise 300 always wins when its premium is not actually higher', () => {
  const be = FranchiseCalc.findBreakeven(250, 250);
  assert.equal(be.exists, true);
  assert.equal(be.costs, 0);
  assert.equal(be.alwaysCheaper, 'low');
});

test('break-even: franchise 2500 always wins when the premium gap is bigger than the max cost-sharing gap', () => {
  // Max possible cost-sharing gap is maxCostShare(300) - ... no: the gap is bounded by
  // maxCostShare(2500) - maxCostShare(300) = 2200. A premium gap of 300/month = 3600/year
  // annually is far larger, so franchise 2500 wins at every cost level.
  const be = FranchiseCalc.findBreakeven(600, 300);
  assert.equal(be.exists, false);
  assert.equal(be.alwaysCheaper, 'high');
});

test('300 vs 2500 comparison: rounds cleanly for fractional (rappen) premiums', () => {
  const r = FranchiseCalc.compare(420.55, 349.95, 1200);
  // cost300 = 12*420.55 + costShare(1200,300) = 5046.60 + (300 + min(0.1*900,700)=90) = 5046.60+390 = 5436.60
  // cost2500 = 12*349.95 + costShare(1200,2500) = 4199.40 + 1200 = 5399.40
  assert.equal(r.cost300, 5436.6);
  assert.equal(r.cost2500, 5399.4);
  assert.equal(r.cheaper, 'high');
  assert.equal(Math.round(r.diff * 100) / 100, 37.2);
});

test('comparison reports which option is cheaper without softening the result', () => {
  const r = FranchiseCalc.compare(300, 350, 0);
  // At zero treatment costs the lower premium always wins outright.
  assert.equal(r.cheaper, 'low');
  assert.ok(r.cost300 < r.cost2500);
});
