'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;

class ParticipantsComponent {
  constructor(props) {
    this.props;
    etch.initialize(this);
  }

  update(props) {
    Object.assign(this.props, props);
    return etch.update(this);
  }

  render() {
    return <div>No Peers</div>
  }
}

module.exports = ParticipantsComponent;
