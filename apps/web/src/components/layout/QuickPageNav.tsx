import { IconButton } from '../ui/primitives';
import { LineIcon } from '../ui/icons';
import './quick-page-nav.css';

export function QuickPageNav({ page, language, onPage }: { page: string; language: string; onPage: (page: 'home' | 'calendar') => void }) {
  const ru = language === 'ru';
  return <nav className="quick-page-nav" aria-label={ru ? 'Быстрое переключение' : 'Quick navigation'}>
    <IconButton variant="ghost" aria-label={ru ? 'Главная' : 'Home'} aria-current={page === 'home' ? 'page' : undefined} onClick={() => onPage('home')}><LineIcon name="home" /></IconButton>
    <IconButton variant="ghost" aria-label={ru ? 'Календарь' : 'Calendar'} aria-current={page === 'calendar' ? 'page' : undefined} onClick={() => onPage('calendar')}><LineIcon name="calendar" /></IconButton>
  </nav>;
}
