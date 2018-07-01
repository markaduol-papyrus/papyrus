'use babel';

const Controller = require('./controller.js');

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
  }

  /**
   * Setup handlers that will update text buffer based on remote events, and
   * tell controller to setup connection to signal;ing server.
   */
  async fireUp() {
    // Create a controller
    log('Creating Controller from TextBufferProxy...');
    this.controller = new Controller(this);
    log('Firing up Controller...');
    await this.controller.fireUp();
    log('Successfully fired up Controller.');
    // Setup handlers that forward events to the controller
    this._setupTextBufferHandlers();
  }

  _setupTextBufferHandlers() {
    this.textBuffer.onDidChange(this._handleTextBufferChange.bind(this));
  }

  _handleTextBufferChange(event) {
    for (const {oldRange, newRange, oldText, newText} of event.changes) {
      if (oldText.length > 0) {
        // Delete text
        const [startPos, endPos] = _convertRangeToPos(oldRange);
        this.controller.localDeleteAndBroadcast(startPos, endPos);
      }
      if (newText.length > 0) {
        // Insert text
        const [startPos, _] = _convertRangeToPos(newRange);
        this.controller.localInsertAndBroadcast(newText, startPos);
      }
    }
  }

  insertIntoTextBuffer(point, text) {
    this.textBuffer.insert(point, text);
  }

  deleteFromTextBuffer(range) {
    this.textBuffer.delete(range);
  }
}

module.exports = TextBufferProxy;
