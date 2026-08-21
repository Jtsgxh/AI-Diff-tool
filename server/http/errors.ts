import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Error carrying the HTTP status the client should see. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);

/**
 * Wraps an async handler so a rejected promise reaches the error middleware
 * instead of hanging the request. Removes the try/catch that was copy-pasted
 * into every route.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** Terminal error middleware: one place that decides the shape of an error body. */
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err instanceof HttpError ? err.status : err?.status || 400;
  const message = err?.message || 'Unexpected server error';

  if (res.headersSent) {
    // The response is already streaming; the transport layer owns the ending.
    res.end();
    return;
  }

  res.status(status).json({ error: message });
}
