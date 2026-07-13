import { LOG_LEVELS } from './constants.js';

class Logger {
  constructor() {
    this.eventBus = null;
  }

  /**
   * Set the event bus reference to broadcast logs to UI.
   * @param {Object} eventBus 
   */
  setEventBus(eventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Log info level message.
   * @param {string} module - The source module name.
   * @param {string} message 
   */
  info(module, message) {
    this._log(LOG_LEVELS.INFO, module, message);
  }

  /**
   * Log warn level message.
   * @param {string} module - The source module name.
   * @param {string} message 
   */
  warn(module, message) {
    this._log(LOG_LEVELS.WARN, module, message);
  }

  /**
   * Log error level message.
   * @param {string} module - The source module name.
   * @param {string|Error} message 
   */
  error(module, message) {
    const msg = message instanceof Error ? message.message : message;
    this._log(LOG_LEVELS.ERROR, module, msg);
    if (message instanceof Error && message.stack) {
      console.error(message.stack);
    }
  }

  /**
   * Log debug level message.
   * @param {string} module - The source module name.
   * @param {string} message 
   */
  debug(module, message) {
    this._log(LOG_LEVELS.DEBUG, module, message);
  }

  _log(level, module, message) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] [${level}] [${module}]: ${message}`;

    // Output to developer console
    switch (level) {
      case LOG_LEVELS.ERROR:
        console.error(formattedMessage);
        break;
      case LOG_LEVELS.WARN:
        console.warn(formattedMessage);
        break;
      default:
        console.log(formattedMessage);
    }

    // Broadcast log event if eventBus is registered
    if (this.eventBus) {
      try {
        this.eventBus.emit('log', {
          timestamp,
          level,
          module,
          message
        });
      } catch (e) {
        console.warn('Failed to emit log via eventBus:', e);
      }
    }
  }
}

export const logger = new Logger();
