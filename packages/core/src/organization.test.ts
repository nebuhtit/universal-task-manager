import { describe, expect, it } from 'vitest';
import { applyPortableImport, buildPortableImportPreview, createItem, createPortablePackage, createWorkspace, ensureAreaDefinition, ensureProjectDefinition, migrateWorkspace, orderedOrganizationNames, orderedTagEntries, parsePortablePackage, reorderOrganization, serializePortablePackage } from './index.js';

describe('PARA organization', () => {
  it('keeps Area and Project independent on one universal item', () => {
    const workspace = createWorkspace('PARA');
    const item = createItem('Repair the vehicle'); item.area = 'Work'; item.project = 'Vehicle repair'; workspace.items[item.id] = item;
    ensureAreaDefinition(workspace, 'Work');
    ensureProjectDefinition(workspace, 'Vehicle repair', { area: 'Work' });
    expect(item).toMatchObject({ area: 'Work', project: 'Vehicle repair' });
    expect(workspace.projectDefinitions['Vehicle repair']).toMatchObject({ area: 'Work' });
    ensureProjectDefinition(workspace, 'Vehicle repair', { area: '' });
    expect(workspace.projectDefinitions['Vehicle repair']?.area).toBeUndefined();
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
    ensureProjectDefinition(workspace, 'Launch', { area: 'Work' });
    reorderOrganization(workspace, 'area', ['Work', null]);
    const parsed = parsePortablePackage(serializePortablePackage(createPortablePackage(workspace, { kind: 'items' }))).package;
    expect(parsed.areaDefinitions?.Work?.name).toBe('Work');
    expect(parsed.projectDefinitions?.Launch).toMatchObject({ area: 'Work' });
    expect(parsed.organizationPreferences?.areaOrder).toEqual(['Work', null]);
    const target = createWorkspace('Imported PARA');
    applyPortableImport(target, buildPortableImportPreview(parsed, target));
    expect(target.areaDefinitions.Work?.name).toBe('Work');
    expect(target.projectDefinitions.Launch).toMatchObject({ area: 'Work' });
    expect(target.organizationPreferences.areaOrder).toEqual(['Work', null]);
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
});
