/**
 * HTML-based UI component for joining portal.
 */
const etch = require('etch');
const $ = etch.dom;

module.exports =
class JoinPortalComponent {
  constructor(props) {
    this.props = props;

    // Associate this component object with a DOM element. Note that for this to
    // work, this class must have a `render` method that returns a virtual DOM
    // tree constructed with `etch.dom` (Babel can be configured to compile JSX
    // expressions to `etch.dom` calls). `etch.initialize(component)` calls
    // `render` and uses the result to build a DOM element, which it assigns to
    // the `.element` property on this component. Any references are also
    // assigned to a `.refs` object on this component.
    etch.initialize(this);

    this.disposables = this.props.commandRegistry.add(this.element, {
      'core:confirm': this.joinPortal.bind(this);
      'core:cancel': this.hidePrompt.bind(this);
    });
  }

  destroy() {
    this.disposables.dispose();
    return etch.destroy(this);
  }

  update(props) {
    // Change properties then re-render component. The `props` argument can be
    // used to signal external state changes, which can then be used to
    // influence how this component is re-rendered.
    Object.assign(this.props, props);
    return etch.update(this);
  }

  render() {
    // Declarative programming: we simply specify what the DOM element for this
    // component should look like, and then `etch.dom` will handle all the low-
    // level HTML DOM API manipulations for us.
    const {}
  }
}
