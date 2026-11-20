export function normalizeNavContainerToArgs(args: unknown[], targetPageId: string): unknown[] {
	return args.map((arg, index) => {
		if (index === 0 && arg === targetPageId) {
			return "<target-page>";
		}
		return arg;
	});
}

export function cloneJson(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value));
}
