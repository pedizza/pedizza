import "server-only";
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}
export function appUrl() {
  const url = new URL(requiredEnv("NEXT_PUBLIC_APP_URL"));
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("HTTPS required");
  return url.origin;
}
