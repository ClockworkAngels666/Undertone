// Backend for end-to-end tests: a fresh SQLite database with fictional demo data, on API_PORT (default 8021).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backend = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend");
const dbFile = join(backend, "..", "data", "e2e.sqlite3");
const port = process.env.API_PORT ?? "8021";
const env = {
  ...process.env,
  DATABASE_URL: `sqlite:///${dbFile.replace(/\\/g, "/")}`,
  DLA_IGNORE_ENV_FILE: "1",
  PYTHONIOENCODING: "utf-8",
};

const candidates = [["uv"], ...(process.platform === "win32" ? [["py", "-m", "uv"]] : []), ["python", "-m", "uv"]];
const uv = candidates.find((c) => spawnSync(c[0], [...c.slice(1), "--version"], { stdio: "ignore" }).status === 0);
if (!uv) throw new Error("uv not found");

mkdirSync(dirname(dbFile), { recursive: true });
rmSync(dbFile, { force: true });
for (const args of [["migrate"], ["seed-demo"]]) {
  const r = spawnSync(uv[0], [...uv.slice(1), "run", "python", "-m", "dla", ...args], { cwd: backend, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const server = spawn(uv[0], [...uv.slice(1), "run", "uvicorn", "main:app", "--port", port], { cwd: backend, env, stdio: "inherit" });
const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
