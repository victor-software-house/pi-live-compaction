import { SYSTEM_PROMPT } from '@live-compaction/summary';
import { describe, expect, it } from 'vitest';

describe('SYSTEM_PROMPT', () => {
	it('keeps non-overridable carry-forward invariants in system scope', () => {
		expect(SYSTEM_PROMPT).toContain(
			'will not see `<previous-summary>`, `<discarded-conversation>`, `<files-touched>`, or `<focus>` as separate blocks',
		);
		expect(SYSTEM_PROMPT).toContain('only durable carrier');
		expect(SYSTEM_PROMPT).toContain('Never point the continuation agent at transient block names');
		expect(SYSTEM_PROMPT).toContain('per `<focus>`');
		expect(SYSTEM_PROMPT).toContain('preserve that goal in the summary text');
		expect(SYSTEM_PROMPT).toContain('Use section headings from the prompt contract exactly');
		expect(SYSTEM_PROMPT).toContain('do not rename them or add parenthetical qualifiers');
		expect(SYSTEM_PROMPT).toContain('dense chronological synthesis of major asks');
		expect(SYSTEM_PROMPT).toContain(
			'Preserve user messages from `<discarded-conversation>` with higher fidelity',
		);
		expect(SYSTEM_PROMPT).toContain('discarded messages are replaced by this summary');
	});
});
