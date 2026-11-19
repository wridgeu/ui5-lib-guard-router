import suite from "./testsuite.qunit";
import { loadModule } from "./testHelpers";

const QUNIT_FOLDER = "test-resources/ui5/guard/router/qunit";

/**
 * Loads the files of the test page that the URL names, one after the other. Given a list of
 * modules, the test starter loads them in parallel, so their tests would be registered in the
 * order the files arrive. The starter starts QUnit once the exported promise has resolved.
 */
async function loadPage(): Promise<void> {
	const name = new URLSearchParams(window.location.search).get("test") ?? "";
	const page = suite.tests[name];
	if (!page) throw new Error(`Test page "${name}" is not registered in testsuite.qunit.ts`);
	for (const file of page.files) {
		await loadModule(`${QUNIT_FOLDER}/${name}/${file}.qunit`);
	}
}

export default loadPage();
