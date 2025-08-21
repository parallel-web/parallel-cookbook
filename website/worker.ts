/// <reference types="@cloudflare/workers-types" />
import homeHtml from './home.html';
import cookbookData from './cookbook.json';

export interface Env {
  // No bindings needed for this simple static site
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle root path
    if (url.pathname === '/') {
      // Inject cookbook data into HTML
      const htmlWithData = homeHtml.replace(
        '// Data will be injected here by the worker',
        `window.data = ${JSON.stringify(cookbookData)};`
      );
      
      return new Response(htmlWithData, {
        headers: {
          'content-type': 'text/html;charset=UTF-8',
          'cache-control': 'public, max-age=3600'
        }
      });
    }

    // Handle API endpoint for cookbook data
    if (url.pathname === '/api/cookbooks') {
      return new Response(JSON.stringify(cookbookData), {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=3600',
          'access-control-allow-origin': '*'
        }
      });
    }

    // Handle 404
    return new Response('Not Found', { 
      status: 404,
      headers: {
        'content-type': 'text/plain'
      }
    });
  },
} satisfies ExportedHandler<Env>;