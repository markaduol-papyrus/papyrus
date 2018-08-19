'use babel';

const { Emitter } = require('atom');

class MessageQueue {

  constructor() {
    this.queue = [];
    this.emitter = new Emitter();
  }

  onDidPublishMessage(callback) {
    return this.emitter.on('did-publish-message', callback);
  }

  publish(message) {
    this.queue.push(message);
    this.emitter.emit('did-publish-message', message);
  }

}
module.exports = MessageQueue;
