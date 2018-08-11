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
