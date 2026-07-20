import { describe, expect, it } from "vitest";
import { formatLatency, hostname, joinList } from "./format";

describe("hostname", () => {
  it("strips protocol and www", () => {
    expect(hostname("https://www.crunchbase.com/org/acme")).toBe("crunchbase.com");
    expect(hostname("http://sub.example.co.uk/path?q=1")).toBe("sub.example.co.uk");
  });

  it("returns the input when not a URL (never throws)", () => {
    expect(hostname("not a url")).toBe("not a url");
  });
});

describe("formatLatency", () => {
  it("renders ms under a second and seconds above", () => {
    expect(formatLatency(750)).toBe("750 ms");
    expect(formatLatency(74128)).toBe("74.1s");
  });
});

describe("joinList", () => {
  it("joins values and handles null/empty", () => {
    expect(joinList(["a", "b"])).toBe("a, b");
    expect(joinList([])).toBe("");
    expect(joinList(null)).toBe("");
  });
});
