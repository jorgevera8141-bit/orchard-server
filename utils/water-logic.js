// utils/water-logic.js
// Pure, testable business logic extracted from server.js — no database
// calls, no side effects. Each function here has a matching test in
// water-logic.test.js.

function calculateSets(realHours) {
  return Math.round(realHours / 12);
}

function calculateOfficialHours(realHours) {
  return calculateSets(realHours) * 12;
}

function applyLunchRule(rawHours) {
  // Confirmed rule (Sep 2026): applies per single continuous shift only,
  // never to a day's combined total. If a shift runs over 5 hours,
  // subtract the 0.5 hr lunch break.
  if (rawHours > 5) {
    return rawHours - 0.5;
  }
  return rawHours;
}

function toPacificDate(utcDate) {
  const pacific = new Date(utcDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return pacific.toLocaleDateString('en-CA');
}

function calculateLastWatered(sessionStartTime) {
  // CRITICAL rule, confirmed Sep 6 2026: always based on the session's
  // START time, never finish time, for every water source, no exceptions.
  return toPacificDate(sessionStartTime);
}

function calculateNextWater(lastWateredDateStr, cycleDays) {
  const d = new Date(lastWateredDateStr + 'T00:00:00');
  d.setDate(d.getDate() + cycleDays);
  return d.toLocaleDateString('en-CA');
}

module.exports = {
  calculateSets,
  calculateOfficialHours,
  applyLunchRule,
  calculateLastWatered,
  calculateNextWater,
  toPacificDate,
};
