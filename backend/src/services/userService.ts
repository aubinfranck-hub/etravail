import { createUser, findUserByEmail } from "../repositories/userRepository.js";
import { hashPassword, verifyPassword } from "../auth/password.js";

export async function registerCitizen(input: { email: string; password: string; fullName?: string; phone?: string }) {
  if (input.password.length < 8) throw new Error("PASSWORD_TOO_SHORT");
  if (await findUserByEmail(input.email)) throw new Error("EMAIL_EXISTS");
  return createUser({
    email: input.email,
    passwordHash: hashPassword(input.password),
    role: "CITOYEN",
    fullName: input.fullName,
    phone: input.phone
  });
}

export async function authenticate(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user || !user.active || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    throw new Error("INVALID_CREDENTIALS");
  }
  return user;
}
