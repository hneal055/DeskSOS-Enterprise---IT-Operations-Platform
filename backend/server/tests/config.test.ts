import { checkJwtSecret } from "../src/config";

describe("JWT_SECRET check", () => {
  it("rejects a missing secret", () => {
    expect(checkJwtSecret(undefined)).toMatch(/not set/);
    expect(checkJwtSecret("")).toMatch(/not set/);
  });

  it("rejects published placeholder values, whatever their length", () => {
    expect(checkJwtSecret("your-secret-key-change-this-in-production")).toMatch(/placeholder/);
    expect(checkJwtSecret("your-super-secret-jwt-key-change-in-production")).toMatch(/placeholder/);
  });

  it("rejects secrets shorter than 32 characters", () => {
    expect(checkJwtSecret("short-secret")).toMatch(/at least 32/);
  });

  it("accepts a long random secret", () => {
    expect(checkJwtSecret("q8Vb2mN4xZ7kP1sL9tR3wY6cF0hJ5dG8eA2uK4nM7pQ")).toBeNull();
  });
});
