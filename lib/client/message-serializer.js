const config = require('./../config.js')
const log = require('loglevel').getLogger('message-serializer');
log.setLevel(config.logLevels.models);

module.exports = {
  serializeMessage: (msg) => {
    const logObj = {message: msg};
    log.debug('Serializing message: ', logObj);

    return JSON.stringify(msg);
  },

  deserializeMessage: (msg) => {
    const logObj = {message: msg};
    log.debug('Deserializing message: ', logObj);

    return JSON.parse(msg)
  }
};
