'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const {TextEditor, CompositeDisposable} = require('atom');

class JoinPortalComponent {
  constructor(props) {
    this.props = props;
    this.subscriptions = new CompositeDisposable();
  }

  destroy() {
    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  update(props) {
    Object.assign(this.props, props);
    return etch.update(this);
  }

  render() {
    return <div>Hello World!</div>
  }

}

module.exports = JoinPortalComponent;
