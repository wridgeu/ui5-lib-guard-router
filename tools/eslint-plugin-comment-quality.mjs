/**
 * Custom oxlint JS plugin that detects low-quality AI-generated comments.
 *
 * Rules use AST correlation (comparing comment text against adjacent code
 * identifiers) rather than broad regex, keeping false-positive rates low.
 * All rules are warn-only (no auto-fix) so the developer decides whether
 * to rewrite the comment or remove it.
 *
 * @see https://oxc.rs/docs/guide/usage/linter/writing-js-plugins
 */

// ── Shared helpers ──

/**
 * Directives and keeper patterns that must never be flagged, regardless
 * of what the rest of the comment text looks like.
 */
const KEEPER_RE =
	/(?:^|\s)(?:TODO|FIXME|HACK|BUG|NOTE|SAFETY|PERF|IMPORTANT|XXX|LICENSE|COPYRIGHT|eslint-disable|eslint-enable|@ts-ignore|@ts-expect-error|@ts-nocheck|@ts-check|@type|@param|@returns?|@throws|@see|@example|@deprecated|@override|@internal|@public|@private|@protected|@readonly|@satisfies|istanbul\s+ignore|c8\s+ignore|vitest)/i;

/**
 * Words that signal a comment is explaining *why*, not *what*.
 * If any of these appear, the comment is likely valuable.
 */
