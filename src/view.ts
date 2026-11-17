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
	ChecklistOptions,
	CollapsibleOptions,
	InstanceSearchResults,
	OpenAlephEntity,
	OpenAlephInstanceSettings,
	OpenPopover,
	PopoverKind,
	QueryGroup,
	QueryGroupEls,
	QuerySearchResults,
	SavedQuery,
	SearchJob,
} from './types';
import { fetchNextPage, groupByCollection, search } from './requests';
import { ConfirmImportModal, ConfirmVisitModal, LoadingModal } from './modals';
import {
	entityNotePath,
	isImportable,
	writeNote,
	yamlifyEntity,
} from './noteImport';
import { SCHEMA_NAMES, SCHEMA_OPTIONS } from './schemata';

export const VIEW_TYPE_OPENALEPH_OMNISEARCH = 'openaleph-omnisearch-view';

// wait before writing queries to disk
const SAVE_DELAY_MS = 500;

export class OpenAlephOmniSearchView extends ItemView {
	private plugin: OpenAlephPlugin;
	private groups: QueryGroup[] = [];
	private groupEls = new Map<string, QueryGroupEls>();
	private listEl: HTMLElement | null = null;
	private resultsEl: HTMLElement | null = null;
	private openPopover: OpenPopover | null = null;
	private collapsed = new WeakSet<object>();

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

