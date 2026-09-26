export const quickCommandAliases = {
  timer: ['т', 'timer'],
  stopwatch: ['с', 'stopwatch'],
  alarm: ['нн', 'alarm', 'rr'],
};
export function quickSessionCommand(input: string): 'timer' | 'stopwatch' | undefined {
  const value = input.trim().toLocaleLowerCase();
  if (quickCommandAliases.timer.includes(value)) return 'timer';
  if (quickCommandAliases.stopwatch.includes(value)) return 'stopwatch';
  return undefined;
}
export const commandGuide = [
  { ru: 'Дата и время', en: 'Date and time', aliases: ['сегодня', 'завтра', 'пн…вс', 'today', 'tomorrow', 'mon…sun', 'dd.mm.yyyy', 'h:mm'], ruExample: 'Встреча завтра 15:00', enExample: 'Meeting tomorrow 15:00' },
  { ru: 'Начало и конец', en: 'Event opens and ends', aliases: ['начало', 'start', 'event opens', 'конец', 'end', 'event ends'], ruExample: 'Встреча начало завтра 15:00 конец завтра 16:00', enExample: 'Meeting start tomorrow 15:00 end tomorrow 16:00' },
  { ru: 'Длительность', en: 'Duration', aliases: ['дл', 'длительность', 'dr', 'duration'], ruExample: 'Задача дл 45м', enExample: 'Task duration 45m' },
  { ru: 'Дорога', en: 'Travel', aliases: ['тт', 'дорога', 'ехать', 'tt', 'travel', 'drive', 'тб', 'tb', 'travel back', 'ттб', 'ttb'], ruExample: 'Встреча завтра 15:00 тт 30м тб 20м', enExample: 'Meeting tomorrow 15:00 tt 30m tb 20m' },
  { ru: 'Срок', en: 'Due', aliases: ['до', 'срок', 'due', 'by'], ruExample: 'Отчёт до завтра 18:00', enExample: 'Report due tomorrow 18:00' },
  { ru: 'Обычное напоминание', en: 'Notification', aliases: ['н', 'нап', 'напомнить', 'remind', 'reminder', 'r'], ruExample: 'Встреча завтра 15:00 н 30м', enExample: 'Meeting tomorrow 15:00 remind 30m' },
  { ru: 'Будильник', en: 'Alarm', aliases: quickCommandAliases.alarm, ruExample: 'Встреча завтра 15:00 нн 30м; Встреча завтра 15:00 нн', enExample: 'Meeting tomorrow 15:00 alarm 30m; Meeting tomorrow 15:00 rr' },
  { ru: 'Интервалы напоминаний', en: 'Reminder intervals', aliases: ['через / in', 'начало / start', 'выезд / leave', 'срок / due', 'в / at'], ruExample: 'Задача н через 45м; Встреча завтра 15:00 нн выезд-30м', enExample: 'Task remind in 45m; Meeting tomorrow 15:00 alarm start-30m' },
  { ru: 'Организация', en: 'Organization', aliases: ['э', 'ar', 'area', 'область', 'п', 'p', 'project', 'проект', '#', 'tag', 'тег', 'тэг'], ruExample: 'Задача э "Работа" п "Релиз" #важное', enExample: 'Task area "Work" project "Release" #important' },
  { ru: 'Открыть таймер', en: 'Open timer', aliases: quickCommandAliases.timer, ruExample: 'т + Enter', enExample: 'timer + Enter' },
  { ru: 'Запустить секундомер', en: 'Start stopwatch', aliases: quickCommandAliases.stopwatch, ruExample: 'с + Enter; "с" — обычное название', enExample: 'stopwatch + Enter; "timer" is an ordinary title' },
];
