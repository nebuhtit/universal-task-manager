import type { WorkspaceLanguage } from '@utm/core';
import { Button } from '../../components/ui/primitives';
import { FieldIcon } from '../items/FieldIcon';
import { UserDataText } from '../../i18n-react';
import { requestProjectNavigation } from '../../services/projectNavigation';
import type { ProjectViewResult } from './projectResults';
import { formatCompactRemainingDuration } from './ViewMetricsSummary';
import './project-results.css';

export function ProjectResultLink({ project, language }: { project: ProjectViewResult; language: WorkspaceLanguage }) {
  const ru = language === 'ru';
  const duration = formatCompactRemainingDuration(project.remainingDurationMs, language) || (ru ? '0 мин' : '0 min');
  return <Button variant="ghost" className="project-result-link" onClick={() => requestProjectNavigation(project.name)} aria-label={`${ru ? 'Открыть проект' : 'Open project'} ${project.name}`}>
    <FieldIcon path="project" label={ru ? 'Проект' : 'Project'} />
    <span><strong><UserDataText>{project.name}</UserDataText></strong><span className="project-result-metrics">{project.completionPercent === null ? '—' : `${project.completionPercent}%`} · {duration} {ru ? 'осталось' : 'remaining'}</span><small>{ru ? 'Для текущего view' : 'For this view'}</small></span>
  </Button>;
}
