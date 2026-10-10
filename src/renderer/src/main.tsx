import { Component, Fragment, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

document.documentElement.dataset.platform = window.api.platform

type BoundaryState = { error: string; tick: number }

class Boundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: '', tick: 0 }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : 'Something went wrong' }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="welcome">
          <div className="card">
            <h1>MD Duck</h1>
            <p>{this.state.error}</p>
            <button className="btn primary" onClick={() => this.setState({ error: '', tick: this.state.tick + 1 })}>
              Back / 返回
            </button>
          </div>
        </div>
      )
    }
    return <Fragment key={this.state.tick}>{this.props.children}</Fragment>
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>
)
