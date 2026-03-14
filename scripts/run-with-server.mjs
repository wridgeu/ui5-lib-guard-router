import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_TIMEOUT_MS = 120000;

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

async function runNpmScript(script) {
	const child = spawnNpmScript(script);
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

async function main() {
	const readyUrl = getOption("--ready-url");
	const serverScript = getOption("--server-script");
	const testScript = getOption("--test-script");
	const timeoutMs = process.argv.includes("--timeout-ms") ? Number(getOption("--timeout-ms")) : DEFAULT_TIMEOUT_MS;

	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error("Invalid --timeout-ms value");
	}

	const server = spawnNpmScript(serverScript, {
		detached: process.platform !== "win32",
	});

	try {
		await waitForUrl(readyUrl, timeoutMs, serverScript, server);
		await runNpmScript(testScript);
	} finally {
		await stopServer(server);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