		this.registerDomEvent(searchEl, 'click', () => {
			void this.runSearch();
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

		this.resultsEl = wrapperEl.createDiv({ cls: 'openaleph-results-list' });

		this.restoreQueries();
	}

	async onClose(): Promise<void> {
		this.requestSave.run();
		this.closePopover();
		this.groupEls.clear();
		this.groups = [];
		this.listEl = null;
		this.resultsEl = null;
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

		this.rerenderOpenPopover();

		if (selectionChanged) {
			this.requestSave();
		}
	}

	private restoreQueries(): void {
		const enabledIds = new Set(this.getEnabledInstances().map((i) => i.id));
		const saved = this.plugin.settings.queries ?? [];

		for (const { query, instanceIds, schemata } of saved) {
			this.addGroup({
				focus: false,
				query,
				instanceIds: instanceIds.filter((id) => enabledIds.has(id)),
				schemata: schemata?.filter((name) => SCHEMA_NAMES.has(name)),
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
			schemata: [...g.schemata],
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
		schemata,
	}: AddQueryGroupOptions): void {
		const group: QueryGroup = {
			id: crypto.randomUUID(),
			query,
			instanceIds: new Set(
				instanceIds ?? this.getEnabledInstances().map((i) => i.id),
			),
			schemata: new Set(schemata ?? SCHEMA_NAMES),
		};
		this.groups.push(group);
		this.renderGroup(group);

		if (focus) {
			this.groupEls.get(group.id)?.inputEl.focus();
		}
	}

	private removeGroup(group: QueryGroup): void {
		if (this.openPopover?.groupId === group.id) {
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
		this.resultsEl?.empty();
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
			this.togglePopover(group, 'instances'),
		);

		const schemaButtonEl = this.createIconButton(
			rowEl,
			'list-filter',
			'Filter by schema type',
		);
		schemaButtonEl.addClass('openaleph-schema-button');
		schemaButtonEl.setAttr('aria-haspopup', 'true');
		schemaButtonEl.setAttr('aria-expanded', 'false');
		const schemaCountEl = schemaButtonEl.createSpan({
			cls: 'openaleph-schema-count',
		});
		schemaButtonEl.addEventListener('click', () =>
			this.togglePopover(group, 'schemata'),
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
			schemaButtonEl,
			schemaCountEl,
			popoverEl: null,
		});
		this.updateInstanceButton(group);
		this.updateSchemaButton(group);
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

	private updateSchemaButton(group: QueryGroup): void {
		const els = this.groupEls.get(group.id);
		if (!els) return;

		const selected = group.schemata.size;
		const total = SCHEMA_OPTIONS.length;
		const filtered = selected > 0 && selected < total;

		els.schemaCountEl.setText(selected === total ? '' : String(selected));
		els.schemaButtonEl.toggleClass('is-empty', selected === 0);
		els.schemaButtonEl.toggleClass('is-filtered', filtered);
		els.schemaButtonEl.setAttr(
			'aria-label',
			selected === 0
				? 'Filter by schema type (none selected)'
				: filtered
					? `Filter by schema type (${selected} of ${total} selected)`
					: 'Filter by schema type (all selected)',
		);
	}

	private popoverButton(
		els: QueryGroupEls,
		kind: PopoverKind,
	): HTMLButtonElement {
		return kind === 'instances' ? els.instanceButtonEl : els.schemaButtonEl;
	}

	private togglePopover(group: QueryGroup, kind: PopoverKind): void {
		const wasOpen =
			this.openPopover?.groupId === group.id &&
			this.openPopover.kind === kind;
		this.closePopover();
		if (!wasOpen) {
			this.showPopover(group, kind);
		}
	}

	private showPopover(group: QueryGroup, kind: PopoverKind): void {
		const els = this.groupEls.get(group.id);
		if (!els) return;

		const popoverEl = els.rowEl.createDiv({
			cls:
				kind === 'schemata'
					? 'openaleph-instance-popover openaleph-schema-popover'
					: 'openaleph-instance-popover',
			attr: {
				role: 'dialog',
				'aria-label':
					kind === 'schemata' ? 'Schema types' : 'Instances',
			},
		});
		els.popoverEl = popoverEl;
		const buttonEl = this.popoverButton(els, kind);
		buttonEl.addClass('is-active');
		buttonEl.setAttr('aria-expanded', 'true');
		this.openPopover = { groupId: group.id, kind };

		this.renderPopoverContents(group, kind, popoverEl);
	}

	private closePopover(): void {
		if (!this.openPopover) return;

		const els = this.groupEls.get(this.openPopover.groupId);
		if (els) {
			els.popoverEl?.remove();
			els.popoverEl = null;
			const buttonEl = this.popoverButton(els, this.openPopover.kind);
			buttonEl.removeClass('is-active');
			buttonEl.setAttr('aria-expanded', 'false');
		}
		this.openPopover = null;
	}

	private rerenderOpenPopover(): void {
		if (!this.openPopover) return;
		const { groupId, kind } = this.openPopover;
		const group = this.groups.find((g) => g.id === groupId);
		const popoverEl = this.groupEls.get(groupId)?.popoverEl;
		if (group && popoverEl) {
			this.renderPopoverContents(group, kind, popoverEl);
		}
	}

	private renderPopoverContents(
		group: QueryGroup,
		kind: PopoverKind,
		popoverEl: HTMLElement,
	): void {
		if (kind === 'schemata') {
			this.renderChecklist(popoverEl, {
				title: 'Schema types',
				options: SCHEMA_OPTIONS,
				selected: group.schemata,
				onChange: () => {
					this.updateSchemaButton(group);
					this.requestSave();
				},
			});
			return;
		}

		const enabled = this.getEnabledInstances();
		if (enabled.length === 0) {
			popoverEl.empty();
			popoverEl
				.createDiv({
					cls: 'openaleph-instance-popover-header',
				})
				.createSpan({
					cls: 'openaleph-instance-popover-title',
					text: 'Instances',
				});
			popoverEl.createDiv({
				cls: 'openaleph-instance-popover-empty',
				text: 'No instances are enabled. Add or enable one in the plugin settings.',
			});
			return;
		}

		this.renderChecklist(popoverEl, {
			title: 'Instances',
			options: enabled.map((instance) => ({
				id: instance.id,
				label: instance.name || 'Unnamed instance',
				detail: displayHost(instance.instanceUrl),
			})),
			selected: group.instanceIds,
			onChange: () => {
				this.updateInstanceButton(group);
				this.requestSave();
			},
		});
	}

	private renderChecklist(
		popoverEl: HTMLElement,
		{ title, options, selected, onChange }: ChecklistOptions,
	): void {
		popoverEl.empty();

		const headerEl = popoverEl.createDiv({
			cls: 'openaleph-instance-popover-header',
		});
		headerEl.createSpan({
			cls: 'openaleph-instance-popover-title',
			text: title,
		});
		const toggleAllEl = headerEl.createEl('button', {
			cls: 'openaleph-link-button',
			attr: { type: 'button' },
		});

		const listEl = popoverEl.createDiv({ cls: 'openaleph-instance-list' });
		const checkboxes = new Map<string, HTMLInputElement>();

		const allSelected = () => options.every((o) => selected.has(o.id));

		const sync = () => {
			toggleAllEl.setText(allSelected() ? 'Select none' : 'Select all');
			for (const [id, checkbox] of checkboxes) {
				checkbox.checked = selected.has(id);
			}
		};

		for (const option of options) {
			const optionEl = listEl.createEl('label', {
				cls: 'openaleph-instance-option',
			});
			const checkbox = optionEl.createEl('input', {
				attr: { type: 'checkbox' },
			});
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					selected.add(option.id);
				} else {
					selected.delete(option.id);
				}
				sync();
				onChange();
			});
			checkboxes.set(option.id, checkbox);

			const textEl = optionEl.createDiv({
				cls: 'openaleph-instance-option-text',
			});
			textEl.createDiv({
				cls: 'openaleph-instance-option-name',
				text: option.label,
			});
			if (option.detail) {
				textEl.createDiv({
					cls: 'openaleph-instance-option-url',
					text: option.detail,
				});
			}
		}

		toggleAllEl.addEventListener('click', () => {
			const wasAllSelected = allSelected();
			selected.clear();
			if (!wasAllSelected) {
				options.forEach((o) => selected.add(o.id));
			}
			sync();
			onChange();
		});

		sync();
	}

