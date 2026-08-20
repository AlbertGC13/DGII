import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../scripts/testecf-ecf31-probe.mjs", import.meta.url), "utf8");

describe("TesteCF e-CF 31 operator probe", () => {
  it("keeps the password off argv, environment, and output while enforcing the verified submission pipeline", () => {
    expect(script).toMatch(/<absolute-p12-path> <rnc>/u);
    expect(script).not.toMatch(/process\.argv\[4\]|process\.env|console\.log\([^\n]*password/iu);
    expect(script).toMatch(/promptHiddenPassword/u);
    expect(script).toMatch(/assembleEcf31Xml[\s\S]*signXmlWithAuthenticatedCertificate[\s\S]*serializeSignedXmlArtifact[\s\S]*validateOfflineDgiiXml[\s\S]*verifyDgiiXmlSignature[\s\S]*\.submit\(verified\.value\)/u);
    expect(script).toMatch(/api\/facturaselectronicas/u);
    expect(script).not.toMatch(/api\/ecf|Route \[official\|claimed\]|ROUTE_CANDIDATE/u);
    expect(script).toMatch(/TRACK_ID/u);
    expect(script).toMatch(/createTesteCfEcf31ProbeDiagnostics/u);
    expect(script).toMatch(/redactTesteCfProbeOutput/u);
    expect(script).toMatch(/observeAuthorization/u);
    expect(script).toMatch(/observeReceptionTransport/u);
    expect(script).toMatch(/diagnostics\.fields\(\)/u);
    expect(script).toMatch(/const response = await receptionTransport\.postMultipart\(request, signal\);\s+diagnostics\.observeReceptionTransport\(response\);\s+return response;/u);
    expect(script).toMatch(/function redact\(value\) \{ return redactTesteCfProbeOutput\(value\); \}/u);
    expect(script).not.toMatch(/console\.(?:log|error)\([^\n]*(?:body|headers|authorization|token|password|certificate|stack)/iu);
  });
});
