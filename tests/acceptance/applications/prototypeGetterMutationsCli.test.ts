import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains prototype getter mutation uncertainty through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-prototype-getter-");
    const cases = [
      [
        "actualReceiver",
        "const box={__proto__:proto,s:shared};box.v.x=2;",
        "unknown",
        "{s:{x:1},get v(){return this.s}}",
      ],
      [
        "ownerIsNotReceiver",
        "const box={__proto__:proto,s:{x:1}};box.v.x=2;",
        "literal",
        "{s:shared,get v(){return this.s}}",
      ],
      ["direct", "const box={__proto__:proto};box.v.x=2;", "unknown"],
      [
        "saved",
        "const box={__proto__:proto};const value=box.v;value.x=2;",
        "unknown",
      ],
      ["readOnly", "const box={__proto__:proto};const value=box.v;", "literal"],
      ["shadowed", "const box={__proto__:proto,v:{x:1}};box.v.x=2;", "literal"],
      [
        "spread",
        "const source={__proto__:proto};const box={...source};if(box.v)box.v.x=2;",
        "literal",
      ],
      [
        "rest",
        "const source={__proto__:proto};const {...box}=source;if(box.v)box.v.x=2;",
        "literal",
      ],
    ] as const;
    await writeFile(
      join(root, "app.mjs"),
      cases
        .map(
          ([
            name,
            body,
            ,
            prototype = "{get v(){return shared}}",
          ]) => `export function ${name}(){
      const shared={x:1};const proto=${prototype};
      ${body}
      return shared.x;
    }`,
        )
        .join("\n"),
    );
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const [name, , status] of cases) {
      const observation = graph.nodes
        .flatMap((node) => node.observations)
        .find(
          ({ properties }) =>
            properties.semantic_role === "export-return-shapes" &&
            properties.exported_name === name,
        );
      expect(observation, name).toBeDefined();
      expect(observation?.properties.static_return_shapes).toMatchObject([
        {
          value_status: status,
          fields: [
            { path: "", state: status, value: status === "unknown" ? null : 1 },
          ],
        },
      ]);
    }
  },
);
