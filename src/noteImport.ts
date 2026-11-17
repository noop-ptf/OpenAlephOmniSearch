import { stringifyYaml, normalizePath } from 'obsidian';
import type OpenAlephPlugin from './main';
import { type OpenAlephEntity } from './types';
import { ensureFolder } from './storage';

// Too large or unstructured to be useful as notes; opened in OpenAleph instead.
// From https://github.com/noop-ptf/OpenAlephSearch/blob/3e1225caf087114381554e1b52df40f295887ebf/src/types.ts#L5
export const NON_IMPORTABLE_SCHEMATA: ReadonlySet<string> = new Set([
	'Article',
	'Audio',
	'Email',
	'File',
	'Folder',
	'HyperText',
	'Image',
	'Page',
	'Pages',
	'Table',
	'Video',
	'Workbook',
]);

export function isImportable(entity: OpenAlephEntity): boolean {
	return !NON_IMPORTABLE_SCHEMATA.has(entity.schema);
}

export function yamlifyEntity(entity: OpenAlephEntity): string {
	const flatEntity: Record<string, string | string[]> = {
		schema: entity.schema,
		id: entity.id,
	};
	for (const [k, v] of Object.entries(entity.properties ?? {})) {
		const strings = v.filter((x): x is string => typeof x === 'string');
		if (strings.length === 0) continue;
		flatEntity[k] = strings.length === 1 ? (strings[0] ?? '') : strings;
	}
	return `---\n${stringifyYaml(flatEntity)}---\n`;
}

function entityFolderPath(
	entity: OpenAlephEntity,
	ftmdFolder: string,
	instanceFolder: string,
): string {
	const dataset = entity.dataset ?? 'unknown';
	return normalizePath(`${ftmdFolder}/${instanceFolder}/${dataset}`);
}

/** Where `writeNote` will save the entity. */
export function entityNotePath(
	entity: OpenAlephEntity,
	ftmdFolder: string,
	instanceFolder: string,
): string {
	// / \ : are removed
	// * ? " < > | are rejected by Windows
	// # ^ [ ] | break Obsidian links
	const safeName =
		entity.caption.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || entity.id;
	const path = entityFolderPath(entity, ftmdFolder, instanceFolder);
	return normalizePath(`${path}/${safeName}.md`);
}

export async function writeNote(
	entity: OpenAlephEntity,
	ftmdFolder: string,
	instanceFolder: string,
	plugin: OpenAlephPlugin,
): Promise<void> {
	const path = entityFolderPath(entity, ftmdFolder, instanceFolder);
	const filePath = entityNotePath(entity, ftmdFolder, instanceFolder);
	const fileContent = yamlifyEntity(entity);

	await ensureFolder(plugin.app, path);

	const existingFile = plugin.app.vault.getFileByPath(filePath);
	const targetFile = existingFile
		? await plugin.app.vault
				.modify(existingFile, fileContent)
				.then(() => existingFile)
		: await plugin.app.vault.create(filePath, fileContent);

	const activeLeaf = plugin.app.workspace.getLeaf(false);

	await activeLeaf.openFile(targetFile, { state: { mode: 'source' } });
}
