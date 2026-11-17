import { defaultModel } from '@opensanctions/followthemoney';
import type { ChecklistOption } from './types';

// Every schema an entity can have, from the FollowTheMoney model, sorted by
// label. Abstract schemata (Thing, Interval…) are left out because no entity
// is ever of an abstract schema.
export const SCHEMA_OPTIONS: readonly ChecklistOption[] = Object.entries(
	defaultModel.schemata,
)
	.filter(([, schema]) => !schema.abstract)
	.map(([name, schema]) => ({ id: name, label: schema.label }))
	.sort((a, b) => a.label.localeCompare(b.label));

export const SCHEMA_NAMES: ReadonlySet<string> = new Set(
	SCHEMA_OPTIONS.map((s) => s.id),
);
