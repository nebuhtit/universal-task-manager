import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, Checkbox, Disclosure, Field, IconButton, Input, Select, Surface, Textarea } from './primitives';

describe('UI primitives', () => {
  it('uses native interactive elements and safe button defaults', () => {
    const markup = renderToStaticMarkup(<>
      <Button disabled>Save</Button>
      <IconButton aria-label="Close">×</IconButton>
      <Input id="title" disabled />
      <Textarea aria-label="Notes" />
      <Select aria-label="State"><option>Active</option></Select>
      <Checkbox label="Include done" disabled />
    </>);

    expect(markup).toContain('<button type="button"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-label="Close"');
    expect(markup).toContain('<input');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('<textarea');
    expect(markup).toContain('<select');
    expect(markup).not.toContain('role="button"');
  });

  it('connects field labels and exposes errors as visible semantics', () => {
    const markup = renderToStaticMarkup(<Field label="Title" error="Required"><Input /></Field>);
    const fieldId = markup.match(/<label class="ui-field-label" for="([^"]+)">/)?.[1];
    expect(fieldId).toBeTruthy();
    expect(markup).toContain(`id="${fieldId}"`);
    expect(markup).toContain('data-invalid="true"');
    expect(markup).toContain('class="ui-field-error"');
  });

  it('keeps disclosure keyboard behavior native and persistence delegated', () => {
    const markup = renderToStaticMarkup(<Disclosure uiKey="test:advanced" summary="Advanced" defaultOpen><p>Details</p></Disclosure>);
    expect(markup).toContain('<details class="ui-disclosure" open="">');
    expect(markup).toContain('<summary class="ui-disclosure-summary">Advanced</summary>');
    expect(markup).not.toContain('tabindex');
  });

  it('renders semantic surface variants without presentation props', () => {
    expect(renderToStaticMarkup(<Surface variant="elevated">Content</Surface>)).toContain('data-variant="elevated"');
  });

  it('defines focus-visible, disabled, touch and semantic-token state styles', () => {
    const cssPath = fileURLToPath(new URL('./primitives.css', import.meta.url));
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain(':focus-visible');
    expect(css).toContain(':disabled');
    expect(css).toContain('var(--control-height-touch)');
    expect(css).toContain('var(--color-interactive-hover)');
    expect(css).toContain('var(--color-destructive)');
    expect(css).toContain("[data-variant='primary']:hover");
    expect(css.lastIndexOf('.ui-button:disabled')).toBeGreaterThan(css.lastIndexOf("[data-variant='destructive']:active"));
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
