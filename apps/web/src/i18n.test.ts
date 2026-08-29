import { describe, expect, it } from 'vitest';
import { translateInterfaceText } from './i18n';

describe('Russian interface translation', () => {
  it('covers the newer workspace, recovery, organization and view controls', () => {
    expect(translateInterfaceText('Unlock with Face ID', 'ru')).toBe('Войти с Face ID');
    expect(translateInterfaceText('Download offline recovery kit', 'ru')).toBe('Скачать автономный комплект восстановления');
    expect(translateInterfaceText('Unified priority', 'ru')).toBe('Общий приоритет');
    expect(translateInterfaceText('View templates', 'ru')).toBe('Шаблоны видов');
  });

  it('translates dynamic labels without changing user-provided names', () => {
    expect(translateInterfaceText('Edit Покупки', 'ru')).toBe('Редактировать Покупки');
    expect(translateInterfaceText('Add item to Работа', 'ru')).toBe('Добавить элемент в Работа');
    expect(translateInterfaceText('12 matching items', 'ru')).toBe('Подходящих элементов: 12');
  });

  it('does not spend maintenance effort changing other languages', () => {
    expect(translateInterfaceText('Unlock with Face ID', 'en')).toBe('Unlock with Face ID');
  });
});
