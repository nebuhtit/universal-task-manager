let requestedProject: string | undefined;
export function requestProjectNavigation(project: string): void {
  requestedProject = project;
  window.dispatchEvent(new Event('utm:open-project'));
}
export function consumeProjectNavigation(): string | undefined {
  const project = requestedProject; requestedProject = undefined; return project;
}
