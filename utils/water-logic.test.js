const {
  calculateSets,
  calculateOfficialHours,
  applyLunchRule,
  calculateLastWatered,
  calculateNextWater,
} = require('./water-logic');

describe('calculateSets', () => {
  test('6 hours rounds up to 1 set', () => {
    expect(calculateSets(6)).toBe(1);
  });
  test('24.87 hours (real case from Block 6) gives 2 sets', () => {
    expect(calculateSets(24.87)).toBe(2);
  });
  test('13.28 hours (real case from Block 9C) gives 1 set', () => {
    expect(calculateSets(13.28)).toBe(1);
  });
  test('5.9 hours rounds down to 0, but exactly 6.0 rounds up to 1', () => {
    expect(calculateSets(5.9)).toBe(0);
    expect(calculateSets(6.0)).toBe(1);
  });
});

describe('calculateOfficialHours', () => {
  test('24.87 real hours gives 24 official hours', () => {
    expect(calculateOfficialHours(24.87)).toBe(24);
  });
  test('86.35 real hours gives 84 official hours (real case from Block 8)', () => {
    expect(calculateOfficialHours(86.35)).toBe(84);
  });
});

describe('applyLunchRule', () => {
  test('7.5 hours becomes 7.0 after the lunch deduction', () => {
    expect(applyLunchRule(7.5)).toBe(7);
  });
  test('1.25 hours stays 1.25 (under the 5-hour threshold)', () => {
    expect(applyLunchRule(1.25)).toBe(1.25);
  });
  test('exactly 5.0 hours does NOT get the deduction (strictly greater than 5)', () => {
    expect(applyLunchRule(5.0)).toBe(5.0);
  });
});

describe('calculateLastWatered', () => {
  test('uses the START time, not the finish time (the real bug this fixed)', () => {
    const startTime = new Date('2026-09-08T14:00:00Z');
    expect(calculateLastWatered(startTime)).toBe('2026-09-08');
  });
});

describe('calculateNextWater', () => {
  test('adds cycle_days correctly', () => {
    expect(calculateNextWater('2026-09-08', 7)).toBe('2026-09-15');
  });
  test('handles month boundaries correctly', () => {
    expect(calculateNextWater('2026-08-28', 6)).toBe('2026-09-03');
  });
});
