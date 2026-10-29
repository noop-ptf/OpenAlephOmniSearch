import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import {
	DEFAULT_MAX_RESULTS_PER_INSTANCE,
	DEFAULT_SETTINGS,
	OpenAlephSettingTab,
	isValidMaxResults,
} from './settings';
import {
	OpenAlephPluginSettings,
	ResizableSidebarSplit,
	SavedQuery,
} from './types';
import {
	VIEW_TYPE_OPENALEPH_OMNISEARCH,
	OpenAlephOmniSearchView,
} from './view';

export default class OpenAlephPlugin extends Plugin {
	settings!: OpenAlephPluginSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_OPENALEPH_OMNISEARCH,
			(leaf) => new OpenAlephOmniSearchView(leaf, this),
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (
					leaf?.view.getViewType() === VIEW_TYPE_OPENALEPH_OMNISEARCH
				) {
					this.ensureMinSidebarWidth();
				}
			}),
		);

		this.addRibbonIcon(
			'cone',
			'OpenAleph Omnisearch',
			(_evt: MouseEvent) => {
				this.activateView().catch((err: unknown) => {
					const message =
						err instanceof Error ? err.message : String(err);
					new Notice(message);
				});
			},
		);

		this.addCommand({
			id: 'omnisearch-openaleph-instances',
			name: 'Open OmniSearch view',
			callback: () => this.activateView(),
		});

		this.addSettingTab(new OpenAlephSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<OpenAlephPluginSettings>,
		);

		if (!isValidMaxResults(this.settings.maxResultsPerInstance)) {
			this.settings.maxResultsPerInstance =
				DEFAULT_MAX_RESULTS_PER_INSTANCE;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.notifyViewsOfSettingsChange();
	}

	async saveQueries(queries: SavedQuery[]): Promise<void> {
		this.settings.queries = queries;
		await this.saveData(this.settings);
	}

	private notifyViewsOfSettingsChange(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_OPENALEPH_OMNISEARCH,
		)) {
			if (leaf.view instanceof OpenAlephOmniSearchView) {
				leaf.view.onInstancesChanged();
			}
		}
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null =
			workspace.getLeavesOfType(VIEW_TYPE_OPENALEPH_OMNISEARCH)[0] ??
			null;

		if (!leaf) {
			leaf = workspace.getLeftLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({
				type: VIEW_TYPE_OPENALEPH_OMNISEARCH,
				active: true,
			});
		}

		const leftSplit =
			workspace.leftSplit as unknown as ResizableSidebarSplit;

		if (leftSplit?.collapsed) {
			leftSplit.expand();
		}

		await workspace.revealLeaf(leaf);

		this.ensureMinSidebarWidth();
	}

	private ensureMinSidebarWidth(): void {
		const leftSplit = this.app.workspace
			.leftSplit as unknown as ResizableSidebarSplit;
		// setSize is deduced from decompiled Obsidian code, not in the official docs
		// https://forum.obsidian.md/t/change-left-sidebar-width/80126/4
		if (!leftSplit || typeof leftSplit.setSize !== 'function') return;

		const MIN_WIDTH = 300;
		const containerEl: HTMLElement | undefined = leftSplit.containerEl;

		const applyWidth = () => {
			const currentWidth =
				containerEl?.getBoundingClientRect().width ?? 0;
			if (currentWidth < MIN_WIDTH) {
				leftSplit.setSize(MIN_WIDTH);
			}
		};

		if (leftSplit.collapsed) {
			leftSplit.expand();
		}

		if (!containerEl) {
			applyWidth();
			return;
		}

		// `transitioned` CSS event: https://developer.mozilla.org/en-US/docs/Web/API/Element/transitionend_event
		let done = false;
		const onTransitionEnd = () => {
			if (done) return;
			done = true;
			containerEl.removeEventListener('transitionend', onTransitionEnd);
			applyWidth();
		};

		containerEl.addEventListener('transitionend', onTransitionEnd);

		window.setTimeout(() => {
			if (!done) {
				done = true;
				containerEl.removeEventListener(
					'transitionend',
					onTransitionEnd,
				);
				applyWidth();
			}
		}, 250);
	}
}
