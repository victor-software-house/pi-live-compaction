/**
 * Pins the two operator-level UX preferences:
 *
 *   - defaultPanelScope: "global" by default
 *   - inheritSessionModel: false by default
 *
 * Both round-trip through parseConfig and validate aggressively.
 */

import { describe, expect, it } from "vitest";

import {
	DEFAULT_CONFIG,
	parseConfig,
} from "../extensions/live-compaction/config";

describe("config defaults", () => {
	it("ships defaultPanelScope='global' and inheritSessionModel=false", () => {
		expect(DEFAULT_CONFIG.defaultPanelScope).toBe("global");
		expect(DEFAULT_CONFIG.inheritSessionModel).toBe(false);
	});

	it("parses an empty config and fills in the defaults", () => {
		const parsed = parseConfig({});
		expect(parsed.defaultPanelScope).toBe("global");
		expect(parsed.inheritSessionModel).toBe(false);
	});

	it("accepts every valid defaultPanelScope value", () => {
		for (const value of ["global", "project"] as const) {
			const parsed = parseConfig({ defaultPanelScope: value });
			expect(parsed.defaultPanelScope).toBe(value);
		}
	});

	it("folds the legacy 'auto' value onto 'project'", () => {
		const parsed = parseConfig({ defaultPanelScope: "auto" });
		expect(parsed.defaultPanelScope).toBe("project");
	});

	it("rejects invalid defaultPanelScope values", () => {
		expect(() => parseConfig({ defaultPanelScope: "nope" })).toThrowError(
			/defaultPanelScope/,
		);
		expect(() => parseConfig({ defaultPanelScope: 5 })).toThrowError(
			/defaultPanelScope/,
		);
	});

	it("accepts inheritSessionModel boolean and rejects non-booleans", () => {
		expect(parseConfig({ inheritSessionModel: true }).inheritSessionModel).toBe(
			true,
		);
		expect(parseConfig({ inheritSessionModel: false }).inheritSessionModel).toBe(
			false,
		);
		expect(() => parseConfig({ inheritSessionModel: "yes" })).toThrowError(
			/inheritSessionModel/,
		);
	});
});
