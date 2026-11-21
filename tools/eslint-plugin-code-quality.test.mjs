import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";
import plugin from "./eslint-plugin-code-quality.mjs";

RuleTester.describe = (name, run) => {
	void describe(name, run);
};
RuleTester.it = (name, run) => {
	void it(name, run);
};

new RuleTester().run("no-em-dash", plugin.rules["no-em-dash"], {
	valid: ['// a - b\nconst a = "a - b" + `a - b`;'],
	invalid: [
		{
			name: "in a string",
			code: `const a = "a \u2014 b";`,
			output: 'const a = "a - b";',
			errors: [{ messageId: "emDashInString" }],
		},
		{
			name: "in a template literal",
			code: `const a = \`a \u2014 \${1}\`;`,
			output: "const a = `a - ${1}`;",
			errors: [{ messageId: "emDashInString" }],
		},
		{
			name: "in a line comment and in a block comment",
			code: `// a \u2014 b\n/* a \u2014 b */\nlet a;`,
			output: "// a -- b\n/* a -- b */\nlet a;",
			errors: [{ messageId: "emDashInComment" }, { messageId: "emDashInComment" }],
		},
	],
});
