import { Component, type ReactNode } from 'react';
import { Button } from '../ui/primitives';
import { recordDiagnostic } from '../../services/diagnostics';
import { renderFailureDetails } from '../../services/renderFailure';

/** Keep the unlocked session, save queue and navigation mounted if a page fails. */
export class PageErrorBoundary extends Component<{ page: string; language: string; children: ReactNode; onDiagnostics: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(reason: unknown) {
    recordDiagnostic({ kind: 'error', message: 'Page render failed', operation: 'Render page', outcome: 'failed', page: this.props.page, details: renderFailureDetails(reason) });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const ru = this.props.language === 'ru';
    return <section className="page-section" role="alert">
      <h2>{ru ? 'Не удалось открыть раздел' : 'Could not open this section'}</h2>
      <p>{ru ? 'Workspace остаётся открыт. Попробуйте ещё раз или выберите другой раздел в меню.' : 'Your workspace remains open. Try again or choose another section from the menu.'}</p>
      <div className="settings-actions">
        <Button onClick={() => this.setState({ failed: false })}>{ru ? 'Повторить' : 'Try again'}</Button>
        <Button variant="secondary" onClick={this.props.onDiagnostics}>{ru ? 'Скачать диагностику' : 'Download diagnostics'}</Button>
      </div>
    </section>;
  }
}
