'use babel';

const Controller = require('./controller.js');
const MessageTypes = require('./message-types.js');
const TEXT_BUFFER_PROXY_INSERT = MessageTypes.TEXT_BUFFER_PROXY_INSERT;
const TEXT_BUFFER_PROXY_DELETE = MessageTypes.TEXT_BUFFER_PROXY_DELETE;

////////////////////////// ERROR HANDLING AND LOGGING //////////////////////////
function logError(message) {
  console.error('TEXT BUFFER PROXY: ' + message);
}

function log(message) {
  console.log('TEXT BUFFER PROXY: ' + message);
}
////////////////////////////////////////////////////////////////////////////////

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
    // List of observers of TextBufferProxy
    this.observers = [];
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
   * Client-agnostic Observable interface
   */
  registerObserver(observer) {
    this.observers.push(observer);
  }

  /**
   * Setup handlers that will update text buffer based on remote events, and
   * tell controller to setup connection to signal;ing server.
   */
  async fireUp() {
    // Setup handlers that forward events to the controller
    this._setupTextBufferHandlers();
  }

  _setupTextBufferHandlers() {
    this.textBuffer.onDidChange(this._handleTextBufferChange.bind(this));
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
    for (const observer of this.observers) {
      observer.notify(msg);
    }
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
