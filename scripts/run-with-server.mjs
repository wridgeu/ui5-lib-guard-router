import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_TIMEOUT_MS = 120000;
const SIGNAL_EXIT_CODES = {
	SIGINT: 130,
	SIGTERM: 143,
};

let activeServer = null;
let stopActiveServerPromise = null;

function getOption(name) {
	const index = process.argv.indexOf(name);
	if (index === -1 || index + 1 >= process.argv.length) {
		throw new Error(`Missing ${name}`);
	}
	return process.argv[index + 1];
}

function npmArgs() {
	if (!process.env.npm_execpath) {
		throw new Error("npm_execpath is not set. Run this script via npm.");
	}

	return [process.execPath, [process.env.npm_execpath]];
}

function waitForExit(child) {
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			resolve({ code, signal });
		});
	});
}

function spawnNpmScript(script, extra = {}) {
	const [command, args] = npmArgs();

	return spawn(command, [...args, "run", script], {
		cwd: process.cwd(),
		shell: false,
		stdio: "inherit",
		...extra,
	});
}

async function runNpmScript(script, extra = {}) {
	const child = spawnNpmScript(script, extra);
	const { code, signal } = await waitForExit(child);
	if (code !== 0) {
		throw new Error(`npm run ${script} exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`);
	}
}

async function waitForUrl(url, timeoutMs, serverScript, server) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (server.exitCode !== null) {
			throw new Error(`npm run ${serverScript} exited before ${url} was ready`);
		}

		try {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(2000),
			});
			if (response.ok) {
				return;
			}
		} catch {}

		await delay(1000);
	}

	throw new Error(`Timed out waiting for ${url}`);
}

async function stopServer(server) {
	if (!server.pid || server.exitCode !== null) {
		return;
	}

	if (process.platform === "win32") {
		const child = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
			stdio: "ignore",
		});
		await new Promise((resolve) => {
			child.once("exit", resolve);
			child.once("error", resolve);
		});
		return;
	}

	try {
		process.kill(-server.pid, "SIGTERM");
	} catch {
		return;
	}

	await Promise.race([waitForExit(server).catch(() => undefined), delay(5000)]);

	if (server.exitCode === null) {
		try {
			process.kill(-server.pid, "SIGKILL");
		} catch {}
		await Promise.race([waitForExit(server).catch(() => undefined), delay(1000)]);
	}
}

async function stopActiveServer() {
	if (!activeServer) {
		return;
	}

	if (!stopActiveServerPromise) {
		stopActiveServerPromise = stopServer(activeServer).finally(() => {
			activeServer = null;
			stopActiveServerPromise = null;
		});
	}

	await stopActiveServerPromise;
}

function registerSignalHandlers() {
	const stopAndExit = (signal) => {
		void stopActiveServer().finally(() => {
			process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
		});
	};

	process.once("SIGINT", () => {
		stopAndExit("SIGINT");
	});
	process.once("SIGTERM", () => {
		stopAndExit("SIGTERM");
	});
}

async function main() {
	registerSignalHandlers();

	const readyUrl = getOption("--ready-url");
	const serverScript = getOption("--server-script");
	const testScript = getOption("--test-script");
	const testBaseUrl = process.argv.includes("--test-base-url") ? getOption("--test-base-url") : null;
	const timeoutMs = process.argv.includes("--timeout-ms") ? Number(getOption("--timeout-ms")) : DEFAULT_TIMEOUT_MS;

	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error("Invalid --timeout-ms value");
	}

	activeServer = spawnNpmScript(serverScript, {
		detached: process.platform !== "win32",
	});

	try {
		await waitForUrl(readyUrl, timeoutMs, serverScript, activeServer);
		await runNpmScript(testScript, {
			env: {
				...process.env,
				...(testBaseUrl ? { UI5_TEST_BASE_URL: testBaseUrl } : {}),
			},
		});
	} finally {
		await stopActiveServer();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
