import { describe, expect, it } from 'vitest';
import { applyPortableImport, buildPortableImportPreview, calculateItemSetMetrics, calculateProjectMetrics, createItem, createPortablePackage, createWorkspace, ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition, migrateWorkspace, orderedOrganizationNames, orderedOrganizationPriorityEntries, orderedTagEntries, organizationAccentFor, organizationPriorityRank, parsePortablePackage, renameAreaDefinition, renameProjectDefinition, renameTagDefinition, reorderAreaSubset, reorderOrganization, reorderOrganizationPriority, reorderProjectSubset, reorderTagSubset, serializePortablePackage } from './index.js';

describe('PARA organization', () => {
  it('uses the theme text color until a custom accent is stored', () => {
    const workspace = createWorkspace('Default colors');
    ensureAreaDefinition(workspace, 'Work'); ensureProjectDefinition(workspace, 'Launch'); ensureTagDefinition(workspace, 'urgent');
    expect(organizationAccentFor(workspace, 'area', 'Work')).toBeUndefined();
    expect(organizationAccentFor(workspace, 'project', 'Launch')).toBeUndefined();
    expect(organizationAccentFor(workspace, 'tag', 'urgent')).toBeUndefined();
    ensureAreaDefinition(workspace, 'Work', { accent: '#2864c7' });
    ensureProjectDefinition(workspace, 'Launch', { accent: '#147a55' });
    ensureTagDefinition(workspace, 'urgent', { accent: '#8b5cf6' });
    expect(organizationAccentFor(workspace, 'area', 'Work')).toBe('#2864c7');
    expect(organizationAccentFor(workspace, 'project', 'Launch')).toBe('#147a55');
    expect(organizationAccentFor(workspace, 'tag', 'urgent')).toBe('#8b5cf6');
  });
  it('derives project progress, duration and the nearest unfinished deadline safely', () => {
    const workspace = createWorkspace('Metrics');
    ensureProjectDefinition(workspace, 'Launch'); ensureProjectDefinition(workspace, 'Empty');
    const done = createItem('Done'); done.projects = ['Launch']; done.state = 'done'; done.schedule = { timezone: 'UTC', estimatedDuration: 'PT30M', dueAt: '2026-08-20T10:00:00.000Z' };
    const open = createItem('Open'); open.projects = ['Launch']; open.schedule = { timezone: 'UTC', startAt: '2026-08-28T10:00:00.000Z', endAt: '2026-08-28T11:15:00.000Z', dueAt: '2026-08-29T09:00:00.000Z' };
    const malformed = createItem('Malformed'); malformed.projects = ['Launch']; malformed.schedule = { timezone: 'UTC', estimatedDuration: 'not-a-duration', dueAt: '2026-08-30T09:00:00.000Z' };
    const cancelled = createItem('Cancelled'); cancelled.projects = ['Launch']; cancelled.state = 'cancelled'; cancelled.schedule = { timezone: 'UTC', estimatedDuration: 'PT9H' };
    const template = createItem('Template'); template.projects = ['Launch']; template.role = 'series_template'; template.schedule = { timezone: 'UTC', estimatedDuration: 'PT9H' };
    workspace.items = Object.fromEntries([done, open, malformed, cancelled, template].map((item) => [item.id, item]));

    expect(calculateProjectMetrics(workspace, new Date('2026-08-29T10:00:00.000Z'))).toMatchObject({
      Launch: { totalItems: 3, completedItems: 1, completionPercent: 33, totalDurationMs: 105 * 60_000, completedDurationMs: 30 * 60_000, nearestDeadline: '2026-08-29T09:00:00.000Z', deadlineOverdue: true },
      Empty: { totalItems: 0, completedItems: 0, completionPercent: 0, totalDurationMs: 0, completedDurationMs: 0, deadlineOverdue: false },
    });
  });

  it('derives completion and remaining duration for an arbitrary selected item set', () => {
    const open = createItem('Open'); open.schedule = { timezone: 'UTC', estimatedDuration: 'PT40M' };
    const legacy = createItem('Legacy duration'); legacy.schedule = { timezone: 'UTC', startAt: '2026-08-30T10:00:00.000Z', endAt: '2026-08-30T10:25:00.000Z' };
    const done = createItem('Done'); done.state = 'done'; done.schedule = { timezone: 'UTC', estimatedDuration: 'PT2H' };
    const autoClosed = createItem('Auto closed'); autoClosed.state = 'auto_closed';
    const cancelled = createItem('Cancelled'); cancelled.state = 'cancelled'; cancelled.schedule = { timezone: 'UTC', estimatedDuration: 'PT9H' };
    const archived = createItem('Archived'); archived.state = 'archived';
    const deleted = createItem('Deleted'); deleted.deletedAt = '2026-08-30T12:00:00.000Z';
    const series = createItem('Series'); series.role = 'series_template';

    expect(calculateItemSetMetrics([open, legacy, done, autoClosed, cancelled, archived, deleted, series, open])).toEqual({
      totalItems: 4,
      completedItems: 2,
      completionPercent: 65,
      remainingDurationMs: 65 * 60_000,
    });
  });

  it('weights a View completion percentage by planned duration instead of item count', () => {
    const short = createItem('Short'); short.state = 'done'; short.schedule = { timezone: 'UTC', estimatedDuration: 'PT10M' };
    const long = createItem('Long'); long.schedule = { timezone: 'UTC', estimatedDuration: 'PT1H' };
    expect(calculateItemSetMetrics([short, long])).toMatchObject({ totalItems: 2, completedItems: 1, completionPercent: 14, remainingDurationMs: 60 * 60_000 });
  });

  it('counts one shared item once inside each linked project', () => {
    const workspace = createWorkspace('Shared metrics');
    const item = createItem('Shared'); item.projects = ['Alpha', 'Beta', 'Alpha']; item.state = 'auto_closed'; item.schedule = { timezone: 'UTC', estimatedDuration: 'PT10M' }; workspace.items[item.id] = item;
    const metrics = calculateProjectMetrics(workspace);
    expect(metrics.Alpha).toMatchObject({ totalItems: 1, completedItems: 1, completionPercent: 100, totalDurationMs: 600_000, completedDurationMs: 600_000 });
    expect(metrics.Beta).toMatchObject({ totalItems: 1, completedItems: 1, completionPercent: 100 });
  });

  it('keeps Area and Project independent on one universal item', () => {
    const workspace = createWorkspace('PARA');
    const item = createItem('Repair the vehicle'); item.areas = ['Work']; item.projects = ['Vehicle repair']; workspace.items[item.id] = item;
    ensureAreaDefinition(workspace, 'Work');
    ensureProjectDefinition(workspace, 'Vehicle repair', { area: 'Work' });
    expect(item).toMatchObject({ areas: ['Work'], projects: ['Vehicle repair'] });
    expect(workspace.projectDefinitions['Vehicle repair']).toMatchObject({ areas: ['Work'] });
    ensureProjectDefinition(workspace, 'Vehicle repair', { area: '' });
    expect(workspace.projectDefinitions['Vehicle repair']?.areas).toEqual([]);
  });

  it('uses one manual order including the movable unassigned row', () => {
    const workspace = createWorkspace('Order');
    ensureAreaDefinition(workspace, 'Vacation');
    ensureAreaDefinition(workspace, 'Work');
    ensureAreaDefinition(workspace, 'Health');
    reorderOrganization(workspace, 'area', ['Health', null, 'Work', 'Vacation']);
    expect(orderedOrganizationNames(workspace, 'area')).toEqual(['Health', 'Work', 'Vacation']);
    expect(workspace.organizationPreferences.areaOrder).toEqual(['Health', null, 'Work', 'Vacation']);
  });

  it('keeps reusable tags visible before an item uses them', () => {
    const workspace = createWorkspace('Tags');
    workspace.organizationPreferences.tagOrder = [null, 'urgent'];
    expect(orderedTagEntries(workspace)).toEqual([null, 'urgent']);
  });

  it('keeps Area and Project definitions in portable packages', () => {
    const workspace = createWorkspace('Portable PARA');
    ensureAreaDefinition(workspace, 'Work');
    ensureAreaDefinition(workspace, 'Personal');
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Work', 'Personal'], accent: '#2864c7' });
    ensureTagDefinition(workspace, 'urgent', { accent: '#8b5cf6' });
    reorderOrganization(workspace, 'area', ['Work', 'Personal', null]);
    const parsed = parsePortablePackage(serializePortablePackage(createPortablePackage(workspace, { kind: 'items' }))).package;
    expect(parsed.areaDefinitions?.Work?.name).toBe('Work');
    expect(parsed.projectDefinitions?.Launch).toMatchObject({ areas: ['Work', 'Personal'], accent: '#2864c7' });
    expect(parsed.organizationPreferences?.areaOrder).toEqual(['Work', 'Personal', null]);
    expect(parsed.organizationPreferences?.tagAccents?.urgent).toBe('#8b5cf6');
    const target = createWorkspace('Imported PARA');
    applyPortableImport(target, buildPortableImportPreview(parsed, target));
    expect(target.areaDefinitions.Work?.name).toBe('Work');
    expect(target.projectDefinitions.Launch).toMatchObject({ areas: ['Work', 'Personal'], accent: '#2864c7' });
    expect(target.organizationPreferences.areaOrder).toEqual(['Work', 'Personal', null]);
    expect(target.organizationPreferences.tagAccents?.urgent).toBe('#8b5cf6');
  });

  it('migrates legacy priorities into one effective manual order', () => {
    const legacy = structuredClone(createWorkspace('Legacy preferences')) as unknown as Record<string, unknown>;
    legacy.schemaVersion = '1.9.0';
    legacy.areaDefinitions = {
      Work: { name: 'Work', priority: 4, order: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      Health: { name: 'Health', priority: 4, order: 0, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' },
      Later: { name: 'Later', priority: 1, order: 2, createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' },
    };
    legacy.organizationPreferences = { unassignedAreaPriority: 2, unassignedProjectPriority: 0, tagPriorities: { focus: 4, someday: 1 } };
    const migrated = migrateWorkspace(legacy).value;
    expect(migrated.organizationPreferences.areaOrder).toEqual(['Health', 'Work', null, 'Later']);
    expect(migrated.organizationPreferences.tagOrder).toEqual(['focus', 'someday', null]);
    expect(migrated.areaDefinitions.Work).not.toHaveProperty('priority');
  });

  it('uses the first matching entry in one mixed Area, Project and Tag ladder', () => {
    const workspace = createWorkspace('Unified priority');
    ensureAreaDefinition(workspace, 'Work'); ensureAreaDefinition(workspace, 'Personal');
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Work', 'Personal'] });
    workspace.organizationPreferences.tagOrder = ['urgent', null];
    reorderOrganizationPriority(workspace, [
      { kind: 'tag', name: 'urgent' }, { kind: 'area', name: 'Work' }, { kind: 'project', name: 'Launch' },
      { kind: 'area', name: 'Personal' }, { kind: 'area', name: null }, { kind: 'project', name: null }, { kind: 'tag', name: null },
    ]);
    const tagged = createItem('Tagged'); tagged.areas = ['Personal']; tagged.tags = ['urgent'];
    const work = createItem('Work'); work.areas = ['Work']; work.projects = ['Launch'];
    const unassigned = createItem('Unassigned');
    expect(organizationPriorityRank(workspace, tagged)).toBeGreaterThan(organizationPriorityRank(workspace, work));
    expect(organizationPriorityRank(workspace, work)).toBeGreaterThan(organizationPriorityRank(workspace, unassigned));
  });

  it('mirrors the complete Tags catalog order into existing Unified slots, including No Tags', () => {
    const workspace = createWorkspace('Tag subset order');
    ensureAreaDefinition(workspace, 'Work');
    ensureTagDefinition(workspace, 'a'); ensureTagDefinition(workspace, 'b'); ensureTagDefinition(workspace, 'c');
    reorderOrganizationPriority(workspace, [
      { kind: 'area', name: 'Work' }, { kind: 'tag', name: 'a' }, { kind: 'project', name: null },
      { kind: 'tag', name: 'b' }, { kind: 'tag', name: null }, { kind: 'area', name: null }, { kind: 'tag', name: 'c' },
    ]);
    const noTagsIndex = orderedOrganizationPriorityEntries(workspace).findIndex((entry) => entry.kind === 'tag' && entry.name === null);

    reorderTagSubset(workspace, ['c', null, 'a', 'b']);

    expect(orderedTagEntries(workspace).filter((tag): tag is string => tag !== null)).toEqual(['c', 'a', 'b']);
    expect(orderedOrganizationPriorityEntries(workspace).map((entry) => entry.kind === 'tag' ? entry.name : entry.kind)).toEqual([
      'area', 'c', 'project', null, 'a', 'area', 'b',
    ]);
    expect(orderedOrganizationPriorityEntries(workspace).findIndex((entry) => entry.kind === 'tag' && entry.name === null)).not.toBe(noTagsIndex);
    const severalTags = createItem('Several tags'); severalTags.tags = ['a', 'b'];
    const topTag = createItem('Top tag'); topTag.tags = ['c'];
    expect(organizationPriorityRank(workspace, topTag)).toBeGreaterThan(organizationPriorityRank(workspace, severalTags));
  });

  it('mirrors Tag moves in Unified priority back to the catalog', () => {
    const workspace = createWorkspace('Unified Tag sync');
    ensureTagDefinition(workspace, 'a'); ensureTagDefinition(workspace, 'b'); ensureTagDefinition(workspace, 'c');
    const current = orderedOrganizationPriorityEntries(workspace);
    const actualTags = current.filter((entry) => entry.kind === 'tag' && entry.name !== null);
    const others = current.filter((entry) => !(entry.kind === 'tag' && entry.name !== null));
    reorderOrganizationPriority(workspace, [actualTags[2]!, others[0]!, actualTags[0]!, ...others.slice(1), actualTags[1]!]);
    expect(orderedTagEntries(workspace).filter((tag): tag is string => tag !== null)).toEqual(['c', 'a', 'b']);
  });

  it('reorders Projects inside one Area without moving unrelated priority slots', () => {
    const workspace = createWorkspace('Nested Project order');
    ensureAreaDefinition(workspace, 'Work');
    ensureAreaDefinition(workspace, 'Personal');
    ensureProjectDefinition(workspace, 'Alpha', { areas: ['Work'] });
    ensureProjectDefinition(workspace, 'Other', { areas: ['Personal'] });
    ensureProjectDefinition(workspace, 'Beta', { areas: ['Work'] });
    reorderOrganization(workspace, 'project', ['Alpha', 'Other', 'Beta', null]);
    reorderOrganizationPriority(workspace, [
      { kind: 'tag', name: null },
      { kind: 'project', name: 'Alpha' },
      { kind: 'area', name: 'Work' },
      { kind: 'project', name: 'Other' },
      { kind: 'project', name: 'Beta' },
      { kind: 'area', name: 'Personal' },
      { kind: 'area', name: null },
      { kind: 'project', name: null },
    ]);

    reorderProjectSubset(workspace, ['Beta', 'Alpha'], 'Work');

    expect(workspace.organizationPreferences.projectOrder).toEqual(['Beta', 'Other', 'Alpha', null]);
    expect(workspace.organizationPreferences.priorityOrder.slice(0, 6)).toEqual([
      { kind: 'tag', name: null },
      { kind: 'project', name: 'Beta', area: 'Work' },
      { kind: 'area', name: 'Work' },
      { kind: 'project', name: 'Other', area: 'Personal' },
      { kind: 'project', name: 'Alpha', area: 'Work' },
      { kind: 'area', name: 'Personal' },
    ]);
  });

  it('reorders Area cards including No Area without moving Project or Tag slots', () => {
    const workspace = createWorkspace('Area card order');
    ensureAreaDefinition(workspace, 'Work');
    ensureAreaDefinition(workspace, 'Personal');
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'] });
    reorderOrganizationPriority(workspace, [
      { kind: 'area', name: 'Work' },
      { kind: 'project', name: 'Launch' },
      { kind: 'area', name: null },
      { kind: 'tag', name: null },
      { kind: 'area', name: 'Personal' },
      { kind: 'project', name: null },
    ]);

    reorderAreaSubset(workspace, ['Personal', 'Work', null]);

    expect(workspace.organizationPreferences.areaOrder).toEqual(['Personal', 'Work', null]);
    expect(workspace.organizationPreferences.priorityOrder.slice(0, 6)).toEqual([
      { kind: 'area', name: 'Personal' },
      { kind: 'area', name: 'Work' },
      { kind: 'project', name: 'Launch', area: 'Work' },
      { kind: 'tag', name: null },
      { kind: 'area', name: null },
      { kind: 'project', name: null },
    ]);
  });

  it('creates one independently movable Project occurrence for every linked Area', () => {
    const workspace = createWorkspace('Scoped Project priority');
    ensureAreaDefinition(workspace, 'Work');
    ensureAreaDefinition(workspace, 'Personal');
    ensureProjectDefinition(workspace, 'Shared', { areas: ['Work', 'Personal'] });

    const occurrences = orderedOrganizationPriorityEntries(workspace).filter((entry) => entry.kind === 'project' && entry.name === 'Shared');
    expect(occurrences).toEqual([
      { kind: 'project', name: 'Shared', area: 'Work' },
      { kind: 'project', name: 'Shared', area: 'Personal' },
    ]);

    const customized = orderedOrganizationPriorityEntries(workspace);
    const personal = customized.find((entry) => entry.kind === 'project' && entry.name === 'Shared' && entry.area === 'Personal')!;
    reorderOrganizationPriority(workspace, [personal, ...customized.filter((entry) => entry !== personal)]);
    expect(orderedOrganizationPriorityEntries(workspace)[0]).toEqual({ kind: 'project', name: 'Shared', area: 'Personal' });

    const item = createItem('Uses shared project'); item.projects = ['Shared']; item.areas = ['Work', 'Personal'];
    expect(organizationPriorityRank(workspace, item)).toBe(orderedOrganizationPriorityEntries(workspace).length);
  });

  it('updates scoped Project occurrences when Area links change', () => {
    const workspace = createWorkspace('Relationship sync');
    ensureAreaDefinition(workspace, 'Work');
    ensureAreaDefinition(workspace, 'Personal');
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'] });
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Personal'] });
    expect(orderedOrganizationPriorityEntries(workspace).filter((entry) => entry.kind === 'project' && entry.name === 'Launch')).toEqual([
      { kind: 'project', name: 'Launch', area: 'Personal' },
    ]);
  });

  it('expands a legacy unscoped Project priority into every linked Area', () => {
    const legacy = createWorkspace('Legacy scoped migration') as unknown as Record<string, unknown>;
    legacy.schemaVersion = '1.16.0';
    legacy.areaDefinitions = {
      Work: { name: 'Work', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      Personal: { name: 'Personal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    };
    legacy.projectDefinitions = {
      Shared: { name: 'Shared', areas: ['Work', 'Personal'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    };
    legacy.organizationPreferences = {
      areaOrder: ['Work', 'Personal', null], projectOrder: ['Shared', null], tagOrder: [null],
      priorityOrder: [{ kind: 'project', name: 'Shared' }, { kind: 'area', name: 'Work' }, { kind: 'area', name: 'Personal' }, { kind: 'area', name: null }, { kind: 'project', name: null }, { kind: 'tag', name: null }],
    };

    const migrated = migrateWorkspace(legacy).value;
    expect(migrated.schemaVersion).toBe('1.20.0');
    expect(migrated.organizationPreferences.priorityOrder.slice(0, 2)).toEqual([
      { kind: 'project', name: 'Shared', area: 'Work' },
      { kind: 'project', name: 'Shared', area: 'Personal' },
    ]);
  });

  it('renames an Area atomically across items, Projects, Views and priority', () => {
    const workspace = createWorkspace('Area rename');
    ensureAreaDefinition(workspace, 'Work', { accent: '#2864c7' });
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'] });
    const item = createItem('Ship'); item.areas = ['Work']; item.area = 'Work'; workspace.items[item.id] = item;
    workspace.views.rename = { id: 'rename', name: 'Work', query: { source: 'area == "Work"' }, renderer: 'list', sort: [], sortSource: 'area == "Work" asc', fields: ['title'], area: 'Work', creationDefaults: { area: 'Work', areas: ['Work'] } };

    expect(renameAreaDefinition(workspace, 'Work', 'Career', new Date('2026-08-28T08:00:00.000Z'))).toBe(true);
    expect(workspace.areaDefinitions.Work).toBeUndefined();
    expect(workspace.areaDefinitions.Career?.name).toBe('Career');
    expect(workspace.areaDefinitions.Career?.accent).toBe('#2864c7');
    expect(workspace.projectDefinitions.Launch?.areas).toEqual(['Career']);
    expect(item).toMatchObject({ area: 'Career', areas: ['Career'] });
    expect(workspace.views.rename).toMatchObject({ area: 'Career', creationDefaults: { area: 'Career', areas: ['Career'] } });
    expect(workspace.views.rename?.query.source).toBe('area == "Career"');
    expect(orderedOrganizationPriorityEntries(workspace)).toContainEqual({ kind: 'project', name: 'Launch', area: 'Career' });
  });

  it('renames a Project atomically and rejects conflicting names', () => {
    const workspace = createWorkspace('Project rename');
    ensureProjectDefinition(workspace, 'Launch'); ensureProjectDefinition(workspace, 'Existing');
    const item = createItem('Ship'); item.projects = ['Launch']; item.project = 'Launch'; workspace.items[item.id] = item;
    workspace.views.rename = { id: 'rename', name: 'Launch', query: { source: 'project == "Launch"' }, renderer: 'list', sort: [], fields: ['title'], project: 'Launch', creationDefaults: { project: 'Launch', projects: ['Launch'] } };

    expect(renameProjectDefinition(workspace, 'Launch', 'Existing')).toBe(false);
    expect(renameProjectDefinition(workspace, 'Launch', 'Release')).toBe(true);
    expect(workspace.projectDefinitions.Launch).toBeUndefined();
    expect(workspace.projectDefinitions.Release?.name).toBe('Release');
    expect(item).toMatchObject({ project: 'Release', projects: ['Release'] });
    expect(workspace.views.rename).toMatchObject({ project: 'Release', creationDefaults: { project: 'Release', projects: ['Release'] } });
  });

  it('renames a Tag across items, View defaults and Unified priority', () => {
    const workspace = createWorkspace('Tag rename');
    ensureTagDefinition(workspace, 'urgent');
    ensureTagDefinition(workspace, 'urgent', { accent: '#8b5cf6' });
    const item = createItem('Ship'); item.tags = ['urgent']; workspace.items[item.id] = item;
    workspace.views.rename = { id: 'rename', name: 'Urgent', query: { source: 'tags contains "urgent"' }, renderer: 'list', sort: [], fields: ['title'], creationDefaults: { tags: ['urgent'] } };
    expect(renameTagDefinition(workspace, 'urgent', 'now')).toBe(true);
    expect(item.tags).toEqual(['now']);
    expect(workspace.views.rename).toMatchObject({ creationDefaults: { tags: ['now'] } });
    expect(workspace.views.rename?.query.source).toBe('tags contains "now"');
    expect(orderedOrganizationPriorityEntries(workspace)).toContainEqual({ kind: 'tag', name: 'now' });
    expect(organizationAccentFor(workspace, 'tag', 'now')).toBe('#8b5cf6');
    expect(organizationAccentFor(workspace, 'tag', 'urgent')).toBeUndefined();
  });
});
