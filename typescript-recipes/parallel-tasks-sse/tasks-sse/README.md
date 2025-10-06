# Build a real-time streaming task manager with Parallel

This guide demonstrates how to build a complete task streaming playground that showcases Parallel's Task API with real-time Server-Sent Events (SSE). By the end, you'll have a full-featured application that creates tasks, streams their execution progress, and displays results as they arrive. This can be helpful for developers building with the Task API, demonstrating how to recreate the user interfaces in our [Playground](https://platform.parallel.ai). 

Complete demo available at: [https://oss.parallel.ai/tasks-sse/](https://oss.parallel.ai/tasks-sse/)

## Key Features

* Task Manager for All Processors: From lite ($5/1K) to ultra8x ($2400/1K)   
* Output Schemas: Text, JSON and Auto Schema  
* Source Policy: Domain inclusion and exclusion  
* Webhooks: HTTP notifications on task completion  
* Streaming events view for each Task in the Task Manager  
* OAuth flow for easy testing

## The Architecture

The task streaming playground we're building includes:

* OAuth2 authentication with Parallel's identity provider  
* A comprehensive task creation form supporting all processor types and output schemas  
* Real-time task progress streaming with Server-Sent Events  
* Task history management with persistent localStorage  
* Auto-reconnection for resilient streaming connections  
* Rich event visualization with progress indicators and final outputs

## Our technology stack

* Parallel Task API for task execution  
* Parallel OAuth Provider for secure authentication    
* [Server-Sent Events](https://docs.parallel.ai/task-api/features/task-sse) for real-time streaming  
* [Cloudflare Workers](https://workers.cloudflare.com/) for deployment and CORS proxying  
* Pure HTML/JavaScript/CSS for maximum compatibility

## Why this architecture

### Stateless Streaming Design

The key insight behind this implementation is that you don't need to maintain any backend state during streaming. The Parallel Task API's SSE endpoint provides the complete current state every time you connect, including:

* All previous events that occurred before connecting  
* The latest progress statistics    
* Current task status and metadata  
* Final outputs when tasks complete

This stateless design means your backend can be incredibly simple \- just a CORS proxy. All the complexity lives in the well-tested Parallel infrastructure.

### OAuth2 with PKCE Security

For production-ready authentication, we implement the complete OAuth2 flow with PKCE (Proof Key for Code Exchange):

1\. Dynamic Client Registration: Register OAuth client on-demand  
2\. PKCE Challenge: Generate cryptographically secure code challenge    
3\. Authorization Redirect: Send user to Parallel's OAuth server  
4\. Token Exchange: Securely exchange authorization code for access token  
5\. Persistent Storage: Store token in localStorage for session management

This provides enterprise-grade security without requiring pre-registration of OAuth clients.

![][image1]

## Implementation 

### Real-Time Event Streaming

Server-Sent Events (SSE) provide the real-time updates for this Task manager that helps end-users understand the progress of the Parallel Task API. This is especially helpful for longer-running processors, like Pro and above. Unlike traditional polling approaches that repeatedly ask "are you done yet?", SSE creates a persistent connection that streams updates as they happen. However, implementing SSE correctly in the browser requires handling several complex challenges.

#### Why Manual SSE Implementation?

While browsers provide a built-in \`EventSource\` API for SSE, it has a critical limitation: \*\*you cannot set custom headers\*\*. Since Parallel's API requires authentication via the \`x-api-key\` header, we must implement SSE manually using the Fetch API and ReadableStreams.

SSE data arrives as a continuous stream of bytes, not discrete messages. Network packets can split messages in unpredictable ways:

Our implementation handles this with a streaming buffer pattern:

```javascript
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  // Add new data to buffer
  buffer += decoder.decode(value, { stream: true });
  
  // Split into complete lines
  const lines = buffer.split('\n');
  buffer = lines.pop(); // Keep incomplete line in buffer
  
  // Process complete lines
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.substring(6));
      handleEvent(data);
    }
  }
}
```

This pattern ensures we never lose data or attempt to parse incomplete JSON, regardless of how network packets arrive.

#### Resilient Connection Management

Task execution can take anywhere from seconds to 30+ minutes. Network connections inevitably drop during long operations, so robust reconnection logic is essential:

```javascript
// Auto-retry logic for active tasks
if (streamReconnectAttempts < MAX_RECONNECT_ATTEMPTS &&
    currentTaskRun && ['queued', 'running'].includes(currentTaskRun.status)) {
  streamReconnectAttempts++;
  setTimeout(() => {
    console.log(`Reconnecting attempt ${streamReconnectAttempts}...`);
    startStream();
  }, 2000);
}
```

**Key resilience features:**

* Status-based reconnection: Only retry for tasks that might still be generating events  
* Exponential backoff: 2-second delays prevent overwhelming the server  
* Attempt limiting: Prevents infinite retry loops on permanent failures  
* Stateless recovery: Each reconnection gets the complete current state

#### Understanding the Event Stream Format

Parallel's SSE stream follows the standard Server-Sent Events specification. Each event is prefixed with \`data: \` and terminated with double newlines. The implementation strips the prefix and parses the JSON payload:

```javascript
for (const line of lines) {
  if (line.startsWith('data: ')) {
    try {
      const data = JSON.parse(line.substring(6)); // Remove 'data: ' prefix
      handleEvent(data);
    } catch (error) {
      console.error('Error parsing event data:', error, line);
    }
  }
}
```

#### Event Type Taxonomy

The stream delivers several categories of events, each serving a different purpose:

* \`task\_run.state\`: Core lifecycle events (queued → running → completed/failed)  
* \`task\_run.progress\_stats\`: Quantitative metrics (sources found, pages read, tokens used)  
* \`task\_run.progress\_msg.\*\`: Qualitative updates with timestamped reasoning steps  
* \`task\_run.progress\_msg.reasoning\`: AI thought process  
* \`task\_run.progress\_msg.search\`: Search query generation  
* \`task\_run.progress\_msg.analysis\`: Content analysis steps  
* \`error\`: Exception conditions with detailed error messages

This rich event taxonomy enables granular UI updates \- progress bars for stats, reasoning displays for AI thinking, and error handling for failures.

#### Event Visualization and UI

The frontend renders different event types with appropriate styling:

```javascript
function handleEvent(data) {
  console.log(`event [${data.type}]`, data);
  
  let eventHtml = '';
  let eventClass = '';

  switch (data.type) {
    case 'task_run.state':
      eventClass = 'state';
      eventHtml = `
        <div class="event-type">TASK STATE</div>
        <div class="event-message">
          Status: <span class="status ${data.run.status}">${data.run.status}</span>
          ${data.run.error ? `<br><span class="error">Error: ${data.run.error.message}</span>` : ''}
        </div>
      `;

      // Display final output
      if (data.output) {
        const outputHtml = formatOutput(data.output);
        eventHtml += `<div class="output-section">
          <strong>Final Output:</strong>
          ${outputHtml}
        </div>`;
      }
      break;

    case 'task_run.progress_stats':
      eventClass = 'progress-stats';
      const stats = data.source_stats;
      eventHtml = `
        <div class="event-type">PROGRESS STATS</div>
        <div class="progress-stats">
          <div class="stat">Sources Considered: ${stats.num_sources_considered || 'N/A'}</div>
          <div class="stat">Sources Read: ${stats.num_sources_read || 'N/A'}</div>
        </div>
        ${stats.sources_read_sample ? `
          <div style="margin-top: 10px;">
            <strong>Sample Sources:</strong>
            <ul style="margin-top: 5px; margin-left: 20px;">
              ${stats.sources_read_sample.slice(0, 3).map(url => 
                `<li><a href="${url}" target="_blank">${url.length > 60 ? url.substring(0, 60) + '...' : url}</a></li>`
              ).join('')}
            </ul>
          </div>
        ` : ''}
      `;
      break;

    default:
      if (data.type.startsWith('task_run.progress_msg')) {
        eventClass = 'progress-msg';
        const msgType = data.type.split('.').pop().toUpperCase().replace('_', ' ');
        eventHtml = `
          <div class="event-type">${msgType}</div>
          ${data.timestamp ? `<div class="event-timestamp">${new Date(data.timestamp).toLocaleString()}</div>` : ''}
          <div class="event-message">${data.message}</div>
        `;
      }
      break;
  }

  // Create and append event element
  const eventDiv = document.createElement('div');
  eventDiv.className = `event ${eventClass}`;
  eventDiv.innerHTML = eventHtml;
  eventsSection.appendChild(eventDiv);

  // Auto-scroll to new events
  eventDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
```

### CORS Proxy Worker

A simple worker solves a fundamental web security challenge. Modern browsers implement the Same-Origin Policy, which prevents JavaScript running on \`yourdomain.com\` from making direct API calls to \`api.parallel.ai\`. This security feature protects users from malicious websites, but it also blocks legitimate applications from accessing external APIs.

Traditional solutions involve building a full backend API server that handles authentication, request validation, and response transformation. Instead, we use a much simpler proxy pattern that acts as a transparent middleman.

* Path Rewriting: \`/tasks-sse/api/v1/tasks/runs\` becomes \`https://api.parallel.ai/v1/tasks/runs\`  
* Header Preservation: All original headers (including \`x-api-key\`) are forwarded  
* CORS Headers: Added to all responses to enable browser access  
* Static Serving: The same worker serves the HTML frontend

```ts
// @ts-ignore
import indexHtml from "./index.html";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve the frontend
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
```

### OAuth Authentication

The OAuth flow implementation handles dynamic client registration, as well as the complete PKCE security protocol:

```javascript
async function startOAuth() {
  try {
    // Register client dynamically
    const reg = await fetch("https://platform.parallel.ai/getKeys/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [window.location.origin + window.location.pathname]
      }),
    });

    const { client_id } = await reg.json();

    // Generate PKCE challenge
    const cv = btoa(crypto.getRandomValues(new Uint8Array(32))).replace(
      /[+/=]/g, (m) => ({ "+": "-", "/": "_", "=": "" }[m])
    );
    localStorage.setItem('code_verifier', cv);

    const cc = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256", 
            new TextEncoder().encode(cv)
          )
        )
      )
    ).replace(/[+/=]/g, (m) => ({ "+": "-", "/": "_", "=": "" }[m]));

    // Redirect to OAuth server
    const url = new URL("https://platform.parallel.ai/getKeys/authorize");
    Object.entries({
      client_id,
      redirect_uri: window.location.origin + window.location.pathname,
      response_type: "code",
      scope: "api",
      code_challenge: cc,
      code_challenge_method: "S256",
      state: Math.random().toString(36).substring(7)
    }).forEach(([k, v]) => url.searchParams.set(k, v));

    window.location.href = url;
  } catch (error) {
    alert('OAuth error: ' + error.message);
  }
}
```

## Resources

* [App Source Code](https://github.com/parallel-web/parallel-cookbook/tree/main/typescript-recipes/parallel-tasks-sse)  
* [Live App Example](https://oss.parallel.ai/tasks-sse/)  
* [Parallel SSE Documentation](https://docs.parallel.ai/task-api/features/task-sse)

[image1]: <data:image/png;base64,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>
