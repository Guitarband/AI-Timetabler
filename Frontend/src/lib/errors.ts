/** Error shown in the chat as an AI message. `status` is the HTTP status when there was one. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly kind: "http" | "timeout" | "network" | "shape" = "http",
  ) {
    super(message);
    this.name = "ApiError";
  }
}
