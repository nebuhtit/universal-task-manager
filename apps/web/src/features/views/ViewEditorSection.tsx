import type { ReactNode } from 'react';
import { Disclosure } from '../../components/ui/primitives';

export function ViewEditorSection({ sectionKey, title, children, className }: {
  sectionKey: string;
  title: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return <Disclosure uiKey={`view-editor:${sectionKey}`} summary={title} className={['view-editor-section', className].filter(Boolean).join(' ')}>
    {children}
  </Disclosure>;
}
