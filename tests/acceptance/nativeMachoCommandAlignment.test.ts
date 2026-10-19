import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { machoLoadCommands } from "../fixtures/machoLoadCommands.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

for (const [command, operation] of [
  ["inspect-go-binary", "inspect_go_binary"],
  ["inspect-rust-binary", "inspect_rust_binary"],
] as const)
  cliTest(
    `${command} rejects misaligned 64-bit commands through CLI and stdio MCP`,
    async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-macho-command-alignment-",
      );
      const { client, call } = await connectLocalToolsMcp();
      for (const [bits, sizes, valid] of [
        [64, [12], false],
        [64, [8, 12, 12], false],
        [64, [8, 16], true],
        [32, [8, 12], true],
      ] as const) {
        const bytes = machoLoadCommands(bits, sizes);
        const path = join(root, `${bits}-${sizes.join("-")}.macho`);
        await writeFile(path, bytes);
        const result = await cli.run({ arguments: [command, path, "--json"] });
        const response = await call(operation, { path });
        if (valid) {
          expect(result.exitCode, result.stdout + result.stderr).toBe(0);
          const evidence = toolContract(operation).outputSchema.parse(
            result.json,
          );
          expect(evidence.normalized_result).toMatchObject({
            format: "macho",
            bits,
            byte_order: "little",
            ...(operation === "inspect_go_binary"
              ? { build_info: null }
              : { auditable_metadata: null, rustc_commit: null }),
          });
          expect(response.isError, JSON.stringify(response)).not.toBe(true);
          expect(response.structuredContent).toEqual(evidence);
        } else {
          const expected = {
            code: "invalid_request",
            details: {
              operation,
              issues: [{ path: ["path"], reason: "invalid_format" }],
            },
          };
          expect(result.exitCode, result.stdout).toBe(1);
          expect(result.json).toMatchObject(expected);
          expect(result.json).not.toHaveProperty("normalized_result");
          expect(parseMcpToolError(response).error).toMatchObject(expected);
        }
        expect(await readFile(path)).toEqual(bytes);
      }
      await client.ping();
    },
    30000,
  );
