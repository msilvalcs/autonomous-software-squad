import { execFileSync } from "node:child_process";

execFileSync("npm", ["run", "test:unit"], {
  stdio: "inherit"
});

if (process.env.RUN_E2E === "true") {
  execFileSync("npm", ["run", "test:e2e"], {
    stdio: "inherit"
  });
}
