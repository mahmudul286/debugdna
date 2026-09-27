import { describe, it, expect } from "vitest";

// Scaffold smoke test — confirms Vitest is configured correctly.
// All real tests are added in Sub-Tasks 4–8 (tests/analyzer/)
// and Sub-Tasks 2, 3, 5, 7 (tests/synthetic-app/).
describe("scaffold", () => {
  it("vitest is working", () => {
    expect(1 + 1).toBe(2);
  });
});
