/**
 * Utility functions for station-agent
 */

export function parseCronExpression(cronStr) {
  // Simple cron parser for basic patterns like "weekday 18:30"
  if (!cronStr) return null;

  const weekdayMatch = cronStr.match(/weekday\s+(\d{1,2}):(\d{2})/i);
  if (weekdayMatch) {
    return { type: 'weekday', hour: parseInt(weekdayMatch[1]), minute: parseInt(weekdayMatch[2]) };
  }

  const dailyMatch = cronStr.match(/daily\s+(\d{1,2}):(\d{2})/i);
  if (dailyMatch) {
    return { type: 'daily', hour: parseInt(dailyMatch[1]), minute: parseInt(dailyMatch[2]) };
  }

  const hourlyMatch = cronStr.match(/hourly/i);
  if (hourlyMatch) {
    return { type: 'hourly', hour: null, minute: null };
  }

  return null;
}

export function formatTimestamp(date) {
  return date.toISOString();
}

export function parseTimestamp(ts) {
  return new Date(ts);
}

export function debounce(fn, delayMs) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

export function throttle(fn, intervalMs) {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= intervalMs) {
      lastCall = now;
      fn(...args);
    }
  };
}