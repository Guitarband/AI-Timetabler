import { TRPCError } from "@trpc/server";

function calculationEndpoint() {
  const address = process.env.TIMETABLE_BACKEND_URL;
  const token = process.env.TIMETABLE_BACKEND_TOKEN;
  if (!address || !token) return null;

  try {
    const url = new URL(address);
    const localDevelopment =
      process.env.NODE_ENV === "development" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);

    if (url.protocol === "https:" || localDevelopment) {
      return { url, token };
    }
  } catch {
    return null;
  }

  return null;
}

export async function requestTimetableCalculation(userId: string) {
  const endpoint = calculationEndpoint();
  if (!endpoint) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Timetable calculation is not configured.",
    });
  }

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "The timetable backend did not accept the request.",
      });
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "The timetable backend is unavailable.",
    });
  }

  return { submitted: true };
}
