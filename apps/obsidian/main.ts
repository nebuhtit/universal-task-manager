import { ItemView, Modal, Notice, Plugin, WorkspaceLeaf } from 'obsidian';

const VIEW_TYPE_UNIVERSAL = 'universal-task-manager-view';
const WORKSPACE_PATH = '.universal/workspace.utmb';
const PREVIOUS_PATH = '.universal/workspace.previous.utmb';
const RECOVERY_PATH = '.universal/recovery';
type ReminderEntry = { id: string; itemId: string; title: string; body: string; at: string };
type WebMessage = { type: 'utm-obsidian:ready' } | { type: 'utm-obsidian:save'; id: string; source: string } | { type: 'utm-obsidian:reminders'; entries: ReminderEntry[] } | { type: 'utm-obsidian:flushed'; id: string; ok: boolean };

const validBackup = (source: string): boolean => {
  try { const value = JSON.parse(source) as { magic?: string; version?: number; metadata?: { wrappedKey?: unknown }; workspace?: { nonce?: string; ciphertext?: string } }; return value.magic === 'UTM-LOCAL-ENCRYPTED' && value.version === 1 && Boolean(value.metadata?.wrappedKey && value.workspace?.nonce && value.workspace.ciphertext); }
  catch { return false; }
};
async function digest(source: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

class ConflictModal extends Modal {
  constructor(private readonly plugin: UniversalTaskManagerPlugin, private readonly external: string) { super(plugin.app); }
  onOpen(): void {
    this.titleEl.setText('Universal workspace changed');
    this.contentEl.createEl('p', { text: 'Another device changed the encrypted workspace. Nothing has been overwritten.' });
    const actions = this.contentEl.createDiv({ cls: 'utm-conflict-actions' });
    actions.createEl('button', { text: 'Open vault version' }).onclick = () => { void this.plugin.useExternal(this.external); this.close(); };
    actions.createEl('button', { text: 'Keep local version' }).onclick = () => { void this.plugin.keepLocal(); this.close(); };
    actions.createEl('button', { text: 'Save both' }).onclick = () => { void this.plugin.saveBoth(this.external); this.close(); };
    actions.createEl('button', { text: 'Merge in Universal' }).onclick = () => { void this.plugin.saveBoth(this.external).then(() => new Notice('Both encrypted copies were preserved. Use Transfer → Merge in Universal; the password stays inside Universal.')); this.close(); };
  }
  onClose(): void { this.contentEl.empty(); }
}

class UniversalView extends ItemView {
  frame?: HTMLIFrameElement;
  constructor(leaf: WorkspaceLeaf, private readonly plugin: UniversalTaskManagerPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_UNIVERSAL; }
  getDisplayText(): string { return 'Universal Task Manager'; }
  getIcon(): string { return 'list-checks'; }
  async onOpen(): Promise<void> {
    const content = this.containerEl.children[1] as HTMLElement;
    content.empty(); content.addClass('utm-obsidian-view');
    this.frame = content.createEl('iframe', { cls: 'utm-obsidian-frame', attr: { title: 'Universal Task Manager', allow: 'clipboard-read; clipboard-write' } });
    this.frame.src = this.plugin.webAppUrl(); this.plugin.attachFrame(this.frame);
  }
  async onClose(): Promise<void> { if (this.frame) { await this.plugin.flushFrame(this.frame); this.plugin.detachFrame(this.frame); } (this.containerEl.children[1] as HTMLElement).empty(); }
}

export default class UniversalTaskManagerPlugin extends Plugin {
  private frames = new Set<HTMLIFrameElement>();
  private latestLocal?: string;
  private expectedHash?: string;
  private writing = false;
  private reminderTimer?: number;
  private flushRequests = new Map<string, () => void>();
  private messageHandler = (event: MessageEvent<WebMessage>) => { void this.handleMessage(event); };
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_UNIVERSAL, (leaf) => new UniversalView(leaf, this));
    this.addRibbonIcon('list-checks', 'Open Universal', () => void this.openUniversal());
    this.addCommand({ id: 'open-universal', name: 'Open Universal', callback: () => void this.openUniversal() });
    window.addEventListener('message', this.messageHandler); this.register(() => window.removeEventListener('message', this.messageHandler));
    this.registerEvent(this.app.vault.on('modify', (file) => { if (file.path === WORKSPACE_PATH) void this.detectExternalChange(); }));
    await this.ensureDirectories();
  }
  onunload(): void { if (this.reminderTimer !== undefined) window.clearTimeout(this.reminderTimer); this.app.workspace.detachLeavesOfType(VIEW_TYPE_UNIVERSAL); }
  attachFrame(frame: HTMLIFrameElement): void { this.frames.add(frame); }
  detachFrame(frame: HTMLIFrameElement): void { this.frames.delete(frame); }
  webAppUrl(): string { const directory = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`; return this.app.vault.adapter.getResourcePath(`${directory}/web/index.html`); }
  private post(message: unknown, frame?: HTMLIFrameElement): void { if (frame) frame.contentWindow?.postMessage(message, '*'); else this.frames.forEach((entry) => entry.contentWindow?.postMessage(message, '*')); }
  private async handleMessage(event: MessageEvent<WebMessage>): Promise<void> {
    const frame = [...this.frames].find((candidate) => candidate.contentWindow === event.source); if (!frame || !event.data?.type) return;
    if (event.data.type === 'utm-obsidian:ready') {
      const source = await this.readWorkspace(); if (source) { this.latestLocal = source; this.expectedHash = await digest(source); }
      this.post({ type: 'utm-obsidian:workspace', ...(source ? { source } : {}) }, frame);
    } else if (event.data.type === 'utm-obsidian:flushed') {
      this.flushRequests.get(event.data.id)?.(); this.flushRequests.delete(event.data.id);
    } else if (event.data.type === 'utm-obsidian:save') {
      try { await this.safeWrite(event.data.source); this.latestLocal = event.data.source; this.post({ type: 'utm-obsidian:saved', id: event.data.id, ok: true }, frame); }
      catch (reason) { this.post({ type: 'utm-obsidian:saved', id: event.data.id, ok: false, error: reason instanceof Error ? reason.message : String(reason) }, frame); }
    } else this.scheduleReminders(event.data.entries);
  }
  async flushFrame(frame: HTMLIFrameElement): Promise<void> {
    const id = `flush-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => { this.flushRequests.delete(id); resolve(); }, 2_000);
      this.flushRequests.set(id, () => { window.clearTimeout(timeout); resolve(); });
      this.post({ type: 'utm-obsidian:flush', id }, frame);
    });
  }
  private async ensureDirectories(): Promise<void> { for (const path of ['.universal', RECOVERY_PATH]) if (!(await this.app.vault.adapter.exists(path))) await this.app.vault.adapter.mkdir(path); }
  private async readWorkspace(): Promise<string | undefined> { if (!(await this.app.vault.adapter.exists(WORKSPACE_PATH))) return undefined; const source = await this.app.vault.adapter.read(WORKSPACE_PATH); if (!validBackup(source)) throw new Error('Vault workspace is not a valid encrypted Universal backup'); return source; }
  private async safeWrite(source: string, force = false): Promise<void> {
    if (!validBackup(source)) throw new Error('Universal refused an invalid encrypted backup'); await this.ensureDirectories();
    if (!force && await this.app.vault.adapter.exists(WORKSPACE_PATH)) { const current = await this.app.vault.adapter.read(WORKSPACE_PATH); if (this.expectedHash && await digest(current) !== this.expectedHash) { new ConflictModal(this, current).open(); throw new Error('Vault conflict requires a choice'); } }
    const temporary = `.universal/.workspace-${Date.now()}.tmp`; this.writing = true;
    try {
      await this.app.vault.adapter.write(temporary, source);
      const verified = await this.app.vault.adapter.read(temporary); if (verified !== source || !validBackup(verified)) { await this.app.vault.adapter.remove(temporary); throw new Error('Temporary encrypted backup verification failed'); }
      if (await this.app.vault.adapter.exists(PREVIOUS_PATH)) await this.app.vault.adapter.remove(PREVIOUS_PATH);
      if (await this.app.vault.adapter.exists(WORKSPACE_PATH)) await this.app.vault.adapter.rename(WORKSPACE_PATH, PREVIOUS_PATH);
      this.expectedHash = await digest(source);
      await this.app.vault.adapter.rename(temporary, WORKSPACE_PATH);
    } finally { this.writing = false; }
  }
  private async detectExternalChange(): Promise<void> { if (this.writing) return; const source = await this.readWorkspace(); if (!source || await digest(source) === this.expectedHash) return; new ConflictModal(this, source).open(); }
  async useExternal(source: string): Promise<void> { this.latestLocal = source; this.expectedHash = await digest(source); this.frames.forEach((frame) => { frame.src = this.webAppUrl(); }); }
  async keepLocal(): Promise<void> { if (this.latestLocal) await this.safeWrite(this.latestLocal, true); }
  async saveBoth(external: string): Promise<void> { await this.ensureDirectories(); const stamp = new Date().toISOString().replace(/[:.]/g, '-'); await this.app.vault.adapter.write(`${RECOVERY_PATH}/workspace-external-${stamp}.utmb`, external); if (this.latestLocal) await this.app.vault.adapter.write(`${RECOVERY_PATH}/workspace-local-${stamp}.utmb`, this.latestLocal); new Notice('Both encrypted Universal workspaces were saved in .universal/recovery.'); }
  private scheduleReminders(entries: ReminderEntry[]): void {
    if (this.reminderTimer !== undefined) window.clearTimeout(this.reminderTimer);
    const next = entries.filter((entry) => Date.parse(entry.at) > Date.now()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]; if (!next) return;
    this.reminderTimer = window.setTimeout(() => { const fragment = document.createDocumentFragment(); fragment.createEl('strong', { text: next.title }); fragment.createEl('div', { text: next.body }); const open = fragment.createEl('button', { text: 'Open item' }); open.onclick = () => { void this.openUniversal().then(() => this.post({ type: 'utm-obsidian:open-item', itemId: next.itemId })); }; new Notice(fragment, 0); this.scheduleReminders(entries.filter((entry) => entry.id !== next.id)); }, Math.min(Date.parse(next.at) - Date.now(), 2_147_000_000));
  }
  private async openUniversal(): Promise<void> { const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_UNIVERSAL)[0]; const leaf = existing ?? this.app.workspace.getLeaf('tab'); if (!existing) await leaf.setViewState({ type: VIEW_TYPE_UNIVERSAL, active: true }); await this.app.workspace.revealLeaf(leaf); }
}
