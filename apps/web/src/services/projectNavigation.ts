let requestedProject: string | undefined;
let requestedArea: string | undefined;
export function requestProjectNavigation(project: string): void {
  requestedArea = undefined;
  requestedProject = project;
  window.dispatchEvent(new Event('utm:open-project'));
}
export function requestAreaNavigation(area: string): void {
  requestedProject = undefined; requestedArea = area;
  window.dispatchEvent(new Event('utm:open-project'));
}
export function consumeAreaNavigation(): string | undefined {
  const area = requestedArea; requestedArea = undefined; return area;
}
export function consumeProjectNavigation(): string | undefined {
  const project = requestedProject; requestedProject = undefined; return project;
}
