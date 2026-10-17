export function isStudentId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{6,12}$/.test(value);
}
