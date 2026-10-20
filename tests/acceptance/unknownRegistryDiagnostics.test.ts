import { expect, it } from "vitest";
import { z } from "zod";
import { residualUnknownSchema } from "../../src/domain/residualUnknown.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";

it("distinguishes deterministic unknown-registry refusals from stale revisions through stdio MCP", async () => {
  const { client, call } = await connectLocalToolsMcp();
  const input = {
    question: "Which build number produced this artifact?",
    domain: "general",
    severity: "medium",
    required_authority: null,
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
  };
  const created = await call("record_unknown", input);
  expect(created.isError, JSON.stringify(created)).not.toBe(true);
  const { result: head } = z
    .object({ result: residualUnknownSchema })
    .parse(created.structuredContent);
  const list = async () => {
    const response = await call("list_unknowns", {});
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return response.structuredContent;
  };
  const initial = await list();
  for (const severity of ["medium", "high"]) {
    const duplicate = await call("record_unknown", { ...input, severity });
    expect(duplicate.isError).toBe(true);
    expect(duplicate.structuredContent).toBeUndefined();
    expect(parseMcpToolError(duplicate)).toMatchObject({
      error: {
        code: "execution_failure",
        retryable: false,
        message: expect.stringContaining("already exists"),
        remediation: { action: expect.stringContaining("update_unknown") },
        details: { reason: "already-exists" },
      },
    });
    expect(await list()).toEqual(initial);
  }
  const update = {
    unknown_id: head.unknown_id,
    expected_revision: head.revision,
    status: "investigating",
    severity: "high",
    required_authority: head.required_authority,
    required_confidence: head.required_confidence,
    required_environment: head.required_environment,
    recommended_probes: head.recommended_probes,
    relationships: head.relationships,
    supporting_evidence_ids: head.supporting_evidence_ids,
    contradicting_evidence_ids: head.contradicting_evidence_ids,
    resolution: null,
  };
  const invalid = await call("update_unknown", {
    ...update,
    status: "contradicted",
  });
  expect(parseMcpToolError(invalid)).toMatchObject({
    error: {
      code: "execution_failure",
      retryable: false,
      message: expect.stringContaining("transition"),
      details: { reason: "invalid-transition" },
    },
  });
  expect(await list()).toEqual(initial);
  const missingRelationship = await call("update_unknown", {
    ...update,
    relationships: [
      { type: "related-to", unknown_id: `unk_${"0".repeat(64)}` },
    ],
  });
  expect(parseMcpToolError(missingRelationship)).toMatchObject({
    error: {
      code: "evidence_integrity_mismatch",
      retryable: false,
      message: expect.stringContaining("invalid or missing"),
      details: { reason: "integrity" },
    },
  });
  expect(await list()).toEqual(initial);
  const updated = await call("update_unknown", update);
  expect(updated.isError, JSON.stringify(updated)).not.toBe(true);
  expect(updated.structuredContent).toMatchObject({
    result: { revision: 2, severity: "high", status: "investigating" },
  });
  const afterUpdate = await list();
  const stale = await call("update_unknown", update);
  expect(parseMcpToolError(stale)).toMatchObject({
    error: {
      code: "revision_conflict",
      retryable: true,
      details: { reason: "revision-conflict" },
    },
  });
  expect(await list()).toEqual(afterUpdate);
  await client.ping();
});
