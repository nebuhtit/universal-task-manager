import { Field, Select } from '../../../../components/ui/primitives';

const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
type Mode = 'date' | 'weekday' | 'full' | 'partial' | 'custom';
type Choice = { mode: Mode; ordinal: number; day: string; date: number };

export function monthlyRule(choice: Choice): Record<string, string | undefined> {
  const patch: Record<string, string | undefined> = { BYDAY: undefined, BYMONTHDAY: undefined, BYSETPOS: undefined };
  if (choice.mode === 'date') patch.BYMONTHDAY = String(choice.date);
  if (choice.mode === 'weekday') patch.BYDAY = `${choice.ordinal}${choice.day}`;
  if (choice.mode === 'full' || choice.mode === 'partial') {
    const weekday = days.indexOf(choice.day);
    const start = choice.mode === 'full' ? 1 + weekday + (choice.ordinal - 1) * 7 : 2 + weekday + (choice.ordinal - 2) * 7;
    patch.BYDAY = choice.day;
    patch.BYMONTHDAY = Array.from({ length: 7 }, (_, index) => start + index).filter(date => date >= 1 && date <= 31).join(',');
  }
  return patch;
}

function readChoice(rule: string, defaultDate: number): Choice {
  const parts = new Map(rule.replace(/^RRULE:/i, '').toUpperCase().split(';').map(part => part.split('=')) as [string, string][]);
  const base: Choice = { mode: 'date', ordinal: 1, day: 'MO', date: defaultDate };
  const byday = parts.get('BYDAY');
  const dates = parts.get('BYMONTHDAY');
  if (parts.has('BYSETPOS')) return { ...base, mode: 'custom' };
  if (!byday && (!dates || /^(?:[1-9]|[12]\d|3[01])$/.test(dates))) return { ...base, date: dates ? Number(dates) : defaultDate };
  const ordinal = /^([1-5]|-1)(MO|TU|WE|TH|FR|SA|SU)$/.exec(byday ?? '');
  if (ordinal && !dates) return { ...base, mode: 'weekday', ordinal: Number(ordinal[1]), day: ordinal[2]! };
  if (byday && days.includes(byday) && dates) {
    for (const mode of ['full', 'partial'] as const) for (let week = 1; week <= (mode === 'full' ? 3 : 4); week++) {
      const choice = { ...base, mode, ordinal: week, day: byday };
      if (monthlyRule(choice).BYMONTHDAY === dates) return choice;
    }
  }
  return { ...base, mode: 'custom' };
}

export function MonthlyRecurrence({ rule, defaultDate, ru, update }: { rule: string; defaultDate: number; ru: boolean; update: (patch: Record<string, string | undefined>) => void }) {
  const choice = readChoice(rule, defaultDate);
  const change = (patch: Partial<Choice>) => update(monthlyRule({ ...choice, ...patch }));
  const labels = ru ? ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'] : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return <>
    <Field label={ru ? 'Когда в месяце' : 'When in the month'}><Select value={choice.mode} onChange={event => change({ mode: event.target.value as Mode, ordinal: 1 })}>
      <option value="date">{ru ? 'Число месяца' : 'Day of month'}</option>
      <option value="weekday">{ru ? 'По счёту день недели' : 'Nth weekday'}</option>
      <option value="full">{ru ? 'День полной недели' : 'Day of a full week'}</option>
      <option value="partial">{ru ? 'День календарной недели (включая неполную)' : 'Day of a calendar week (including partial)'}</option>
      {choice.mode === 'custom' && <option value="custom">{ru ? 'Другое правило — см. Repeat rule' : 'Custom rule — see Repeat rule'}</option>}
    </Select></Field>
    {choice.mode === 'date' && <Field label={ru ? 'Число' : 'Date'}><Select value={choice.date} onChange={event => change({ date: Number(event.target.value) })}>{Array.from({ length: 31 }, (_, index) => index + 1).map(date => <option key={date} value={date}>{date}</option>)}</Select></Field>}
    {['weekday', 'full', 'partial'].includes(choice.mode) && <div className="form-grid two">
      <Field label={ru ? 'По счёту' : 'Position'}><Select value={choice.ordinal} onChange={event => change({ ordinal: Number(event.target.value) })}>{Array.from({ length: choice.mode === 'weekday' ? 5 : choice.mode === 'full' ? 3 : 4 }, (_, index) => index + 1).map(number => <option key={number} value={number}>{number}</option>)}{choice.mode === 'weekday' && <option value={-1}>{ru ? 'Последний' : 'Last'}</option>}</Select></Field>
      <Field label={ru ? 'День недели' : 'Weekday'}><Select value={choice.day} onChange={event => change({ day: event.target.value })}>{days.map((day, index) => <option key={day} value={day}>{labels[index]}</option>)}</Select></Field>
    </div>}
    <p className="field-hint">{ru ? 'Недели считаются с понедельника. «По счёту день недели»: второй вторник — второе появление вторника в месяце. «Полная неделя»: первая начинается с первого понедельника месяца. «Включая неполную»: неделя, содержащая 1-е число, считается первой; если выбранного дня в месяце в этой неделе нет, цикл пропускается.' : 'Weeks start on Monday. Nth weekday: the second Tuesday is the second Tuesday occurring in the month. Full week: the first starts on the first Monday of the month. Including partial: the week containing the 1st counts as week one; if its selected weekday falls outside the month, that cycle is skipped.'}</p>
    <p className="field-hint">{ru ? 'Например, если 1-е число — вторник: первый вторник месяца будет 1-го, вторник первой полной недели — 8-го. Понедельника первой неполной недели в этом месяце нет, поэтому такой цикл пропускается. Даты за пределами месяца (например, 31-е в феврале) пропускаются; на последний день месяца они не переносятся. Время берётся из даты цикла.' : 'For example, if the 1st is Tuesday: the first Tuesday is the 1st, and Tuesday of the first full week is the 8th. Monday of the first partial week is outside this month, so that cycle is skipped. Dates outside the month (such as February 31) are skipped, not moved to its last day. The time follows the cycle date.'}</p>
  </>;
}
