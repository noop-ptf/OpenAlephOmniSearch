import {
	Debouncer,
	ItemView,
	SearchComponent,
	WorkspaceLeaf,
	debounce,
	setIcon,
	Notice,
} from 'obsidian';
import type OpenAlephPlugin from './main';
import type {
	AddQueryGroupOptions,
	OpenAlephInstanceSettings,
	QueryGroup,
	QueryGroupEls,
	SavedQuery,
	SearchJob,
} from './types';
import { search } from './requests';

export const VIEW_TYPE_OPENALEPH_OMNISEARCH = 'openaleph-omnisearch-view';

// wait before writing queries to disk
const SAVE_DELAY_MS = 500;

export class OpenAlephOmniSearchView extends ItemView {
	private plugin: OpenAlephPlugin;
	private groups: QueryGroup[] = [];
	private groupEls = new Map<string, QueryGroupEls>();
	private listEl: HTMLElement | null = null;
	private openPopoverGroupId: string | null = null;

	private requestSave: Debouncer<[], void> = debounce(
		() => this.saveQueries(),
		SAVE_DELAY_MS,
		true,
	);

	constructor(leaf: WorkspaceLeaf, plugin: OpenAlephPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_OPENALEPH_OMNISEARCH;
	}

	getDisplayText(): string {
		return 'Federated OpenAleph omnisearch';
	}

	getIcon(): string {
		return 'cone';
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('openaleph-omnisearch-view');

		const wrapperEl = container.createDiv({ cls: 'openaleph-omnisearch' });
		this.listEl = wrapperEl.createDiv({ cls: 'openaleph-query-list' });

		const actionsEl = wrapperEl.createDiv({ cls: 'openaleph-actions' });

		const newQueryEl = this.createTextButton(
			actionsEl,
			'plus',
			'New query',
			'openaleph-new-query',
		);
		this.registerDomEvent(newQueryEl, 'click', () => {
			this.addGroup({ focus: true });
			this.requestSave();
		});

		const searchEl = this.createTextButton(
			actionsEl,
			'search',
			'Search',
			'mod-cta openaleph-search-button',
		);

		this.registerDomEvent(searchEl, 'click', async () => {
			const jobs = this.buildSearchJobs();
			if (jobs.length === 0) {
				new Notice('Enter a query and select at least one instance.');
				return;
			}
			const results = await search(
				this.app,
				jobs,
				this.plugin.settings.maxResultsPerInstance,
			).catch((err: unknown) => {
				new Notice(err instanceof Error ? err.message : String(err));
			});
		});

		const clearAllEl = this.createTextButton(
			actionsEl,
			'eraser',
			'Clear all',
			'openaleph-clear-all',
		);
		this.registerDomEvent(clearAllEl, 'click', () => this.clearAll());

		// close the dropdown on outside click or ESC
		const doc = container.ownerDocument;
		this.registerDomEvent(doc, 'pointerdown', (evt) =>
			this.handleOutsidePointer(evt),
		);
		this.registerDomEvent(doc, 'keydown', (evt) => this.handleKeydown(evt));

		this.restoreQueries();
	}

	async onClose(): Promise<void> {
		this.requestSave.run();
		this.closePopover();
		this.groupEls.clear();
		this.groups = [];
		this.listEl = null;
		this.contentEl.empty();
	}

	public onInstancesChanged(): void {
		const enabledIds = new Set(this.getEnabledInstances().map((i) => i.id));
		let selectionChanged = false;

		for (const group of this.groups) {
			for (const id of group.instanceIds) {
				if (!enabledIds.has(id)) {
					group.instanceIds.delete(id);
					selectionChanged = true;
				}
			}
			this.updateInstanceButton(group);
		}

		const openGroup = this.groups.find(
			(g) => g.id === this.openPopoverGroupId,
		);
		const popoverEl = openGroup
			? this.groupEls.get(openGroup.id)?.popoverEl
			: null;
		if (openGroup && popoverEl) {
			this.renderPopoverContents(openGroup, popoverEl);
		}

		if (selectionChanged) {
			this.requestSave();
		}
	}

	private restoreQueries(): void {
		const enabledIds = new Set(this.getEnabledInstances().map((i) => i.id));
		const saved = this.plugin.settings.queries ?? [];

		for (const { query, instanceIds } of saved) {
			this.addGroup({
				focus: false,
				query,
				instanceIds: instanceIds.filter((id) => enabledIds.has(id)),
			});
		}

		if (this.groups.length === 0) {
			this.addGroup({ focus: false });
		}
	}

