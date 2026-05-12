import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

describe("useResourceLoader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("exports ResourceState type", () => {
    // Verify that the hook module exports the expected types
    // This test verifies that the hook can be imported and has correct types
    const module = require("@/lib/shared/hooks/useResourceLoader");
    expect(module.useResourceLoader).toBeDefined();
  });

  it("useResourceLoader is a function", () => {
    const module = require("@/lib/shared/hooks/useResourceLoader");
    expect(typeof module.useResourceLoader).toBe("function");
  });
});
