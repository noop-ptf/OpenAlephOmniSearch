import { App, requestUrl } from 'obsidian';
import {
	OpenAlephEntity,
	SearchJob,
	OpenAlephInstanceSettings,
	OpenAlephSearchResults,
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

async function searchInstance(
	app: App,
	query: string,
	instance: OpenAlephInstanceSettings,
	maxResultsPerInstance: number,
) {
	const apiKey = app.secretStorage.getSecret(instance.apiKeyName);

	if (!apiKey || apiKey.trim() === '') {
		throw new Error(`API key for ${instance.instanceUrl} is empty.`);
	}

	const firstUrl = new URL(`/api/2/search`, instance.instanceUrl);
	firstUrl.searchParams.set('q', encodeURIComponent(query));

	if (maxResultsPerInstance > 0) {
		firstUrl.searchParams.set(
			'limit',
			encodeURIComponent(maxResultsPerInstance),
		);
	}

	const headers: Record<string, string> = {
		'User-Agent': 'alephclient',
		Authorization: apiKey,
		Pragma: 'no-cache',
	};

	const res = await requestUrl({
		url: firstUrl.toString(),
		method: 'GET',
		contentType: 'application/json',
		headers,
	});

	const firstRes = res.json as OpenAlephSearchResults;

	const results = [...firstRes.results];
	let next = firstRes.next;

	while (next) {
		try {
			const nextUrl = new URL(next, instance.instanceUrl);

			const res = await requestUrl({
				url: nextUrl.toString(),
				method: 'GET',
				contentType: 'application/json',
				headers,
			});

			const nextRes = res.json as unknown as OpenAlephSearchResults;

			const numResultsLeft = maxResultsPerInstance - results.length;
			if (nextRes.results.length > numResultsLeft) {
				results.push(...nextRes.results.slice(0, numResultsLeft));
				break;
			}

			results.push(...nextRes.results);
			next = nextRes.next;
		} catch (e) {
			console.warn(
				`Search pagination for ${instance.instanceUrl} stopped early:`,
				e,
			);
			break;
		}
	}

	return results;
}

export async function search(
	app: App,
	jobs: SearchJob[],
	maxResultsPerInstance: number,
) {
	for (const job of jobs) {
		const results = [];
		for (const enabledInstance of job.instances) {
			const result = await searchInstance(
				app,
				job.query,
				enabledInstance,
				maxResultsPerInstance,
			);
			results.push(...result);
		}
	}
}
