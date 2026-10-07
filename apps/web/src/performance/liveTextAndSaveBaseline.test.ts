import * as Automerge from '@automerge/automerge';
import { createAutomergeDocument } from '@utm/sdk';
import { orderedOrganizationNames } from '@utm/core';
import { expect, it } from 'vitest';
import { liveTextIndex } from '../features/items/liveTextIndex';
import { createPerformanceWorkspace } from './performanceFixture';

it.skipIf(process.env.UTM_PERF_BASELINE !== '1')('measures catalog equality and blocking save stages independently', () => {
  for (const size of [100, 1000]) {
    const workspace = createPerformanceWorkspace(size);
    Object.values(workspace.items).forEach((item, i) => { item.projects = [`Project ${i % 50}`]; item.areas = [`Area ${i % 10}`]; });
    const measure = <T,>(fn: () => T) => { const start = performance.now(); const value = fn(); return { value, ms: +(performance.now() - start).toFixed(2) }; };
    const before = measure(() => Object.fromEntries(orderedOrganizationNames(workspace, 'project').map(name => [name, [...new Set([
      ...(workspace.projectDefinitions[name]?.areas ?? []), ...(workspace.projectDefinitions[name]?.area ? [workspace.projectDefinitions[name]!.area!] : []),
      ...Object.values(workspace.items).filter(item => !item.deletedAt && (item.projects?.includes(name) || item.project === name)).flatMap(item => [...(item.areas ?? []), ...(item.area ? [item.area] : [])]),
    ])]])));
    const indexed = measure(() => liveTextIndex(workspace));
    const repeated = measure(() => liveTextIndex(workspace));
    expect(indexed.value.catalog.projectAreas).toEqual(before.value);
    expect(repeated.value).toBe(indexed.value);
    const document = createAutomergeDocument(workspace);
    try {
      const serialize = measure(() => Automerge.save(document));
      const snapshot = measure(() => JSON.stringify(document));
      expect(JSON.parse(snapshot.value).workspaceId).toBe(workspace.workspaceId);
      console.info('[live-text-save]', JSON.stringify({ size, oldProjectAreasMs: before.ms, fullIndexMs: indexed.ms, cachedIndexMs: repeated.ms, serializeMs: serialize.ms, snapshotMs: snapshot.ms, binaryBytes: serialize.value.length }));
    } finally { Automerge.free(document); }
  }
}, 60_000);
