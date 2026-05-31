export class CompactionAbortedError extends Error {
	constructor() {
		super("Compaction aborted");
		this.name = "CompactionAbortedError";
	}
}

export function isAbortError(error: unknown): boolean {
	return error instanceof CompactionAbortedError;
}
