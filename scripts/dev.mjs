// Start the whole app locally with one command: `npm run dev`, then open http://localhost:5173
//
// - installs dependencies on the first run (Python via uv, JavaScript via npm)
// - brings the database schema up to date (SQLite in data/, or Neon if .env.local has DATABASE_URL)
// - runs the FastAPI backend on :8020 (API_PORT) and the Vite frontend on :5173 (which forwards /api to the backend)
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = join(root, "backend");
const frontend = join(root, "frontend");
const isWindows = process.platform === "win32";

function findUv() {
  const candidates = [["uv"], ...(isWindows ? [["py", "-m", "uv"]] : []), ["python", "-m", "uv"], ["python3", "-m", "uv"]];
  for (const cmd of candidates) {
    const r = spawnSync(cmd[0], [...cmd.slice(1), "--version"], { stdio: "ignore" });
    if (r.status === 0) return cmd;
  }
  console.error("uv (the Python package manager) was not found. Install it with:\n  winget install astral-sh.uv\nor\n  py -m pip install uv");
  process.exit(1);
}

function run(cmd, args, cwd, shell = false) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

const uv = findUv();
if (!existsSync(join(backend, ".venv"))) {
  console.log("First run: installing the Python backend…");
  run(uv[0], [...uv.slice(1), "sync"], backend);
}
if (!existsSync(join(frontend, "node_modules"))) {
  console.log("First run: installing the frontend…");
  run("npm", ["ci", "--no-fund", "--no-audit"], frontend, isWindows); // npm is a .cmd script on Windows
}
run(uv[0], [...uv.slice(1), "run", "python", "-m", "dla", "migrate"], backend);

const children = [];
function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: "1", PYTHONIOENCODING: "utf-8" } });
  const prefix = name === "api" ? "\x1b[36m[api]\x1b[0m " : "\x1b[35m[web]\x1b[0m ";
  const forward = (stream, out) => stream.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) out.write(prefix + line + "\n");
  });
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}stopped (exit code ${code}).`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const apiPort = process.env.API_PORT ?? "8020";
// Watch only the app's own code: watching .venv makes the server restart in a loop.
start("api", uv[0], [...uv.slice(1), "run", "uvicorn", "main:app", "--port", apiPort, "--reload", "--reload-dir", "dla"],
  backend);
start("web", process.execPath, [join(frontend, "node_modules", "vite", "bin", "vite.js"), "--strictPort"], frontend);
console.log("\nOpen http://localhost:5173 (API docs: http://localhost:5173/api/docs). Press Ctrl+C to stop.\n");
