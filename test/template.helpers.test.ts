/**
 * Targeted tests for the Liquid filters and {% xml %} block tag we add on
 * top of stock Liquid. Each helper is exercised through a real
 * `loadCompactionTemplate` round-trip so registration, parsing, and
 * rendering all stay green.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	buildRenderVars,
	loadCompactionTemplate,
} from "../extensions/live-compaction/template";

async function withTemplate(body: string): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), "gc-helpers-"));
	const templatePath = path.join(dir, "compaction-prompt.md");
	await writeFile(templatePath, body, "utf8");
	const tpl = await loadCompactionTemplate(templatePath);
	if (!tpl) throw new Error("template did not load");
	return tpl
		.render(
			buildRenderVars({
				discardedText: "[User]: hello",
				keptTailText: "[User]: now do X",
				discardedMessages: [
					{
						role: "user",
						content: [{ type: "text", text: "old ask" }],
					} as never,
				],
				keptTailMessages: [
					{
						role: "user",
						content: [{ type: "text", text: "now do X" }],
					} as never,
				],
				focusText: undefined,
			}),
		)
		.trim();
}

describe("custom liquid filters", () => {
	it("text filter pulls plain text from a Pi Message", async () => {
		const out = await withTemplate(
			"{{ kept_tail_messages | first | text }}",
		);
		expect(out).toBe("now do X");
	});

	it("last_user_text returns the newest user text across groups", async () => {
		const out = await withTemplate(
			"{{ kept_tail_messages | last_user_text: discarded_messages }}",
		);
		expect(out).toBe("now do X");
	});

	it("tokens estimates chars/4", async () => {
		const out = await withTemplate("{{ discarded | tokens }}");
		// "[User]: hello" = 13 chars → ceil(13/4) = 4
		expect(out).toBe("4");
	});

	it("quote escapes `\"` and trims", async () => {
		const out = await withTemplate(
			'{{ "  he said \\"hi\\"  " | quote }}',
		);
		expect(out).toBe('"he said \\"hi\\""');
	});

	it("present is true for non-empty strings, false for empty/missing", async () => {
		expect(
			await withTemplate(
				"{% if discarded | present %}yes{% else %}no{% endif %}",
			),
		).toBe("yes");
		expect(
			await withTemplate(
				"{% if focus | present %}yes{% else %}no{% endif %}",
			),
		).toBe("no");
	});
});

describe("{% xml %} block tag", () => {
	it("wraps the body in <tag>…</tag>", async () => {
		const out = await withTemplate(
			"{% xml \"focus\" %}body content{% endxml %}",
		);
		expect(out).toBe("<focus>\nbody content\n</focus>");
	});

	it("emits nothing when the body renders empty", async () => {
		const out = await withTemplate(
			"{% xml \"focus\" %}{{ focus }}{% endxml %}",
		);
		expect(out).toBe("");
	});

	it("rejects malformed tag arguments at parse time", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "gc-xml-bad-"));
		const templatePath = path.join(dir, "compaction-prompt.md");
		await writeFile(
			templatePath,
			"{% xml not-quoted %}body{% endxml %}",
			"utf8",
		);
		await expect(loadCompactionTemplate(templatePath)).rejects.toThrow(
			/xml/,
		);
	});
});
