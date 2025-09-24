// @ts-ignore
import indexHtml from "./index.html";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/tasks-sse/") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html;charset=utf8" },
      });
    }
    // Proxy Parallel API requests
    if (url.pathname.startsWith("/tasks-sse/api/")) {
      // Remove /api prefix and forward to api.parallel.ai
      const targetPath = url.pathname.replace("/tasks-sse/api", "");
      const targetUrl = `https://api.parallel.ai${targetPath}${url.search}`;

      // Clone the request but change the URL
      const modifiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      // Forward the request
      const response = await fetch(modifiedRequest);

      // Clone the response to modify headers
      const modifiedResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          ...Object.fromEntries(response.headers),
          // Add CORS headers
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });

      return modifiedResponse;
    }

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    return new Response(null, {
      status: 302,
      headers: { Location: "/tasks-sse/" },
    });
  },
};
