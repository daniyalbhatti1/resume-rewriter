export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
