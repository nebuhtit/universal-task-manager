import type { Page } from '@playwright/test';

/** Preloaded neighbours are deliberately in the DOM, but are not today's UI. */
export const currentTimeline = (page: Page) => page.locator('.calendar-day-swipe-content > [data-calendar-slide="current"]');