const EXPLAINS_WHY_RE =
	/\b(?:because|since|so\s+that|in\s+order\s+to|otherwise|workaround|intentional(?:ly)?|deliberate(?:ly)?|required\s+by|needed\s+(?:for|because|by|to)|must\s+be|cannot|can't|won't|shouldn't|NB|caveat|edge\s+case|race\s+condition|perf|optimization|compat(?:ibility)?|legacy|regression|upstream|downstream|spec\s+(?:says|requires)|RFC|per\s+(?:the\s+)?(?:spec|docs?|standard))\b/i;

/**
 * Returns the trimmed text of a comment node, collapsing whitespace.
 */
function commentText(node) {
	return node.value
		.replace(/^\s*\*\s?/gm, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Collects all Identifier names reachable from a node (shallow, max 1 level
 * of nesting). Used to extract the "vocabulary" of a code statement.
 */
function collectIdentifiers(node) {
	const ids = new Set();
	if (!node) return ids;

	function walk(n, depth) {
		if (!n || depth > 3) return;
		if (n.type === "Identifier") {
			ids.add(n.name.toLowerCase());
			return;
		}
		for (const key of Object.keys(n)) {
			if (key === "parent" || key === "type") continue;
			const child = n[key];
			if (Array.isArray(child)) {
				for (const item of child) {
					if (item && typeof item.type === "string") walk(item, depth + 1);
				}
			} else if (child && typeof child.type === "string") {
				walk(child, depth + 1);
			}
		}
	}

	walk(node, 0);
	return ids;
}

/**
 * Splits a comment into lowercase "words" (strips non-alpha).
 */
function commentWords(text) {
	return text
		.toLowerCase()
		.replace(/[^a-z\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2);
}

/**
 * Noise words that don't count as meaningful content when checking
 * whether a comment just restates code identifiers.
 */
const FILLER_WORDS = new Set([
	"the",
	"this",
	"that",
	"for",
	"from",
	"into",
	"with",
	"and",
	"then",
	"here",
	"new",
	"our",
	"its",
	"will",
	"now",
	"value",
	"result",
	"data",
	"item",
	"items",
	"each",
	"all",
	"above",
	"below",
]);

// ── Rules ──

/**
 * Flags single-line comments that just restate the adjacent code using
 * the same identifiers. Uses AST correlation: extracts identifier names
 * from the next statement and checks if the comment only contains those
 * names plus filler words.
 *
 * Skips JSDoc (block comments starting with `*`), multi-sentence
 * comments, and comments containing "why" explanations.
 */
const noObviousComment = {
	meta: {
		type: "suggestion",
		docs: {
			description: "Disallow comments that just restate the adjacent code",
		},
		messages: {
			noObviousComment: "Comment restates the code. Remove it or explain *why*, not *what*.",
		},
		schema: [],
	},
	create(context) {
		return {
			Program(programNode) {
				const comments = context.sourceCode.getAllComments();
				const body = programNode.body;
				if (!body?.length) return;

				for (const comment of comments) {
					// Only check line comments (skip JSDoc / block comments)
					if (comment.type !== "Line") continue;
					if (KEEPER_RE.test(comment.value)) continue;

					const text = commentText(comment);

					// Skip multi-sentence or long comments (likely explanatory)
					if (text.length > 80 || /[.!?]\s+[A-Z]/.test(text)) continue;

					// Skip comments that explain "why"
					if (EXPLAINS_WHY_RE.test(text)) continue;

					// Find the next statement after this comment
					const nextNode = body.find((n) => n.start > comment.end);
					if (!nextNode) continue;

					// Collect identifier names from the next statement
					const codeIds = collectIdentifiers(nextNode);
					if (codeIds.size === 0) continue;

					// Check: does the comment ONLY contain code identifiers + filler?
					const words = commentWords(text);
					if (words.length < 2) continue;

					const meaningful = words.filter((w) => !FILLER_WORDS.has(w));
					if (meaningful.length === 0) continue;

					const overlap = meaningful.filter((w) => codeIds.has(w));
					const ratio = overlap.length / meaningful.length;

					// If 80%+ of meaningful words are just code identifiers, it's obvious
					if (ratio >= 0.8) {
						context.report({ node: comment, messageId: "noObviousComment" });
					}
				}
			},
		};
	},
};

/**
 * Flags preamble comments like "This function/method/class handles..."
 * that just narrate the declaration without adding insight.
 *
 * Uses a focused regex: requires "This <thing> <verb>" structure.
 */
const NARRATOR_RE =
	/^\s*this\s+(?:function|method|class|component|hook|module|handler|helper|utility|service|controller|provider|manager|resolver|wrapper|plugin|factory)\s+(?:is\s+(?:responsible\s+for|used\s+(?:to|for))|(?:will|should|can)\s+(?:handle|create|process|manage|return|generate|provide)|handles|creates|initializes|processes|manages|controls|provides|returns|generates|validates|renders|transforms|computes)/i;

const noNarratorComment = {
	meta: {
		type: "suggestion",
		docs: {
			description: 'Disallow "This function/method handles..." preamble comments',
		},
		messages: {
			noNarratorComment: 'Narrating comment ("This function handles..."). Remove it or explain the *why*.',
		},
		schema: [],
	},
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (comment.type === "Block") continue;
					if (KEEPER_RE.test(comment.value)) continue;
					const text = commentText(comment);
					if (EXPLAINS_WHY_RE.test(text)) continue;
					if (NARRATOR_RE.test(text)) {
						context.report({ node: comment, messageId: "noNarratorComment" });
					}
				}
			},
		};
	},
};

/**
 * Flags decorative section-divider comments made of repeated symbols
 * or labelled banners like `// --- Helpers ---`.
 */
const SECTION_DIVIDER_RE = /^\s*[-=*#~_/\\]{3,}\s*(?:\w[\w\s]*\s*[-=*#~_/\\]*)?$/;

const noSectionDivider = {
	meta: {
		type: "suggestion",
		docs: {
			description: "Disallow decorative section-divider comments",
		},
		messages: {
			noSectionDivider:
				"Decorative divider comment. Use code structure (modules, functions) to organize instead.",
		},
		schema: [],
	},
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (KEEPER_RE.test(comment.value)) continue;
					const text = commentText(comment);
					if (text.length < 4) continue;
					if (SECTION_DIVIDER_RE.test(text)) {
						context.report({ node: comment, messageId: "noSectionDivider" });
					}
				}
			},
		};
	},
};

/**
 * Flags placeholder comments indicating incomplete or omitted code.
 */
