// Run uv in backend/ whether it is installed as a program (`uv`) or as a Python module (`py -m uv`).
// Usage: node scripts/uv.mjs run pytest
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function findUv() {
  const candidates = [["uv"], ...(process.platform === "win32" ? [["py", "-m", "uv"]] : []), ["python", "-m", "uv"], ["python3", "-m", "uv"]];
  return candidates.find((c) => spawnSync(c[0], [...c.slice(1), "--version"], { stdio: "ignore" }).status === 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const uv = findUv();
  if (!uv) {
    console.error("uv was not found. Install it with: winget install astral-sh.uv");
    process.exit(1);
  }
  const backend = join(dirname(fileURLToPath(import.meta.url)), "..", "backend");
  const r = spawnSync(uv[0], [...uv.slice(1), ...process.argv.slice(2)], {
    cwd: backend,
    stdio: "inherit",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  process.exit(r.status ?? 1);
}
