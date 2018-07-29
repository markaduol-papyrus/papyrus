'use babel';

import {Emitter, CompositeDisposable} from 'atom';
const MessageTypes = require('./message-types.js');
const TEXT_BUFFER_PROXY_INSERT = MessageTypes.TEXT_BUFFER_PROXY_INSERT;
const TEXT_BUFFER_PROXY_DELETE = MessageTypes.TEXT_BUFFER_PROXY_DELETE;

// Logging
const log = require('loglevel').getLogger('portal-binding-manager');
const config = require('./../../config.js')
log.setLevel(config.logLevels.models);

/** MISCELLANOUS HELPER FUNCTIONS */

/**
 * Convert an Atom `Range` object to a {lineIndex: ..., charIndex: ...} object
 */
function _convertRangeToPos(atomRangeObj) {
  const startPoint = atomRangeObj.start;
  const endPoint = atomRangeObj.end;
  const startPos = {lineIndex: startPoint.row, charIndex: startPoint.column};
  const endPos = {lineIndex: endPoint.row, charIndex: endPoint.column};
  return [startPos, endPos]
}

/** TEXT BUFFER PROXY */

class TextBufferProxy {
  constructor(textBuffer) {
    // Bind atom 'TextBuffer'
    this.textBuffer = textBuffer;
    // Assign unique ID which should be equal to text buffer's URI
    this.id = this.textBuffer.getUri();
    this.emitter = new Emitter();
    this.textBufferSubscriptions = new CompositeDisposable();
  }

  getId() {
    return this.id;
  }

  /**
   * Return the text buffer
   */
  getBuffer() {
    return this.textBuffer;
  }

  /**
   * Used by external modules to register callbacks to be executed upon emission
   * of some event
   */
  onDidEmitMessage(callback) {
    this.emitter.on('did-emit-message', callback);
  }

  /**
   * Setup handlers that will update text buffer based on remote events, and
   * tell controller to setup connection to signal;ing server.
   */
  initialise() {
    // Setup handlers that forward events to the controller
    this._setupTextBufferHandlers();
  }

  /**
   * Tear down the TextBufferProxy
   */
  destroy() {
    this.textBufferSubscriptions.dispose();
  }

  _setupTextBufferHandlers() {
    // Wrap in a CompositeDisposable for easy disposing of listener once we
    // want to unsubscribe to events from the text buffer.
    this.textBufferSubscriptions.add(
      this.textBuffer.onDidChange(this._handleTextBufferChange.bind(this))
    );
  }

  _handleTextBufferChange(event) {
    // Message to be broadcast to observers
    let msg;

    for (const {oldRange, newRange, oldText, newText} of event.changes) {
      if (oldText.length > 0) {
        // Delete text
        const [startPos, endPos] = _convertRangeToPos(oldRange);

        msg = {
          type: TEXT_BUFFER_PROXY_DELETE,
          textBufferProxyId: this.id,
          startPos: startPos,
          endPos: endPos,
        };
      }
      if (newText.length > 0) {
        // Insert text
        const [startPos, _] = _convertRangeToPos(newRange);

        msg = {
          type: TEXT_BUFFER_PROXY_INSERT,
          textBufferProxyId: this.id,
          newText: newText,
          startPos: startPos,
        };
      }
    }

    // Notify observers
    this.emitter.emit('did-emit-message', msg);
  }


  /**
   * @param {Point} point - The Atom 'Point' object used for insertion.
   * @param {String} text - The text to insert.
   */
  insertIntoTextBuffer(point, text) {
    this.textBuffer.insert(point, text);
  }

  /**
   * @param {Range} range - The Atom 'Range' object used to specify the
   * deletion range in the text buffer.
   */
  deleteFromTextBuffer(range) {
    this.textBuffer.delete(range);
  }
}

module.exports = TextBufferProxy;
