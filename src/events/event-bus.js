import { logger } from '../utils/logger.js';

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event - Event name.
   * @param {Function} callback - Callback function.
   * @returns {Function} Unsubscribe function.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    // Return an unsubscribe function for convenience
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event - Event name.
   * @param {Function} callback - Callback function to remove.
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).delete(callback);
  }

  /**
   * Publish an event with data.
   * @param {string} event - Event name.
   * @param {*} data - Data payload.
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return;
    
    // Use a copy to prevent issues if a listener unsubscribes during emission
    const callbacks = Array.from(this.listeners.get(event));
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        logger.error('EventBus', `Error in listener for event "${event}": ${err.message}`);
      }
    });
  }

  /**
   * Clear all listeners. Handy for testing or hot reloading.
   */
  clear() {
    this.listeners.clear();
  }
}

// Singleton event bus for application-wide decoupling
export const eventBus = new EventBus();

// Initialize the logger's reference to this event bus to avoid circular dependency
logger.setEventBus(eventBus);
