function validateWeatherAlert(temp, level){
  if(typeof temp !== 'number' || !Number.isFinite(temp) || temp < -100 || temp > 150) return false;
  if(level === 'critical') return temp >= 90;
  if(level === 'warning') return temp >= 88 && temp < 90;
  return false;
}

function createWeatherAlertCooldown(durationMs){
  const cooldowns = new Map();
  return {
    claim(workerId, level, now = Date.now()){
      for(const [key, expiresAt] of cooldowns){
        if(expiresAt <= now) cooldowns.delete(key);
      }
      const key = `${workerId}:${level}`;
      if(cooldowns.has(key)) return false;
      cooldowns.set(key, now + durationMs);
      return true;
    },
    release(workerId, level){
      cooldowns.delete(`${workerId}:${level}`);
    }
  };
}

module.exports = { validateWeatherAlert, createWeatherAlertCooldown };
