// obsidian stuff

export interface ResizableSidebarSplit {
	collapsed: boolean;
	size: number;
	containerEl: HTMLElement;
	setSize(size: number): void;
	expand(): void;
	collapse(): void;
}

// openaleph API

export interface OpenAlephSearchResults {
	next: string;
	results: OpenAlephEntity[];
}

export interface SearchJob {
	query: string;
	instances: OpenAlephInstanceSettings[];
}

export interface OpenAlephEntity {
	schema: string;
	dataset: string;
	caption: string;
	id: string;
	collection: OpenAlephCollection;
	properties?: Record<string, unknown[]>;
	[key: string]: unknown;
}

export interface OpenAlephCollection {
	category: string;
	label: string;
	links: OpenAlephCollectionLinks;
	count: number;
}

export interface OpenAlephCollectionLinks {
	reconcile: string;
	self: string;
	ui: string;
	xref_export: string;
}

// settings

export interface OpenAlephPluginSettings {
	importFolder: string;
	instances: OpenAlephInstanceSettings[];
	maxResultsPerInstance: number;
	queries: SavedQuery[];
}

export interface OpenAlephInstanceSettings {
	id: string;
	name: string;
	instanceUrl: string;
	apiKeyName: string;
	enabled: boolean;
	connectionValid: boolean;
}

// search view

export interface SavedQuery {
	query: string;
	instanceIds: string[];
}

export interface QueryGroup {
	id: string;
	query: string;
	instanceIds: Set<string>;
}

export interface QueryGroupEls {
	rowEl: HTMLElement;
	inputEl: HTMLInputElement;
	instanceButtonEl: HTMLButtonElement;
	instanceCountEl: HTMLElement;
	popoverEl: HTMLElement | null;
}

export interface AddQueryGroupOptions {
	focus: boolean;
	query?: string;
	instanceIds?: string[];
}

// TODO rename, storage

export interface ExplorationRecord {
	uuid: string;
	folderPath: string;
	jsonPath: string;
	tablePath: string;
}
