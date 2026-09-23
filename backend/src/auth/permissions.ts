export type Role = "CITOYEN" | "GREFFE" | "MAGISTRAT" | "ADMIN";

export const permissions: Record<Role, string[]> = {
  CITOYEN: ["case:create","case:read:own","case:document:own","notification:read:own","legal:read"],
  GREFFE: ["case:read","case:transition","case:document","hearing:manage","notification:manage","legal:read"],
  MAGISTRAT: ["case:read","case:transition","case:document","hearing:manage","decision:create","notification:manage","legal:read"],
  ADMIN: ["case:read","case:transition","case:document","hearing:manage","decision:create","notification:manage","admin:manage","legal:read","legal:manage"]
};

export function hasPermission(role: Role, permission: string) {
  return permissions[role]?.includes(permission) ?? false;
}