	private handleOutsidePointer(evt: PointerEvent): void {
		if (!this.openPopover) return;
		const els = this.groupEls.get(this.openPopover.groupId);
		const target = evt.target;
		if (
			els &&
			target instanceof Node &&
			(els.popoverEl?.contains(target) ||
				this.popoverButton(els, this.openPopover.kind).contains(target))
		) {
			return;
		}
		this.closePopover();
	}

	private handleKeydown(evt: KeyboardEvent): void {
		if (evt.key !== 'Escape' || !this.openPopover) return;
		const els = this.groupEls.get(this.openPopover.groupId);
		const buttonEl = els
			? this.popoverButton(els, this.openPopover.kind)
			: undefined;
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
			if (!query || instances.length === 0 || group.schemata.size === 0) {
				return [];
			}
			const schemata =
				group.schemata.size === SCHEMA_OPTIONS.length
					? []
					: [...group.schemata];
			return [{ query, instances, schemata }];
		});
	}

	private async runSearch(): Promise<void> {
		const jobs = this.buildSearchJobs();
		if (jobs.length === 0) {
			new Notice(
				'Enter a query and select at least one instance and schema type.',
			);
			return;
		}

		const loadingModal = new LoadingModal(this.app, 'Searching…');
		loadingModal.open();
		try {
			const results = await search(
				this.app,
				jobs,
				this.plugin.settings.maxResultsPerInstance,
			);
			this.renderResults(results);
		} catch (err: unknown) {
			new Notice(err instanceof Error ? err.message : String(err));
		} finally {
			loadingModal.close();
		}
	}

	private renderResults(results: QuerySearchResults[]): void {
		if (!this.resultsEl) return;
		this.resultsEl.empty();
		this.collapsed = new WeakSet();

		for (const queryResults of results) {
			this.renderQueryResults(this.resultsEl, queryResults);
		}
	}

	private renderQueryResults(
		parentEl: HTMLElement,
		results: QuerySearchResults,
	): void {
		const sectionEl = parentEl.createDiv({ cls: 'openaleph-results' });
		sectionEl.createDiv({
			cls: 'openaleph-results-query',
			text: results.query,
		});
		sectionEl.createDiv({
			cls: 'openaleph-results-total',
			text: `Found ${results.total} results`,
		});

		for (const instanceResults of results.instances) {
			if (instanceResults.collections.size === 0) continue;
			this.renderInstanceResults(sectionEl.createDiv(), instanceResults);
		}
	}

	private renderInstanceResults(
		containerEl: HTMLElement,
		results: InstanceSearchResults,
	): void {
		containerEl.empty();

		const bodyEl = this.createCollapsible(
			containerEl,
			results,
			results.instance.name || 'Unnamed instance',
			{ labelCls: 'openaleph-instance-name' },
		);

		for (const collection of results.collections.values()) {
			const itemEl = bodyEl
				.createDiv({ cls: 'search-results-children' })
				.createDiv({ cls: 'tree-item search-result' });

			const entitiesEl = this.createCollapsible(
				itemEl,
				collection,
				collection.label,
				{ flair: String(collection.entities.length) },
			);

			for (const entity of collection.entities) {
				this.renderEntity(entitiesEl, entity, results.instance);
			}
		}

		if (results.next) {
			const loadMoreEl = bodyEl.createEl('button', {
				cls: 'openaleph-load-more',
				text: 'Load more',
				attr: { type: 'button' },
			});
			loadMoreEl.addEventListener('click', () => {
				void this.loadMore(containerEl, results, loadMoreEl);
			});
		}
	}

	private async loadMore(
		containerEl: HTMLElement,
		results: InstanceSearchResults,
		buttonEl: HTMLButtonElement,
	): Promise<void> {
		if (!results.next) return;

		buttonEl.disabled = true;
		buttonEl.setText('Loading…');
		try {
			const page = await fetchNextPage(
				this.app,
				results.instance,
				results.next,
			);
			groupByCollection(page.results, results.collections);
			results.next = page.next;
			this.renderInstanceResults(containerEl, results);
		} catch (err: unknown) {
			new Notice(err instanceof Error ? err.message : String(err));
			buttonEl.disabled = false;
			buttonEl.setText('Load more');
		}
	}

	private renderEntity(
		parentEl: HTMLElement,
		entity: OpenAlephEntity,
		instance: OpenAlephInstanceSettings,
	): void {
		const matchesEl = parentEl.createDiv({
			cls: 'search-result-file-matches',
		});
		matchesEl.createDiv({ cls: 'openaleph-result-spacer' });

		const matchEl = matchesEl.createDiv({
			cls: 'search-result-file-match tappable',
		});
		matchEl.createDiv({
			cls: 'openaleph-result-title',
			text: entity.caption || 'Unknown',
		});
		matchEl.createDiv({
			cls: 'openaleph-result-snippet',
			text: entity.schema || 'Thing',
		});

		matchEl.addEventListener('click', () => {
			if (isImportable(entity)) {
				this.confirmImport(entity, instance);
			} else {
				this.confirmVisit(entity, instance);
			}
		});
	}

	private confirmVisit(
		entity: OpenAlephEntity,
		instance: OpenAlephInstanceSettings,
	): void {
		const url = entityUiUrl(entity, instance);

		new ConfirmVisitModal(
			this.app,
			entity.caption || 'Unknown',
			entity.schema,
			url,
			() => {
				window.open(url, '_blank');
			},
		).open();
	}

	private confirmImport(
		entity: OpenAlephEntity,
		instance: OpenAlephInstanceSettings,
	): void {
		const { importFolder } = this.plugin.settings;
		const instanceFolder = instanceHostname(instance);

		new ConfirmImportModal(
			this.app,
			entity.caption || 'Unknown',
			entityNotePath(entity, importFolder, instanceFolder),
			yamlifyEntity(entity),
			() => {
				writeNote(
					entity,
					importFolder,
					instanceFolder,
					this.plugin,
				).catch((err: unknown) => {
					new Notice(
						err instanceof Error ? err.message : String(err),
					);
				});
			},
		).open();
	}

	private createCollapsible(
		parentEl: HTMLElement,
		key: object,
		label: string,
		{ labelCls, flair }: CollapsibleOptions = {},
	): HTMLElement {
		const headerEl = parentEl.createDiv({
			cls: 'tree-item-self search-result-file-title is-clickable',
		});
		const iconEl = headerEl.createDiv({
			cls: 'tree-item-icon collapse-icon',
		});
		setIcon(iconEl, 'chevron-down');
		headerEl.createDiv({
			cls: labelCls ? `tree-item-inner ${labelCls}` : 'tree-item-inner',
			text: label,
		});
		if (flair !== undefined) {
			headerEl
				.createDiv({ cls: 'tree-item-flair-outer' })
				.createSpan({ cls: 'tree-item-flair', text: flair });
		}

		const bodyEl = parentEl.createDiv();

		const apply = () => {
			const isCollapsed = this.collapsed.has(key);
			iconEl.toggleClass('is-collapsed', isCollapsed);
			headerEl.setAttr('aria-expanded', String(!isCollapsed));
			bodyEl.toggle(!isCollapsed);
		};

		headerEl.addEventListener('click', () => {
			if (this.collapsed.has(key)) {
				this.collapsed.delete(key);
			} else {
				this.collapsed.add(key);
			}
			apply();
		});

		apply();
		return bodyEl;
	}
}

function entityUiUrl(
	entity: OpenAlephEntity,
	instance: OpenAlephInstanceSettings,
): string {
	if (entity.links?.ui) return entity.links.ui;
	return new URL(
		`/entities/${encodeURIComponent(entity.id)}`,
		instance.instanceUrl,
	).toString();
}

function instanceHostname(instance: OpenAlephInstanceSettings): string {
	try {
		return new URL(instance.instanceUrl).hostname;
	} catch {
		return instance.name || 'unknown';
	}
}

function displayHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
