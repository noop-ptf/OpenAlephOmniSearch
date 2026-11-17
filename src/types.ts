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
	total: number;
	next: string | null;
	results: OpenAlephEntity[];
}

export interface SearchJob {
	query: string;
	instances: OpenAlephInstanceSettings[];
	schemata: string[];
}

export interface OpenAlephEntity {
	schema: string;
	dataset: string;
	caption: string;
	id: string;
	collection: OpenAlephCollection;
	links?: OpenAlephEntityLinks;
	properties?: Record<string, unknown[]>;
	[key: string]: unknown;
}

export interface OpenAlephEntityLinks {
	self: string;
	ui: string;
	expand?: string;
}

export interface OpenAlephCollection {
	id: string;
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
	schemata?: string[];
}

export interface QueryGroup {
	id: string;
	query: string;
	instanceIds: Set<string>;
	schemata: Set<string>;
}

export interface QueryGroupEls {
	rowEl: HTMLElement;
	inputEl: HTMLInputElement;
	instanceButtonEl: HTMLButtonElement;
	instanceCountEl: HTMLElement;
	schemaButtonEl: HTMLButtonElement;
	schemaCountEl: HTMLElement;
	popoverEl: HTMLElement | null;
}

export interface AddQueryGroupOptions {
	focus: boolean;
	query?: string;
	instanceIds?: string[];
	schemata?: string[];
}

export type PopoverKind = 'instances' | 'schemata';

export interface OpenPopover {
	groupId: string;
	kind: PopoverKind;
}

export interface ChecklistOption {
	id: string;
	label: string;
	detail?: string;
}

export interface ChecklistOptions {
	title: string;
	options: readonly ChecklistOption[];
	selected: Set<string>;
	onChange: () => void;
}

// search results

export interface CollectionResults {
	id: string;
	label: string;
	entities: OpenAlephEntity[];
}

export interface InstanceSearchResults {
	instance: OpenAlephInstanceSettings;
	total: number;
	next: string | null;
	collections: Map<string, CollectionResults>;
}

export interface QuerySearchResults {
	query: string;
	total: number;
	instances: InstanceSearchResults[];
}

export interface CollapsibleOptions {
	labelCls?: string;
	flair?: string;
}

// TODO rename, storage

export interface ExplorationRecord {
	uuid: string;
	folderPath: string;
	jsonPath: string;
	tablePath: string;
}
