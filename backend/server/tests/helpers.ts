import { createUser, Role } from "../src/users";
import { signToken } from "../src/middleware/auth";

let counter = 0;

// Creates a user with the given role and returns an Authorization header for it
export function authAs(role: Role, name = `Test ${role}`) {
  counter += 1;
  const user = createUser({
    email: `${role}-${counter}@test.local`,
    name,
    password: "test-password-123456",
    role,
  });
  const token = signToken(user);
  return { user, token, header: { Authorization: `Bearer ${token}` } };
}
