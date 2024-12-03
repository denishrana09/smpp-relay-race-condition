const messageQueue = require('./redis-handler');

// This will trigger the listener in server-1.js
messageQueue.eventEmitter.emit('someEvent'); 