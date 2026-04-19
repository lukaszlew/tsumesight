import { Component } from 'preact'
import { kvRemove } from './db.js'

// Catches render-time errors thrown from the Quiz subtree. Clears the
// active-sgf kv so a reload doesn't immediately re-trigger the error.
// Renders a small "Back to Library" fallback; onReset returns the user
// to the library view.
export class ErrorBoundary extends Component {
  state = { error: null }

  componentDidCatch(error) {
    kvRemove('activeSgf')
    this.setState({ error: error.message })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div class="quiz">
        <div class="summary-overlay">
          <h2>Something went wrong</h2>
          <p>{this.state.error}</p>
          <button class="back-btn" onClick={() => {
            this.setState({ error: null })
            this.props.onReset()
          }}>
            Back to Library
          </button>
        </div>
      </div>
    )
  }
}