const PLACEHOLDER_RE =
	/(?:\.{3}\s*(?:rest|more|other|remaining|additional)|omitted\s+for\s+brevity|replace\s+(?:this|the\s+above)\s+with|your\s+(?:actual|real)\s+(?:implementation|code|logic)|add\s+(?:your|the\s+rest)\s+(?:implementation|code|logic)|implement\s+(?:this|here)|not\s+yet\s+implemented)/i;

const noPlaceholderComment = {
	meta: {
		type: "problem",
		docs: {
			description: "Disallow placeholder comments indicating incomplete code",
		},
		messages: {
			noPlaceholderComment: "Placeholder comment suggests incomplete code. Implement or remove.",
		},
		schema: [],
	},
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (KEEPER_RE.test(comment.value)) continue;
					const text = commentText(comment);
					if (PLACEHOLDER_RE.test(text)) {
						context.report({ node: comment, messageId: "noPlaceholderComment" });
					}
				}
			},
		};
	},
};

/**
 * Flags hedging language that signals low-confidence AI generation.
 * Only matches unambiguously uncertain phrases; "should work" is excluded
 * since it commonly means "is expected to work" in test comments.
 */
const HEDGING_RE =
	/(?:hopefully|probably\s+(?:fine|works?|correct|ok|okay)|not\s+sure\s+(?:if|why|whether|about)|i\s+think\s+this|good\s+enough\s+for\s+now|fix\s+(?:this\s+)?later|quick\s+(?:hack|fix|workaround)|temporary\s+(?:fix|hack|workaround|solution))/i;

const noHedgingComment = {
	meta: {
		type: "suggestion",
		docs: {
			description: "Disallow hedging language in comments that signals uncertainty",
		},
		messages: {
			noHedgingComment:
				"Comment contains hedging language. Verify the code works and rewrite or remove the comment.",
		},
		schema: [],
	},
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					// Skip line comments that are keeper directives
					if (KEEPER_RE.test(comment.value)) continue;
					// Skip JSDoc / block comments (they often cite examples)
					if (comment.type === "Block") continue;
					const text = commentText(comment);
					if (HEDGING_RE.test(text)) {
						context.report({ node: comment, messageId: "noHedgingComment" });
					}
				}
			},
		};
	},
};

/**
 * Flags em-dashes (U+2014) in comments.
 *
 * The sibling `code-quality/no-em-dash-in-string` catches string literals;
 * this rule covers comments, which are the other common entry point for
 * AI-generated text. Auto-fix replaces with `--`.
 */
// Built at runtime so the rule source itself does not contain the character.
const EM_DASH_CHAR = String.fromCodePoint(0x2014);
const EM_DASH_COMMENT_RE = new RegExp(EM_DASH_CHAR, "g");

const noEmDashInComment = {
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: {
			description: "Disallow em-dashes in comments",
		},
		messages: {
			noEmDashInComment: "Comment contains an em-dash (U+2014). Use -- instead.",
		},
		schema: [],
	},
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (!comment.value.includes(EM_DASH_CHAR)) continue;
					context.report({
						node: comment,
						messageId: "noEmDashInComment",
						fix(fixer) {
							const prefix = comment.type === "Line" ? "//" : "/*";
							const suffix = comment.type === "Line" ? "" : "*/";
							const fixed = comment.value.replace(EM_DASH_COMMENT_RE, "--");
							return fixer.replaceTextRange(comment.range, `${prefix}${fixed}${suffix}`);
						},
					});
				}
			},
		};
	},
};

/** @type {import('eslint').ESLint.Plugin} */
export default {
	meta: { name: "comment-quality" },
	rules: {
		"no-obvious-comment": noObviousComment,
		"no-narrator-comment": noNarratorComment,
		"no-section-divider": noSectionDivider,
		"no-placeholder-comment": noPlaceholderComment,
		"no-hedging-comment": noHedgingComment,
		"no-em-dash-in-comment": noEmDashInComment,
	},
};
