const { validateWeatherAlert, createWeatherAlertCooldown } = require('./weather-alert');

describe('validateWeatherAlert', () => {
  test('accepts warning and critical levels only at their matching thresholds', () => {
    expect(validateWeatherAlert(88, 'warning')).toBe(true);
    expect(validateWeatherAlert(89.9, 'warning')).toBe(true);
    expect(validateWeatherAlert(90, 'critical')).toBe(true);
    expect(validateWeatherAlert(89, 'critical')).toBe(false);
    expect(validateWeatherAlert(90, 'warning')).toBe(false);
  });

  test('rejects malformed and implausible temperatures or levels', () => {
    expect(validateWeatherAlert('90', 'critical')).toBe(false);
    expect(validateWeatherAlert(NaN, 'critical')).toBe(false);
    expect(validateWeatherAlert(151, 'critical')).toBe(false);
    expect(validateWeatherAlert(87.9, 'warning')).toBe(false);
    expect(validateWeatherAlert(90, 'other')).toBe(false);
  });
});

describe('createWeatherAlertCooldown', () => {
  test('limits each worker and alert level for 15 minutes', () => {
    const cooldown = createWeatherAlertCooldown(15 * 60 * 1000);
    expect(cooldown.claim(1, 'critical', 1000)).toBe(true);
    expect(cooldown.claim(1, 'critical', 1001)).toBe(false);
    expect(cooldown.claim(2, 'critical', 1001)).toBe(true);
    expect(cooldown.claim(1, 'warning', 1001)).toBe(true);
    expect(cooldown.claim(1, 'critical', 901000)).toBe(true);
  });

  test('releases a cooldown when delivery fails', () => {
    const cooldown = createWeatherAlertCooldown(15 * 60 * 1000);
    expect(cooldown.claim(1, 'warning', 1000)).toBe(true);
    cooldown.release(1, 'warning');
    expect(cooldown.claim(1, 'warning', 1001)).toBe(true);
  });
});
