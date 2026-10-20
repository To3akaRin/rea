import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { nativeDispatchMetadataResultSchema } from "../../../src/domain/native/objcSwiftMetadata.js";
import { machoWithPropertyAttributes } from "../../fixtures/objcPropertyMacho.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";
import { openProductionTarget } from "../../support/mcp/productionSession.js";

const evidenceSchema = z.object({
  normalized_result: nativeDispatchMetadataResultSchema,
});

cliTest(
  "CLI and MCP do not infer an ObjC superclass from text or unknown bind types",
  async ({ cli, onTestFinished }) => {
    const directory = await createTestTempDirectory("rea-legacy-bind-types-");
    const mcp = createTestMcp();
    onTestFinished(() => mcp.close());
    for (const type of [1, 2, 3, 15]) {
      const bytes = machoWithPropertyAttributes("Tq,N");
      // One ordinary segment and an LC_DYLD_INFO_ONLY bind stream. The bind
      // location is Fixture's superclass slot. Its stored bytes deliberately
      // point at a real class record, so losing fixup ownership would invent
      // a local superclass even after rejecting the external bind symbol.
      bytes.writeBigUInt64LE(0x100000200n, 0x208);
      bytes.writeUInt32LE(2, 16);
      bytes.writeUInt32LE(200, 20);
      bytes.writeUInt32LE(0x80000022, 184);
      bytes.writeUInt32LE(48, 188);
      const stream = Buffer.from([
        0x11,
        0x40,
        ...Buffer.from("_OBJC_CLASS_$_NSObject\0"),
        0x50 | type,
        0x70,
        0x88,
        0x04,
        0x90,
        0x00,
      ]);
      bytes.writeUInt32LE(0xc00, 200);
      bytes.writeUInt32LE(stream.length, 204);
      stream.copy(bytes, 0xc00);
      const path = join(directory, `bind-type-${type}.macho`);
      await writeFile(path, bytes);
      const cliResult = await cli.run({
        arguments: ["inspect-native-dispatch-metadata", path, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(cliResult.exitCode, cliResult.stdout + cliResult.stderr).toBe(0);
      const client = await openProductionTarget(mcp, onTestFinished, path);
      const called = await client.callTool({
        name: "inspect_native_dispatch_metadata",
        arguments: {},
      });
      expect(called.isError, JSON.stringify(called.content)).not.toBe(true);
      for (const raw of [cliResult.json, called.structuredContent]) {
        const report = evidenceSchema.parse(raw).normalized_result;
        expect(report.target_sha256).toBe(
          createHash("sha256").update(bytes).digest("hex"),
        );
        expect(report.result.objc_classes).toMatchObject([
          { name: "Fixture", super_class: type === 1 ? "NSObject" : null },
        ]);
        const coverage = report.result.coverage.find(
          ({ facet }) => facet === "pointer_fixups",
        );
        expect(coverage).toMatchObject({
          status: type === 1 ? "complete" : "partial",
          examined: 1,
          decoded: type === 1 ? 1 : 0,
        });
        if (type !== 1)
          expect(coverage?.reason).toContain(
            `Unsupported legacy bind type ${type}`,
          );
      }
      expect(await readFile(path)).toEqual(bytes);
    }
  },
);
