import * as Automerge from '@automerge/automerge';
import { expect, it } from 'vitest';
import { createItem, createWorkspace, workspaceForExport, encodeRecoverySnapshot } from '@utm/core';
import { createAutomergeDocument } from './container.js';
import { decodeLocalWorkspaceBinary } from './recoverySnapshot.js';
import { decryptWithKey, randomKey, wrapKey } from './crypto.js';
import { prepareLocalWorkspaceSaveFromVerifiedBinaries, openLocalRecoveryReadOnly, closeReadOnlyWorkspace, decryptWorkspaceFile } from './storage.js';

it('keeps live history, encrypts the filtered snapshot, and opens both backup encodings', async () => {
  const workspace = createWorkspace('Recovery test');
  const item = createItem('Preserved title'); workspace.items[item.id] = item;
  let doc = createAutomergeDocument(workspace);
  doc = Automerge.change(doc, draft => { draft.items[item.id]!.title = 'Edited title'; });
  const binary = Automerge.save(doc), key = await randomKey();
  const safe = workspaceForExport(JSON.parse(JSON.stringify(doc)));
  const encoded = encodeRecoverySnapshot(safe);
  const prepared = await prepareLocalWorkspaceSaveFromVerifiedBinaries(binary, encoded, key);
  if (prepared.workspace.mode === 'plaintext') throw new Error('Expected encryption');
  expect(await decryptWithKey(prepared.workspace, key, 'utm:local:workspace:v1')).toEqual(binary);
  expect(JSON.stringify(prepared)).not.toContain('Edited title');
  const metadata = { version: 1, wrappedKey: await wrapKey(key, 'test-password'), createdAt: new Date().toISOString() };
  for (const block of [prepared.workspace, prepared.exportSafeWorkspace]) {
    const source = JSON.stringify({ magic: 'UTM-LOCAL-ENCRYPTED', version: 1, metadata, workspace: block });
    const restored = await openLocalRecoveryReadOnly(source, 'test-password');
    expect(restored.document.items[item.id]?.title).toBe('Edited title');
    closeReadOnlyWorkspace(restored);
    expect((await decryptWorkspaceFile(source, 'test-password')).workspace.items[item.id]?.title).toBe('Edited title');
    await expect(openLocalRecoveryReadOnly(source, 'wrong')).rejects.toThrow();
  }
  Automerge.free(doc); key.fill(0);
});

it('rejects malformed and invalid snapshot data', () => {
  for (const text of ['UTM-RECOVERY-JSON-1\n{', 'UTM-RECOVERY-JSON-1\nnull', 'UTM-RECOVERY-JSON-1\n{}']) {
    expect(() => decodeLocalWorkspaceBinary(new TextEncoder().encode(text))).toThrow();
  }
});
