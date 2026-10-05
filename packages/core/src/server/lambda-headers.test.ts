import { describe, expect, it } from "vitest";
import { OPERATOR_BYPASS_HEADER, SOURCE_IP_HEADER } from "./caller.js";
import { lambdaRequestHeaders } from "./lambda-headers.js";

function event(headers: Record<string, string | undefined> | undefined, sourceIp = "203.0.113.9") {
  return { headers, requestContext: { http: { sourceIp } } };
}

describe("lambdaRequestHeaders", () => {
  it("forwards the API Gateway source address as the internal header", () => {
    const headers = lambdaRequestHeaders(event({ "content-type": "application/json" }));
    expect(headers[SOURCE_IP_HEADER]).toBe("203.0.113.9");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("replaces a client-sent copy of the source header, whatever its case", () => {
    for (const name of [SOURCE_IP_HEADER, "X-Federal-MCPS-Source-IP", "X-FEDERAL-MCPS-SOURCE-IP"]) {
      const headers = lambdaRequestHeaders(event({ [name]: "160.79.104.1" }));
      const copies = Object.keys(headers).filter((key) => key.toLowerCase() === SOURCE_IP_HEADER);
      expect(copies).toEqual([SOURCE_IP_HEADER]);
      expect(headers[SOURCE_IP_HEADER]).toBe("203.0.113.9");
    }
  });

  it("leaves x-forwarded-for alone and never derives the address from it", () => {
    const headers = lambdaRequestHeaders(event({ "x-forwarded-for": "160.79.104.1, 10.0.0.1" }));
    expect(headers[SOURCE_IP_HEADER]).toBe("203.0.113.9");
    expect(headers["x-forwarded-for"]).toBe("160.79.104.1, 10.0.0.1");
  });

  it("keeps one lower-cased operator header, verified later by identify()", () => {
    const headers = lambdaRequestHeaders(event({ "X-Federal-MCPS-Operator": "tok" }));
    const copies = Object.keys(headers).filter(
      (key) => key.toLowerCase() === OPERATOR_BYPASS_HEADER,
    );
    expect(copies).toEqual([OPERATOR_BYPASS_HEADER]);
    expect(headers[OPERATOR_BYPASS_HEADER]).toBe("tok");
  });

  it("drops an ambiguous operator header sent under several spellings", () => {
    const headers = lambdaRequestHeaders(
      event({ [OPERATOR_BYPASS_HEADER]: "a", "X-Federal-MCPS-Operator": "b" }),
    );
    expect(headers[OPERATOR_BYPASS_HEADER]).toBeUndefined();
  });

  it("drops undefined header values and tolerates an event with no headers", () => {
    const headers = lambdaRequestHeaders(event({ accept: undefined }));
    expect(headers).toEqual({ [SOURCE_IP_HEADER]: "203.0.113.9" });
    expect(lambdaRequestHeaders(event(undefined))).toEqual({ [SOURCE_IP_HEADER]: "203.0.113.9" });
  });

  it("forwards no source header when API Gateway gave no source address", () => {
    const headers = lambdaRequestHeaders(event({ [SOURCE_IP_HEADER]: "160.79.104.1" }, ""));
    expect(headers[SOURCE_IP_HEADER]).toBeUndefined();
  });
});
