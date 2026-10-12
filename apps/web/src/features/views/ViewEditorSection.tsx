import type { ReactNode } from 'react';
import { Disclosure } from '../../components/ui/primitives';
import { FieldIconLabel } from '../items/FieldIcon';

const sectionIcons: Record<string, string> = {
  templates: 'isTemplate', color: 'custom', 'visual-setup': 'custom', scripts: 'scripts',
  'show-in-results': 'list', statistics: 'progress.count', 'creation-defaults': 'title',
  sorting: 'list', json: 'system.json', export: 'attachments', 'board-columns': 'state',
  'calendar-day-period': 'schedule.plannedDate', 'calendar-day-filter': 'custom', 'calendar-day-share': 'activeRange',
  'calendar-day-list-fields': 'list', 'calendar-day-timeline-fields': 'schedule.startAt', 'calendar-day-timeline': 'schedule.estimatedDuration',
};

export function ViewEditorSection({ sectionKey, title, children, className }: {
  sectionKey: string;
  title: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return <Disclosure uiKey={`view-editor:${sectionKey}`} persist={false} summary={<FieldIconLabel path={sectionIcons[sectionKey] ?? sectionIcons[sectionKey.split(':')[0]!] ?? 'system'} label={title} />} className={['view-editor-section', className].filter(Boolean).join(' ')}>
    {children}
  </Disclosure>;
}
