type AuthEmail = {
  to: string;
  subject: string;
  text: string;
};

function mailEndpoint() {
  const address = process.env.AUTH_EMAIL_WEBHOOK_URL;
  const token = process.env.AUTH_EMAIL_WEBHOOK_TOKEN;
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

export function isAuthEmailConfigured() {
  return mailEndpoint() !== null;
}

export async function sendAuthEmail(message: AuthEmail) {
  const endpoint = mailEndpoint();
  if (!endpoint) throw new Error("Auth email delivery is not configured.");

  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Auth email delivery failed (${response.status}).`);
  }
}
