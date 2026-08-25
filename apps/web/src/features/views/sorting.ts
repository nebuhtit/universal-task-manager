export const toSqlSort = (source: string): string => {
  const rules = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return rules.length ? `ORDER BY ${rules.map((line) => line.replace(/\s+(asc|desc)(?:\s+nulls\s+(first|last))?$/i, (_match, direction: string, nulls?: string) => ` ${direction.toUpperCase()}${nulls ? ` NULLS ${nulls.toUpperCase()}` : ''}`)).join(', ')}` : 'ORDER BY updatedAt DESC NULLS LAST';
};
