import { describe, it, expect } from "vitest";
import { parseCSV } from "@/utils/csv-parser.js";

describe("parseCSV", () => {
  it("parses basic CSV", () => {
    const result = parseCSV("a,b,c\n1,2,3");
    expect(result).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles quoted fields with commas", () => {
    const result = parseCSV('name,desc\n"Acme, Inc","A company"');
    expect(result).toEqual([["name", "desc"], ["Acme, Inc", "A company"]]);
  });

  it("handles escaped quotes inside fields", () => {
    const result = parseCSV('a\n"He said ""hello"""');
    expect(result).toEqual([["a"], ['He said "hello"']]);
  });

  it("handles empty fields", () => {
    const result = parseCSV("a,b,c\n1,,3");
    expect(result).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });

  it("strips BOM character", () => {
    const result = parseCSV("\uFEFFa,b\n1,2");
    expect(result).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles \\r\\n line endings", () => {
    const result = parseCSV("a,b\r\n1,2\r\n3,4");
    expect(result).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("handles trailing newline", () => {
    const result = parseCSV("a,b\n1,2\n");
    expect(result).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles single row", () => {
    const result = parseCSV("a,b,c");
    expect(result).toEqual([["a", "b", "c"]]);
  });

  it("returns empty array for empty string", () => {
    const result = parseCSV("");
    expect(result).toEqual([]);
  });
});
