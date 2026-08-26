import { describe, expect, it } from 'vitest';
import { applyPortableImport, buildPortableImportPreview, createItem, createPortablePackage, createWorkspace, ensureAreaDefinition, ensureProjectDefinition, orderedOrganizationNames, parsePortablePackage, reorderOrganization, serializePortablePackage } from './index.js';

describe('PARA organization', () => {
  it('keeps Area and Project independent on one universal item', () => {
    const workspace = createWorkspace('PARA');
    const item = createItem('Repair the vehicle'); item.area = 'Work'; item.project = 'Vehicle repair'; workspace.items[item.id] = item;
    ensureAreaDefinition(workspace, 'Work', { priority: 4 });
    ensureProjectDefinition(workspace, 'Vehicle repair', { area: 'Work', priority: 3 });
    expect(item).toMatchObject({ area: 'Work', project: 'Vehicle repair' });
    expect(workspace.projectDefinitions['Vehicle repair']).toMatchObject({ area: 'Work', priority: 3 });
    ensureProjectDefinition(workspace, 'Vehicle repair', { area: '' });
    expect(workspace.projectDefinitions['Vehicle repair']?.area).toBeUndefined();
  });

  it('sorts by priority first and manual order second', () => {
    const workspace = createWorkspace('Order');
    ensureAreaDefinition(workspace, 'Vacation', { priority: 2 });
    ensureAreaDefinition(workspace, 'Work', { priority: 4 });
    ensureAreaDefinition(workspace, 'Health', { priority: 4 });
    reorderOrganization(workspace, 'area', ['Health', 'Work', 'Vacation']);
    expect(orderedOrganizationNames(workspace, 'area')).toEqual(['Health', 'Work', 'Vacation']);
  });

  it('keeps Area and Project definitions in portable packages', () => {
    const workspace = createWorkspace('Portable PARA');
    ensureAreaDefinition(workspace, 'Work', { priority: 4 });
    ensureProjectDefinition(workspace, 'Launch', { area: 'Work', priority: 3 });
    const parsed = parsePortablePackage(serializePortablePackage(createPortablePackage(workspace, { kind: 'items' }))).package;
    expect(parsed.areaDefinitions?.Work?.priority).toBe(4);
    expect(parsed.projectDefinitions?.Launch).toMatchObject({ area: 'Work', priority: 3 });
    const target = createWorkspace('Imported PARA');
    applyPortableImport(target, buildPortableImportPreview(parsed, target));
    expect(target.areaDefinitions.Work?.priority).toBe(4);
    expect(target.projectDefinitions.Launch).toMatchObject({ area: 'Work', priority: 3 });
  });
});
