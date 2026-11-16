import type { NextFunction, Request, Response } from "express";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Headers that limit what a browser lets the API's responses do. The client's HTML is served separately,
 * and the Caddyfile sets the same policy on it.
 */
export function securityHeaders(options: { https: boolean }) {
  return (_request: Request, response: Response, next: NextFunction) => {
    response.set({
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      ...(options.https ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" } : {}),
    });
    next();
  };
}

/**
 * Refuses requests that change something unless they come from the app's own pages. Session cookies
 * are already `SameSite=Lax` and bodies must be JSON, which a cross-site form cannot send, so this is
 * a second line of defence against cross-site request forgery.
 */
export function requireSameOrigin(options: { origin?: string }) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!UNSAFE_METHODS.has(request.method)) {
      next();
      return;
    }
    const site = request.get("Sec-Fetch-Site");
    const origin = request.get("Origin");
    const expected = options.origin ?? `${request.protocol}://${request.get("Host")}`;
    if ((site && site !== "same-origin" && site !== "none") || (origin && origin !== expected)) {
      response.status(403).json({ error: "This request came from another site" });
      return;
    }
    const length = Number(request.get("Content-Length") ?? 0);
    if ((length > 0 || request.get("Transfer-Encoding")) && !request.is("application/json")) {
      response.status(415).json({ error: "Requests must be JSON" });
      return;
    }
    next();
  };
}
