/**
 * Structured JSON Logger
 *
 * Outputs logs as JSON to stderr for production use.
 * Levels: debug(0), info(1), warn(2), error(3)
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = process.env.LOG_LEVEL ? LOG_LEVELS[process.env.LOG_LEVEL] ?? 1 : 1;

function formatMessage(level, msg, context = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...context,
    pid: process.pid
  });
}

function shouldLog(level) {
  return LOG_LEVELS[level] >= currentLevel;
}

export const logger = {
  debug(msg, context = {}) {
    if (shouldLog('debug')) {
      console.error(formatMessage('debug', msg, context));
    }
  },
  info(msg, context = {}) {
    if (shouldLog('info')) {
      console.error(formatMessage('info', msg, context));
    }
  },
  warn(msg, context = {}) {
    if (shouldLog('warn')) {
      console.error(formatMessage('warn', msg, context));
    }
  },
  error(msg, context = {}) {
    if (shouldLog('error')) {
      console.error(formatMessage('error', msg, context));
    }
  },

  // Child logger with persistent context
  child(context) {
    return {
      debug: (msg, ctx = {}) => logger.debug(msg, { ...context, ...ctx }),
      info: (msg, ctx = {}) => logger.info(msg, { ...context, ...ctx }),
      warn: (msg, ctx = {}) => logger.warn(msg, { ...context, ...ctx }),
      error: (msg, ctx = {}) => logger.error(msg, { ...context, ...ctx }),
      child: (extra) => logger.child({ ...context, ...extra })
    };
  }
};

export default logger;
