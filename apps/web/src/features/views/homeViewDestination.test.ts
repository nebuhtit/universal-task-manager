import { describe, expect, it } from 'vitest';
import { createWorkspace, ensureAreaDefinition, ensureProjectDefinition, type SavedView } from '@utm/core';
import { homeViewDestination } from './homeViewDestination';

describe('Home view destinations', () => {
  const workspace = createWorkspace('Navigation');
  ensureAreaDefinition(workspace, 'Focus'); ensureProjectDefinition(workspace, 'Launch');
  const view: SavedView = { id: 'test', name: 'Test', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [] };
  it('opens legacy explicit scopes', () => {
    expect(homeViewDestination({ ...view, project: 'Launch' }, workspace)).toEqual({ kind: 'project', name: 'Launch' });
    expect(homeViewDestination({ ...view, area: 'Focus' }, workspace)).toEqual({ kind: 'area', name: 'Focus' });
  });
  it('recognizes edited pinned scopes without legacy fields', () => {
    expect(homeViewDestination({ ...view, extensions: { 'utm:para-view': true, 'utm:para-scope': JSON.stringify({ kind: 'project', project: 'Launch' }) } }, workspace)).toEqual({ kind: 'project', name: 'Launch' });
    expect(homeViewDestination({ ...view, extensions: { 'utm:para-view': true, 'utm:para-scope': JSON.stringify({ kind: 'area', area: 'Focus', project: null }) } }, workspace)).toEqual({ kind: 'area', name: 'Focus' });
  });
  it('does not treat arbitrary new-item defaults as a project view', () => {
    expect(homeViewDestination({ ...view, creationDefaults: { project: 'Launch' } }, workspace)).toBeUndefined();
  });
  it('falls back to current pinned defaults for renamed entities', () => {
    expect(homeViewDestination({ ...view, creationDefaults: { project: 'Launch' }, extensions: { 'utm:para-view': true, 'utm:para-scope': '{"project":"Old name"}' } }, workspace)).toEqual({ kind: 'project', name: 'Launch' });
  });
  it('ignores invalid or missing entities and malformed scopes', () => {
    expect(homeViewDestination({ ...view, project: 'Missing', extensions: { 'utm:para-view': true, 'utm:para-scope': '{' } }, workspace)).toBeUndefined();
  });
});
