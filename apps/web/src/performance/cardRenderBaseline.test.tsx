import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ItemCard } from '../features/items/ItemCard';
import { viewFieldLabel } from '../features/items/fieldDisplay';
import { createPerformanceWorkspace, PERFORMANCE_NOW } from './performanceFixture';

const enabled = process.env.UTM_PERF_BASELINE === '1';
it.skipIf(!enabled)('measures initial card rendering and repeated metadata labels', () => {
  for (const size of [100, 1000]) {
    const workspace = createPerformanceWorkspace(size);
    Object.values(workspace.items).forEach((item, index) => {
      item.scripts = [{ id: `script-${index}`, key: `value-${index}`, label: `Value ${index}`, source: '1', resultKind: 'number' }];
    });
    const fields = ['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project'];
    const cards = Object.values(workspace.items).slice(0, size);
    const start = performance.now();
    const markup = renderToStaticMarkup(<>{cards.map(item => <ItemCard key={item.id} item={item} workspace={workspace} now={PERFORMANCE_NOW} fields={fields} onEdit={() => {}} onState={() => {}} />)}</>);
    const renderMs = performance.now() - start;
    const samples: number[] = [];
    for (let run = 0; run < 5; run++) {
      const at = performance.now();
      let characters = 0;
      for (const _item of cards) for (const field of fields) characters += viewFieldLabel(workspace, field).length;
      samples.push(performance.now() - at);
      expect(characters).toBeGreaterThan(0);
    }
    console.info('[card-render]', JSON.stringify({ size, renderMs: +renderMs.toFixed(2), labelsMedianMs: +samples.sort((a, b) => a - b)[2]!.toFixed(2), bytes: markup.length }));
    expect(markup).toContain('item-card');
  }
}, 60_000);
