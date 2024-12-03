const messageQueue = require('./redis-handler');

// This will work because it's the same instance
messageQueue.eventEmitter.on('someEvent', () => {
  console.log('Event received in server-1');
});
