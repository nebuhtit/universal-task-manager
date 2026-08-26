import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, ensureAreaDefinition, ensureListDefinition, ensureProjectDefinition, reorderOrganization, type SavedView } from '@utm/core';
import { viewFieldGroups } from './fieldCatalog';
import { boardSettingsFor, MANUAL_ORDER_EXTENSION, mergeManualOrder, moveManualItem, selectViewItems } from './viewSelectors';

const view = (source = 'true'): SavedView => ({
  id: 'view-test', name: 'Test', query: { source }, renderer: 'table', fields: ['title'], sort: [],
});

describe('view selectors', () => {
  it('filters and sorts view items without renderer state', () => {
    const workspace = createWorkspace('Views');
    const low = createItem('Low'); low.priority = 1;
    const high = createItem('High'); high.priority = 4;
    workspace.items[low.id] = low;
    workspace.items[high.id] = high;
    const savedView = { ...view('priority >= 2'), sortSource: 'priority desc' };
    expect(selectViewItems(workspace, savedView).map((item) => item.title)).toEqual(['High']);
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
    const vehicle = createItem('Repair vehicle'); vehicle.area = 'Work'; vehicle.project = 'Vehicle'; vehicle.priority = 4;
    const program = createItem('Build program'); program.area = 'Work'; program.project = 'Program'; program.priority = 2;
    const vacation = createItem('Book hotel'); vacation.area = 'Vacation'; vacation.project = 'Trip'; vacation.priority = 3;
    [vehicle, program, vacation].forEach((item) => { workspace.items[item.id] = item; });
    ensureAreaDefinition(workspace, 'Work'); ensureAreaDefinition(workspace, 'Vacation');
    ensureProjectDefinition(workspace, 'Vehicle', { area: 'Work' }); ensureProjectDefinition(workspace, 'Program', { area: 'Work' }); ensureProjectDefinition(workspace, 'Trip', { area: 'Vacation' });
    reorderOrganization(workspace, 'project', ['Program', 'Vehicle', 'Trip', null]);
    expect(selectViewItems(workspace, { ...view(), area: 'Work', sortSource: 'projectOrder desc nulls last' }).map((item) => item.title)).toEqual(['Build program', 'Repair vehicle']);
    expect(selectViewItems(workspace, { ...view(), area: 'Work', project: 'Vehicle' }).map((item) => item.title)).toEqual(['Repair vehicle']);
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
