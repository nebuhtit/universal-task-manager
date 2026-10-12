import { createCalendarEvaluator } from './calendarEvaluation';
import { createCalendarCapacityCache } from './calendarCapacity';
import { createCalendarPlanCache } from './calendarPlanning';

/** Owned by the unlocked app session, released when its workspace is locked. */
export function createCalendarPageCache(workspaceId: string) {
  return { workspaceId, evaluator: createCalendarEvaluator(), capacityCache: createCalendarCapacityCache(), planCache: createCalendarPlanCache() };
}

export type CalendarPageCache = ReturnType<typeof createCalendarPageCache>;
