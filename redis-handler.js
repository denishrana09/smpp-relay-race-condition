const Redis = require('ioredis');

class MessageQueueHandler {
  constructor(config = {}) {
    if (!MessageQueueHandler.instance) {
      this.redis = new Redis({
        host: config.host || 'localhost',
        port: config.port || 6379,
        ...config
      });
      
      this.subscriber = new Redis({
        host: config.host || 'localhost',
        port: config.port || 6379,
        ...config
      });
      
      this.MESSAGE_EXPIRY = 24 * 60 * 60;
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
          // If not complete, subscribe to completion channel
          const channel = `complete:${vendorMsgId}`;
          
          const messageHandler = (channel, message) => {
            const entry = JSON.parse(message);
            this.subscriber.unsubscribe(channel);
            resolve(entry);
          };

          this.subscriber.subscribe(channel, (err) => {
            if (err) console.error('Subscribe error:', err);
          });
          
          this.subscriber.on('message', messageHandler);
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
      // Publish the complete entry to Redis channel
      await this.redis.publish(
        `complete:${vendorMsgId}`, 
        JSON.stringify(entry)
      );
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
