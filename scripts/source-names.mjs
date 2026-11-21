import ts from "typescript";

export const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

/**
 * The names in the code of a TypeScript source, string contents included. Comments and JSDoc
 * are left out: a name that only they mention is not a name the code has.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function sourceNames(source) {
	const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest);
	/** @type {string[]} */
	const names = [];
	/** @param {ts.Node} node */
	const visit = (node) => {
		if (ts.isJSDoc(node)) return;
		const children = node.getChildren(file);
		if (children.length === 0) names.push(...(node.getText(file).match(IDENTIFIER) ?? []));
		for (const child of children) visit(child);
	};
	visit(file);
	return names;
}
