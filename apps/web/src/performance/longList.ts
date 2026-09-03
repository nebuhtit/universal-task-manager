export const LONG_LIST_VIRTUALIZATION_THRESHOLD = 250;

export function longListClass(baseClass: string, itemCount: number): string {
  return `${baseClass}${itemCount >= LONG_LIST_VIRTUALIZATION_THRESHOLD ? ' long-list-virtualized' : ''}`;
}