	private saveQueries(): void {
		const queries: SavedQuery[] = this.groups.map((g) => ({
			query: g.query,
			instanceIds: [...g.instanceIds],
		}));
		this.plugin.saveQueries(queries).catch((err: unknown) => {
			console.error('OpenAleph: could not save queries', err);
		});
	}

	private getEnabledInstances(): OpenAlephInstanceSettings[] {
		return this.plugin.settings.instances.filter((i) => i.enabled);
	}

	private addGroup({
		focus,
		query = '',
		instanceIds,
	}: AddQueryGroupOptions): void {
		const group: QueryGroup = {
			id: crypto.randomUUID(),
			query,
			instanceIds: new Set(
				instanceIds ?? this.getEnabledInstances().map((i) => i.id),
			),
		};
		this.groups.push(group);
		this.renderGroup(group);

		if (focus) {
			this.groupEls.get(group.id)?.inputEl.focus();
		}
	}

	private removeGroup(group: QueryGroup): void {
		if (this.openPopoverGroupId === group.id) {
			this.closePopover();
		}
		this.groupEls.get(group.id)?.rowEl.remove();
		this.groupEls.delete(group.id);
		this.groups = this.groups.filter((g) => g.id !== group.id);
		this.requestSave();
	}

	private clearAll(): void {
		this.closePopover();
		this.groupEls.clear();
		this.groups = [];
		this.listEl?.empty();
		this.addGroup({ focus: true });
		this.requestSave();
	}

	private renderGroup(group: QueryGroup): void {
		if (!this.listEl) return;

		const rowEl = this.listEl.createDiv({ cls: 'openaleph-query-group' });

		const search = new SearchComponent(rowEl)
			.setPlaceholder('Search OpenAleph…')
			.setValue(group.query)
			.onChange((value) => {
				group.query = value;
				this.requestSave();
			});
		search.inputEl.setAttr('aria-label', 'Search query');

		const instanceButtonEl = this.createIconButton(
			rowEl,
			'server',
			'Select instances',
		);
		instanceButtonEl.addClass('openaleph-instance-button');
		instanceButtonEl.setAttr('aria-haspopup', 'true');
		instanceButtonEl.setAttr('aria-expanded', 'false');
		const instanceCountEl = instanceButtonEl.createSpan({
			cls: 'openaleph-instance-count',
		});
		instanceButtonEl.addEventListener('click', () =>
			this.togglePopover(group),
		);

		const deleteButtonEl = this.createIconButton(
			rowEl,
			'trash-2',
			'Remove query',
		);
		deleteButtonEl.addClass('openaleph-delete-button');
		deleteButtonEl.addEventListener('click', () => this.removeGroup(group));

		this.groupEls.set(group.id, {
			rowEl,
			inputEl: search.inputEl,
			instanceButtonEl,
			instanceCountEl,
			popoverEl: null,
		});
		this.updateInstanceButton(group);
	}

	private createIconButton(
		parentEl: HTMLElement,
		icon: string,
		label: string,
	): HTMLButtonElement {
		const buttonEl = parentEl.createEl('button', {
			cls: 'clickable-icon openaleph-icon-button',
			attr: { type: 'button', 'aria-label': label },
		});
		setIcon(buttonEl, icon);
		return buttonEl;
	}

	private createTextButton(
		parentEl: HTMLElement,
		icon: string,
		text: string,
		cls: string,
	): HTMLButtonElement {
		const buttonEl = parentEl.createEl('button', {
			cls: `openaleph-action-button ${cls}`,
			attr: { type: 'button' },
		});
		setIcon(buttonEl.createSpan({ cls: 'openaleph-action-icon' }), icon);
		buttonEl.createSpan({ text });
		return buttonEl;
	}

	private updateInstanceButton(group: QueryGroup): void {
		const els = this.groupEls.get(group.id);
		if (!els) return;

		const selected = group.instanceIds.size;
		const total = this.getEnabledInstances().length;

		els.instanceCountEl.setText(String(selected));
		els.instanceButtonEl.toggleClass('is-empty', selected === 0);
		els.instanceButtonEl.setAttr(
			'aria-label',
			selected === 0
				? 'Select instances (none selected)'
				: `Select instances (${selected} of ${total} selected)`,
		);
	}

	private togglePopover(group: QueryGroup): void {
		const wasOpen = this.openPopoverGroupId === group.id;
		this.closePopover();
		if (!wasOpen) {
			this.openPopover(group);
		}
	}

