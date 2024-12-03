const Redis = require('ioredis');
const EventEmitter = require('events');

class MessageQueueHandler {
  constructor(config = {}) {
    if (!MessageQueueHandler.instance) {
      this.redis = new Redis({
        host: config.host || 'localhost',
        port: config.port || 6379,
        ...config
      });
      
      this.MESSAGE_EXPIRY = 24 * 60 * 60;
      this.eventEmitter = new EventEmitter();
      MessageQueueHandler.instance = this;
    }

    return MessageQueueHandler.instance;
  }

  // Subscribe to completion of a message
  waitForCompletion(vendorMsgId) {
    return new Promise((resolve) => {
      // First check if data is already complete
      this.getQueueEntry(vendorMsgId).then((entry) => {
        if (entry && entry.serverMsgId && entry.deliveryReceipt) {
          resolve(entry);
        } else {
          // If not complete, wait for completion event
          this.eventEmitter.once(`complete:${vendorMsgId}`, resolve);
        }
      });
    });
  }

  async createOrUpdateEntry(vendorMsgId, data) {
    const key = `msg:${vendorMsgId}`;
    const dataWithTimestamp = {
      ...data,
      timestamp: Date.now().toString(),
    };

    const multi = this.redis.multi();

    // Add individual HSET commands for each field
    Object.entries(dataWithTimestamp).forEach(([field, value]) => {
      multi.hset(key, field, value);
    });

    multi.expire(key, this.MESSAGE_EXPIRY);
    multi.hgetall(key);

    const result = await multi.exec();
    const entry = result[result.length - 1][1]; // Get the final state after update

    if (entry.serverMsgId && entry.deliveryReceipt) {
      this.eventEmitter.emit(`complete:${vendorMsgId}`, entry);
    }

    return entry;
  }

  async getQueueEntry(vendorMsgId) {
    const entry = await this.redis.hgetall(`msg:${vendorMsgId}`);
    return Object.keys(entry).length === 0 ? null : entry;
  }

  async deleteQueueEntry(vendorMsgId) {
    await this.redis.del(`msg:${vendorMsgId}`);
  }
}

// Export a singleton instance
module.exports = new MessageQueueHandler();
