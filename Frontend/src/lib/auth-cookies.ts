export function forwardAuthCookies(from: Headers, to: Headers) {
  for (const cookie of from.getSetCookie()) {
    to.append("set-cookie", cookie);
  }
}
