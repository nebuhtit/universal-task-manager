import { describe, expect, it, vi } from 'vitest';
import { ACTIVE_ITEM_VIEW_QUERY, STANDARD_ATTENTION_VIEW_SORT_SOURCE, createItem, createWorkspace, ensureAreaDefinition, ensureListDefinition, ensureProjectDefinition, makeSeries, reconcileRecurrences, reorderOrganization, reorderOrganizationPriority, type SavedView } from '@utm/core';
import { viewFieldGroups } from './fieldCatalog';
import { boardSettingsFor, completionPhase, evaluateView, MANUAL_ORDER_EXTENSION, mergeManualOrder, moveManualItem, selectViewItems, setCompletionHold, viewContinuouslyDependsOnCurrentTime, viewDependsOnCurrentTime } from './viewSelectors';

const view = (source = 'true'): SavedView => ({
  id: 'view-test', name: 'Test', query: { source }, renderer: 'table', fields: ['title'], sort: [],
});

describe('view selectors', () => {
  it('evaluates membership and statistics together and only enables clocks when required', () => {
    const workspace = createWorkspace('Evaluation');
    const item = createItem('Static item');
    item.schedule = { timezone: 'UTC', estimatedDuration: 'PT10M' };
    workspace.items[item.id] = item;
    const staticView = { ...view('state == "open"'), statistics: { showTime: true, reservedItemIds: [] } };
    const now = new Date('2026-09-03T10:00:00.000Z');
    const evaluation = evaluateView(workspace, staticView, now);
    expect(evaluation.items.map((entry) => entry.id)).toEqual([item.id]);
    expect(evaluation.metrics?.remainingDurationMs).toBe(10 * 60_000);
    expect(evaluation.now).toBe(now);
    expect(viewDependsOnCurrentTime(workspace, staticView)).toBe(false);

    const todayView = view('scheduleInPeriod("today", "due", false, 7, "", "")');
    expect(viewDependsOnCurrentTime(workspace, todayView)).toBe(true);
    expect(viewContinuouslyDependsOnCurrentTime(workspace, todayView)).toBe(false);

    const liveScriptView: SavedView = { ...staticView, fields: ['title', 'view_script.remaining'], scripts: [{ id: 'remaining-script', key: 'remaining', label: 'Remaining', source: 'timeUntil(schedule.dueAt)', resultKind: 'text' }] };
    expect(viewContinuouslyDependsOnCurrentTime(workspace, liveScriptView)).toBe(true);
    expect(viewDependsOnCurrentTime(workspace, { ...liveScriptView, fields: ['title'] })).toBe(false);
  });

  it('filters and sorts view items without renderer state', () => {
    const workspace = createWorkspace('Views');
    const low = createItem('Low'); low.priority = 1;
    const high = createItem('High'); high.priority = 4;
    workspace.items[low.id] = low;
    workspace.items[high.id] = high;
    const savedView = { ...view('priority >= 2'), sortSource: 'priority desc' };
    expect(selectViewItems(workspace, savedView).map((item) => item.title)).toEqual(['High']);
  });

  it('shows the active occurrence of a recurring series in ordinary Saved Views', () => {
    const now = new Date('2026-08-31T15:09:53.717Z');
    const workspace = createWorkspace('Recurring view', now);
    const item = createItem('Oooo', 'event', now);
    item.schedule = { timezone: 'Europe/Moscow', startAt: '2026-08-31T20:00:00.000Z', endAt: '2026-08-31T21:00:00.000Z', estimatedDuration: 'PT1H' };
    const series = makeSeries(item, 'FREQ=DAILY;INTERVAL=1', { activationOffset: 'P7D', autoRenew: true });
    workspace.items[series.id] = series;
    reconcileRecurrences(workspace, now);
    const occurrence = Object.values(workspace.items).find((candidate) => candidate.occurrence?.seriesId === series.id);
    expect(occurrence).toMatchObject({ role: 'occurrence', state: 'open', schedule: { startAt: '2026-08-31T20:00:00.000Z' } });
    const today = view('state == "open" && role != "series_template" && isTemplate != true && scheduleInPeriod("today", "event_open", true, 7, "", "")');
    expect(selectViewItems(workspace, today, now).map((candidate) => candidate.title)).toEqual(['Oooo']);
    expect(selectViewItems(workspace, view('state == "open" && role != "series_template" && isTemplate != true'), now).map((candidate) => candidate.title)).toEqual(['Oooo']);
  });

  it('uses the series as a fallback before reconciliation and never duplicates its materialized occurrence', () => {
    const now = new Date('2026-09-01T08:46:39.333Z');
    const workspace = createWorkspace('Recurring fallback', now);
    const item = createItem('Постричся', 'task', now);
    item.schedule = { timezone: 'Europe/Moscow', dueAt: '2026-09-03T08:46:00.000Z', estimatedDuration: 'PT10M' };
    const series = makeSeries(item, 'FREQ=WEEKLY;INTERVAL=3', { anchor: 'completion', activationOffset: 'P7D', autoRenew: true, closeAt: 'next_activation' });
    workspace.items[series.id] = series;
    const active = view(ACTIVE_ITEM_VIEW_QUERY);

    expect(selectViewItems(workspace, active, now).map((candidate) => candidate.title)).toEqual(['Постричся']);
    reconcileRecurrences(workspace, now);
    const selected = selectViewItems(workspace, active, now);
    expect(selected.map((candidate) => candidate.title)).toEqual(['Постричся']);
    expect(selected[0]?.role).toBe('occurrence');
  });

  it('excludes a recurring series by occurrence.seriesId before and after reconciliation', () => {
    const now = new Date('2026-09-04T11:00:00.000Z');
    const workspace = createWorkspace('Recurring exclusions', now);
    const item = createItem('Sleep', 'event', now);
    item.schedule = { timezone: 'UTC', startAt: '2026-09-04T20:00:00.000Z', endAt: '2026-09-05T05:00:00.000Z' };
    const series = makeSeries(item, 'FREQ=DAILY;INTERVAL=1');
    workspace.items[series.id] = series;
    const withoutSleep = view(`state == "open" && occurrence.seriesId != ${JSON.stringify(series.id)}`);

    expect(selectViewItems(workspace, withoutSleep, now)).toEqual([]);
    reconcileRecurrences(workspace, now);
    expect(Object.values(workspace.items).some((candidate) => candidate.occurrence?.seriesId === series.id)).toBe(true);
    expect(selectViewItems(workspace, withoutSleep, now)).toEqual([]);
  });

  it('holds a completed item in its original views and sort position only until Undo exits', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T10:00:00.000Z'));
    const workspace = createWorkspace('Stable completion');
    const alpha = createItem('Alpha'); alpha.updatedAt = '2026-08-31T08:00:00.000Z'; alpha.priority = 1;
    const beta = createItem('Beta'); beta.updatedAt = '2026-08-31T09:00:00.000Z'; beta.priority = 4;
    workspace.items[alpha.id] = alpha; workspace.items[beta.id] = beta;
    const previous = JSON.parse(JSON.stringify(alpha)) as typeof alpha;
    alpha.state = 'done'; alpha.updatedAt = '2026-08-31T10:00:00.000Z';
    const undoUntil = Date.now() + 4_000;
    setCompletionHold(alpha.id, { previous, undoUntil, removeAt: undoUntil + 200 });
    const openView = { ...view('state == "open"'), sortSource: 'updatedAt asc' };
    const highPriorityView = view('priority >= 3');

    expect(selectViewItems(workspace, openView).map((item) => item.title)).toEqual(['Alpha', 'Beta']);
    expect(selectViewItems(workspace, highPriorityView).map((item) => item.title)).toEqual(['Beta']);
    expect(completionPhase(alpha.id)).toBe('held');

    vi.advanceTimersByTime(4_000);
    expect(completionPhase(alpha.id)).toBe('exiting');
    expect(selectViewItems(workspace, openView).map((item) => item.title)).toEqual(['Alpha', 'Beta']);

    vi.advanceTimersByTime(200);
    expect(completionPhase(alpha.id)).toBeUndefined();
    expect(selectViewItems(workspace, openView).map((item) => item.title)).toEqual(['Beta']);
    setCompletionHold(alpha.id);
    vi.useRealTimers();
  });

  it('keeps field grouping and board defaults in the views feature', () => {
    const workspace = createWorkspace('Fields');
    workspace.customFields.score = { id: 'score', key: 'score', label: 'Score', kind: 'number', required: false };
    expect(viewFieldGroups(workspace).find((group) => group.name === 'Custom fields')?.fields[0]?.label).toBe('Score');
    expect(boardSettingsFor(view())).toMatchObject({ groupBy: 'status', showEmpty: false });
  });

  it('sorts lists by priority, then newer list, and keeps unlisted items last', () => {
    const workspace = createWorkspace('PARA');
    const oldUrgent = createItem('Old urgent'); oldUrgent.list = 'Health';
    const newUrgent = createItem('New urgent'); newUrgent.list = 'Launch';
    const medium = createItem('Medium'); medium.list = 'Reading';
    const unlisted = createItem('Unlisted');
    [oldUrgent, newUrgent, medium, unlisted].forEach((item) => { workspace.items[item.id] = item; });
    ensureListDefinition(workspace, 'Health', { kind: 'area', priority: 4 }, new Date('2026-01-01T00:00:00.000Z'));
    ensureListDefinition(workspace, 'Launch', { kind: 'project', priority: 4 }, new Date('2026-02-01T00:00:00.000Z'));
    ensureListDefinition(workspace, 'Reading', { kind: 'resource', priority: 2 }, new Date('2026-03-01T00:00:00.000Z'));

    expect(selectViewItems(workspace, { ...view(), sortSource: 'listOrder desc nulls last' }).map((item) => item.title))
      .toEqual(['New urgent', 'Old urgent', 'Medium', 'Unlisted']);
  });

  it('filters by independent Area and Project and sorts their manual orders separately', () => {
    const workspace = createWorkspace('PARA view');
    const vehicle = createItem('Repair vehicle'); vehicle.areas = ['Work']; vehicle.projects = ['Vehicle']; vehicle.priority = 4;
    const program = createItem('Build program'); program.areas = ['Work', 'Learning']; program.projects = ['Program']; program.priority = 2;
    const vacation = createItem('Book hotel'); vacation.areas = ['Vacation']; vacation.projects = ['Trip']; vacation.priority = 3;
    [vehicle, program, vacation].forEach((item) => { workspace.items[item.id] = item; });
    ensureAreaDefinition(workspace, 'Work'); ensureAreaDefinition(workspace, 'Vacation');
    ensureProjectDefinition(workspace, 'Vehicle', { area: 'Work' }); ensureProjectDefinition(workspace, 'Program', { area: 'Work' }); ensureProjectDefinition(workspace, 'Trip', { area: 'Vacation' });
    reorderOrganization(workspace, 'project', ['Program', 'Vehicle', 'Trip', null]);
    expect(selectViewItems(workspace, { ...view(), area: 'Work', sortSource: 'projectOrder desc nulls last' }).map((item) => item.title)).toEqual(['Build program', 'Repair vehicle']);
    expect(selectViewItems(workspace, { ...view(), area: 'Work', project: 'Vehicle' }).map((item) => item.title)).toEqual(['Repair vehicle']);
    expect(selectViewItems(workspace, view('area == "Learning"')).map((item) => item.title)).toEqual(['Build program']);
    const unassigned = createItem('No Area'); workspace.items[unassigned.id] = unassigned;
    expect(selectViewItems(workspace, view('area == null')).map((item) => item.title)).toEqual(['No Area']);
  });

  it('sorts by configurable Area, Project and best-tag positions including missing values', () => {
    const workspace = createWorkspace('Organization fallbacks');
    const tagged = createItem('Tagged'); tagged.tags = ['focus']; tagged.area = 'Work'; tagged.project = 'Launch';
    const unassigned = createItem('Unassigned');
    workspace.items[tagged.id] = tagged; workspace.items[unassigned.id] = unassigned;
    ensureAreaDefinition(workspace, 'Work');
    ensureProjectDefinition(workspace, 'Launch');
    workspace.organizationPreferences.tagOrder = ['focus', null];
    workspace.organizationPreferences.areaOrder = [null, 'Work'];
    workspace.organizationPreferences.projectOrder = [null, 'Launch'];

    expect(selectViewItems(workspace, { ...view(), sortSource: 'tagOrder desc nulls last' }).map((item) => item.title)).toEqual(['Tagged', 'Unassigned']);
    expect(selectViewItems(workspace, { ...view(), sortSource: 'areaOrder desc nulls last' }).map((item) => item.title)).toEqual(['Unassigned', 'Tagged']);
    expect(selectViewItems(workspace, { ...view(), sortSource: 'projectOrder desc nulls last' }).map((item) => item.title)).toEqual(['Unassigned', 'Tagged']);
  });

  it('applies organization sort rules in the View order and can reverse manual order', () => {
    const workspace = createWorkspace('Organization chain');
    const work = createItem('Work first'); work.area = 'Work'; work.project = 'Beta'; work.tags = ['someday', 'urgent'];
    const personal = createItem('Tag first'); personal.area = 'Personal'; personal.project = 'Alpha'; personal.tags = ['urgent'];
    workspace.items[work.id] = work; workspace.items[personal.id] = personal;
    ensureAreaDefinition(workspace, 'Work'); ensureAreaDefinition(workspace, 'Personal');
    ensureProjectDefinition(workspace, 'Alpha'); ensureProjectDefinition(workspace, 'Beta');
    workspace.organizationPreferences.areaOrder = ['Work', 'Personal', null];
    workspace.organizationPreferences.projectOrder = ['Alpha', 'Beta', null];
    workspace.organizationPreferences.tagOrder = ['urgent', 'someday', null];

    expect(selectViewItems(workspace, { ...view(), sortSource: 'areaOrder desc\ntagOrder desc' }).map((item) => item.title)).toEqual(['Work first', 'Tag first']);
    expect(selectViewItems(workspace, { ...view(), sortSource: 'tagOrder desc\nprojectOrder desc' }).map((item) => item.title)).toEqual(['Tag first', 'Work first']);
    expect(selectViewItems(workspace, { ...view(), sortSource: 'areaOrder asc' }).map((item) => item.title)).toEqual(['Tag first', 'Work first']);
  });

  it('sorts by the first match in the unified organization ladder', () => {
    const workspace = createWorkspace('Unified organization view');
    const tagged = createItem('Urgent exception'); tagged.areas = ['Personal']; tagged.tags = ['urgent'];
    const work = createItem('Work item'); work.areas = ['Work']; work.projects = ['Launch'];
    const empty = createItem('No organization');
    [tagged, work, empty].forEach((item) => { workspace.items[item.id] = item; });
    ensureAreaDefinition(workspace, 'Work'); ensureAreaDefinition(workspace, 'Personal'); ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'] });
    workspace.organizationPreferences.tagOrder = ['urgent', null];
    reorderOrganizationPriority(workspace, [
      { kind: 'tag', name: 'urgent' }, { kind: 'area', name: 'Work' }, { kind: 'project', name: 'Launch' },
      { kind: 'area', name: 'Personal' }, { kind: 'area', name: null }, { kind: 'project', name: null }, { kind: 'tag', name: null },
    ]);
    expect(selectViewItems(workspace, { ...view(), sortSource: 'organizationOrder desc' }).map((item) => item.title)).toEqual(['Urgent exception', 'Work item', 'No organization']);
    expect(selectViewItems(workspace, { ...view(), sortSource: 'organizationOrder asc' }).map((item) => item.title)).toEqual(['No organization', 'Work item', 'Urgent exception']);
  });

  it('uses unified priority before smart time attention, duration and creation time', () => {
    const now = new Date('2026-09-02T12:00:00.000Z');
    const workspace = createWorkspace('Standard attention sort', now);
    const highFuture = createItem('High future', 'task', new Date('2026-09-02T08:00:00.000Z')); highFuture.tags = ['urgent']; highFuture.schedule = { timezone: 'UTC', dueAt: '2026-09-10T12:00:00.000Z', estimatedDuration: 'PT10M' };
    const lowOverdue = createItem('Low overdue', 'task', new Date('2026-09-02T11:00:00.000Z')); lowOverdue.areas = ['Someday']; lowOverdue.schedule = { timezone: 'UTC', dueAt: '2026-09-01T12:00:00.000Z', estimatedDuration: 'PT4H' };
    const long = createItem('Long', 'task', new Date('2026-09-02T09:00:00.000Z')); long.tags = ['urgent']; long.schedule = { timezone: 'UTC', startAt: '2026-09-03T12:00:00.000Z', estimatedDuration: 'PT2H' };
    const shortNew = createItem('Short new', 'task', new Date('2026-09-02T11:30:00.000Z')); shortNew.tags = ['urgent']; shortNew.schedule = { timezone: 'UTC', startAt: '2026-09-03T12:00:00.000Z', estimatedDuration: 'PT10M' };
    [highFuture, lowOverdue, long, shortNew].forEach((item) => { workspace.items[item.id] = item; });
    ensureAreaDefinition(workspace, 'Someday');
    reorderOrganizationPriority(workspace, [{ kind: 'tag', name: 'urgent' }, { kind: 'area', name: 'Someday' }, { kind: 'area', name: null }, { kind: 'project', name: null }, { kind: 'tag', name: null }]);
    expect(selectViewItems(workspace, { ...view(), sortSource: STANDARD_ATTENTION_VIEW_SORT_SOURCE }, now).map((item) => item.title))
      .toEqual(['Long', 'Short new', 'High future', 'Low overdue']);
  });

  it('keeps organization sorting usable before an in-memory legacy workspace is migrated', () => {
    const workspace = createWorkspace('Legacy live workspace');
    const item = createItem('Still visible'); workspace.items[item.id] = item;
    delete (workspace as Partial<typeof workspace>).organizationPreferences;
    expect(selectViewItems(workspace, { ...view(), sortSource: 'areaOrder desc nulls last' }).map((entry) => entry.title)).toEqual(['Still visible']);
  });

  it('lets a view override its configured sort and reset back to that sort', () => {
    const workspace = createWorkspace('Manual order');
    const alpha = createItem('Alpha'); const beta = createItem('Beta'); const gamma = createItem('Gamma');
    [gamma, alpha, beta].forEach((item) => { workspace.items[item.id] = item; });
    const sorted = { ...view(), sortSource: 'title asc nulls last' };
    expect(selectViewItems(workspace, sorted).map((item) => item.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const manuallySorted = { ...sorted, extensions: { [MANUAL_ORDER_EXTENSION]: [gamma.id, alpha.id, beta.id] } };
    expect(selectViewItems(workspace, manuallySorted).map((item) => item.title)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(mergeManualOrder(manuallySorted, [beta.id, gamma.id], new Set([alpha.id, beta.id, gamma.id]))).toEqual([beta.id, gamma.id, alpha.id]);
    expect(moveManualItem([alpha.id, beta.id, gamma.id], gamma.id, alpha.id)).toEqual([gamma.id, alpha.id, beta.id]);
    expect(moveManualItem([alpha.id, beta.id, gamma.id], alpha.id, beta.id, true)).toEqual([beta.id, alpha.id, gamma.id]);
    expect(selectViewItems(workspace, { ...manuallySorted, extensions: {} }).map((item) => item.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});