	private openPopover(group: QueryGroup): void {
		const els = this.groupEls.get(group.id);
		if (!els) return;

		const popoverEl = els.rowEl.createDiv({
			cls: 'openaleph-instance-popover',
			attr: { role: 'dialog', 'aria-label': 'Instances' },
		});
		els.popoverEl = popoverEl;
		els.instanceButtonEl.addClass('is-active');
		els.instanceButtonEl.setAttr('aria-expanded', 'true');
		this.openPopoverGroupId = group.id;

		this.renderPopoverContents(group, popoverEl);
	}

	private closePopover(): void {
		if (!this.openPopoverGroupId) return;

		const els = this.groupEls.get(this.openPopoverGroupId);
		if (els) {
			els.popoverEl?.remove();
			els.popoverEl = null;
			els.instanceButtonEl.removeClass('is-active');
			els.instanceButtonEl.setAttr('aria-expanded', 'false');
		}
		this.openPopoverGroupId = null;
	}

	private renderPopoverContents(
		group: QueryGroup,
		popoverEl: HTMLElement,
	): void {
		popoverEl.empty();
		const enabled = this.getEnabledInstances();

		const headerEl = popoverEl.createDiv({
			cls: 'openaleph-instance-popover-header',
		});
		headerEl.createSpan({
			cls: 'openaleph-instance-popover-title',
			text: 'Instances',
		});

		if (enabled.length === 0) {
			popoverEl.createDiv({
				cls: 'openaleph-instance-popover-empty',
				text: 'No instances are enabled. Add or enable one in the plugin settings.',
			});
			return;
		}

		const toggleAllEl = headerEl.createEl('button', {
			cls: 'openaleph-link-button',
			attr: { type: 'button' },
		});

		const listEl = popoverEl.createDiv({ cls: 'openaleph-instance-list' });
		const checkboxes = new Map<string, HTMLInputElement>();

		const sync = () => {
			const allSelected = enabled.every((i) =>
				group.instanceIds.has(i.id),
			);
			toggleAllEl.setText(allSelected ? 'Select none' : 'Select all');
			for (const [id, checkbox] of checkboxes) {
				checkbox.checked = group.instanceIds.has(id);
			}
			this.updateInstanceButton(group);
		};

		for (const instance of enabled) {
			const optionEl = listEl.createEl('label', {
				cls: 'openaleph-instance-option',
			});
			const checkbox = optionEl.createEl('input', {
				attr: { type: 'checkbox' },
			});
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					group.instanceIds.add(instance.id);
				} else {
					group.instanceIds.delete(instance.id);
				}
				sync();
				this.requestSave();
			});
			checkboxes.set(instance.id, checkbox);

			const textEl = optionEl.createDiv({
				cls: 'openaleph-instance-option-text',
			});
			textEl.createDiv({
				cls: 'openaleph-instance-option-name',
				text: instance.name || 'Unnamed instance',
			});
			textEl.createDiv({
				cls: 'openaleph-instance-option-url',
				text: displayHost(instance.instanceUrl),
			});
		}

		toggleAllEl.addEventListener('click', () => {
			const allSelected = enabled.every((i) =>
				group.instanceIds.has(i.id),
			);
			group.instanceIds.clear();
			if (!allSelected) {
				enabled.forEach((i) => group.instanceIds.add(i.id));
			}
			sync();
			this.requestSave();
		});

		sync();
	}

	private handleOutsidePointer(evt: PointerEvent): void {
		if (!this.openPopoverGroupId) return;
		const els = this.groupEls.get(this.openPopoverGroupId);
		const target = evt.target;
		if (
			els &&
			target instanceof Node &&
			(els.popoverEl?.contains(target) ||
				els.instanceButtonEl.contains(target))
		) {
			return;
		}
		this.closePopover();
	}

	private handleKeydown(evt: KeyboardEvent): void {
		if (evt.key !== 'Escape' || !this.openPopoverGroupId) return;
		const buttonEl = this.groupEls.get(
			this.openPopoverGroupId,
		)?.instanceButtonEl;
		this.closePopover();
		buttonEl?.focus();
	}

	private buildSearchJobs(): SearchJob[] {
		const enabled = new Map(
			this.getEnabledInstances().map((i) => [i.id, i]),
		);

		return this.groups.flatMap((group) => {
			const query = group.query.trim();
			const instances = [...group.instanceIds].flatMap(
				(id) => enabled.get(id) ?? [],
			);
			return query && instances.length > 0 ? [{ query, instances }] : [];
		});
	}
}

function displayHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
