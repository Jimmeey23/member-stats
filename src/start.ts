import { createStart, createMiddleware } from "@tanstack/react-start";
import ws from "ws";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = ws as typeof globalThis.WebSocket;
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  serverFns: {
    fetch: (input, init) => {
      const url =
        typeof input === "string"
          ? new URL(input, window.location.href).toString()
          : input instanceof URL
            ? input.toString()
            : input.url.startsWith("http://") || input.url.startsWith("https://")
              ? input.url
              : new URL(input.url, window.location.href).toString();

      return fetch(url, init);
    },
  },
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
