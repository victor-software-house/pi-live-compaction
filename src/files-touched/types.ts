export type FileTouchOperation = 'read' | 'write' | 'edit' | 'move' | 'delete';

export interface FilesTouchedEntry {
	path: string;
	displayPath: string;
	operations: Set<FileTouchOperation>;
	lastTimestamp: number;
}

export type FileTrackingAction =
	| { kind: 'touch'; path: string; operation: FileTouchOperation }
	| { kind: 'move'; from: string; to: string };
