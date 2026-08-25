import type { ReactNode } from 'react';

export function SectionGuide({ title, children }: { title: string; children: ReactNode }) {
  return <details className="section-guide"><summary>{title}</summary><div>{children}</div></details>;
}
