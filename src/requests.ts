import { App, Notice, requestUrl } from 'obsidian';
import {
	CollectionResults,
	InstanceSearchResults,
	OpenAlephEntity,
	OpenAlephInstanceSettings,
	OpenAlephSearchResults,
	QuerySearchResults,
	SearchJob,
} from './types';

export async function getEntity(
	id: string,
	instance: OpenAlephInstanceSettings,
	app: App,
): Promise<OpenAlephEntity> {
	const apiKey = app.secretStorage.getSecret(instance.apiKeyName);

	if (!apiKey || apiKey.trim() === '') {
		throw new Error(`API key for ${instance.instanceUrl} is empty.`);
	}

	const url = new URL(
		`/api/2/entities/${encodeURIComponent(id)}`,
		instance.instanceUrl,
	);

	const headers: Record<string, string> = {
		'User-Agent': 'alephclient',
		Authorization: apiKey,
		Pragma: 'no-cache',
	};

	const res = await requestUrl({
		url: url.toString(),
		method: 'GET',
		contentType: 'application/json',
		headers,
	});

	const body = res.json as unknown;
	return body as OpenAlephEntity;
}

function searchHeaders(
	app: App,
	instance: OpenAlephInstanceSettings,
): Record<string, string> {
	const apiKey = app.secretStorage.getSecret(instance.apiKeyName);

	const headers: Record<string, string> = {
		'User-Agent': 'alephclient',
		Pragma: 'no-cache',
	};

	if (apiKey && apiKey.trim() !== '') {
		headers['Authorization'] = apiKey;
	}

	return headers;
}

async function requestSearchPage(
	url: URL,
	headers: Record<string, string>,
): Promise<OpenAlephSearchResults> {
	const res = await requestUrl({
		url: url.toString(),
		method: 'GET',
		contentType: 'application/json',
		headers,
	});
	return res.json as OpenAlephSearchResults;
}

async function searchInstance(
	app: App,
	query: string,
	instance: OpenAlephInstanceSettings,
	maxResultsPerInstance: number,
	schemata: string[],
): Promise<OpenAlephSearchResults> {
	const headers = searchHeaders(app, instance);

	// searchParams.set() encodes the value itself
	const firstUrl = new URL('/api/2/search', instance.instanceUrl);
	firstUrl.searchParams.set('q', query);

	// one parameter per schema; the instance matches any of them.
	// `next` links keep these, so "Load more" stays filtered too.
	for (const schema of schemata) {
		firstUrl.searchParams.append('filter:schema', schema);
	}

	if (maxResultsPerInstance > 0) {
		firstUrl.searchParams.set('limit', String(maxResultsPerInstance));
	}

	const firstRes = await requestSearchPage(firstUrl, headers);

	const results = [...firstRes.results];
	let next = firstRes.next;

	// 0 means no limit: follow `next` until the last page
	while (
		next &&
		(maxResultsPerInstance === 0 || results.length < maxResultsPerInstance)
	) {
		try {
			const nextRes = await requestSearchPage(
				new URL(next, instance.instanceUrl),
				headers,
			);

			const numResultsLeft =
				maxResultsPerInstance === 0
					? Infinity
					: maxResultsPerInstance - results.length;
			results.push(...nextRes.results.slice(0, numResultsLeft));
			next = nextRes.next;
		} catch (e) {
			console.warn(
				`Search pagination for ${instance.instanceUrl} stopped early:`,
				e,
			);
			break;
		}
	}

	return { total: firstRes.total, next, results };
}

export async function fetchNextPage(
	app: App,
	instance: OpenAlephInstanceSettings,
	next: string,
): Promise<OpenAlephSearchResults> {
	return requestSearchPage(
		new URL(next, instance.instanceUrl),
		searchHeaders(app, instance),
	);
}

export function groupByCollection(
	entities: OpenAlephEntity[],
	existing: Map<string, CollectionResults> = new Map(),
): Map<string, CollectionResults> {
	for (const entity of entities) {
		const { id, label } = entity.collection;
		let collection = existing.get(id);
		if (!collection) {
			collection = { id, label, entities: [] };
			existing.set(id, collection);
		}
		collection.entities.push(entity);
	}
	return existing;
}

async function searchInstanceGrouped(
	app: App,
	query: string,
	instance: OpenAlephInstanceSettings,
	maxResultsPerInstance: number,
	schemata: string[],
): Promise<InstanceSearchResults | null> {
	try {
		const res = await searchInstance(
			app,
			query,
			instance,
			maxResultsPerInstance,
			schemata,
		);
		return {
			instance,
			total: res.total,
			next: res.next,
			collections: groupByCollection(res.results),
		};
	} catch (err: unknown) {
		console.warn(`Search failed for ${instance.instanceUrl}:`, err);
		new Notice(
			`Search for "${query}" failed on "${instance.name}". Skipping this instance.`,
		);
		return null;
	}
}

export async function search(
	app: App,
	jobs: SearchJob[],
	maxResultsPerInstance: number,
): Promise<QuerySearchResults[]> {
	return Promise.all(
		jobs.map(async (job): Promise<QuerySearchResults> => {
			const answered = await Promise.all(
				job.instances.map((instance) =>
					searchInstanceGrouped(
						app,
						job.query,
						instance,
						maxResultsPerInstance,
						job.schemata,
					),
				),
			);
			const instances = answered.filter(
				(r): r is InstanceSearchResults => r !== null,
			);
			const total = instances.reduce((sum, r) => sum + r.total, 0);
			return { query: job.query, total, instances };
		}),
	);
}
