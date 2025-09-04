/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

import { DurableObject } from "cloudflare:workers";
import { UserContext, withSimplerAuth } from "simplerauth-client";
import Parallel from "parallel-web";
//@ts-ignore
import indexHtml from "./index.html";
//@ts-ignore
import resultHtml from "./result.html";

export interface Env {
  COMPETITOR_ANALYSIS: DurableObjectNamespace<CompetitorAnalysisDO>;
  PARALLEL_API_KEY: string;
  PARALLEL_WEBHOOK_SECRET: string;
  MCP_URL: string;
}

interface AnalysisRow {
  slug: string;
  company_domain: string;
  company_name: string;
  status: "pending" | "done";
  username: string;
  profile_image_url: string;
  created_at: string;
  updated_at: string;
  visits: number;
  result: string | null;
  error: string | null;
}

function createSlug(domain: string): string {
  return domain.replace(/\./g, "-").toLowerCase();
}

function getCompanyName(domain: string): string {
  // Extract company name from domain
  const parts = domain.split(".");
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return withSimplerAuth<Env>(
      async (request, env, ctx) => {
        const url = new URL(request.url);
        const pathname = url.pathname;

        const do_id = env.COMPETITOR_ANALYSIS.idFromName("v2");
        const do_stub = env.COMPETITOR_ANALYSIS.get(do_id);

        switch (pathname) {
          case "/":
            return handleHome(do_stub);

          case "/new":
            return handleNew(request, do_stub, ctx, env);

          case "/webhook":
            return handleWebhook(request, do_stub, env);

          default:
            if (pathname.startsWith("/analysis/")) {
              const slug = pathname.replace("/analysis/", "");
              return handleResult(url, slug, do_stub);
            }
            return new Response("Not Found", { status: 404 });
        }
      },
      { isLoginRequired: false }
    )(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

async function handleHome(
  do_stub: DurableObjectStub<CompetitorAnalysisDO>
): Promise<Response> {
  const popular = await do_stub.getPopularAnalyses(6);
  const recent = await do_stub.getRecentAnalyses(30);

  const createCards = (analyses: AnalysisRow[]) => {
    if (analyses.length === 0) {
      return `<div class="text-center py-12">
        <p class="text-gray-500 text-lg">No analyses yet. Be the first to research a company!</p>
      </div>`;
    }

    return analyses
      .map((analysis) => {
        const initial = analysis.company_name.charAt(0).toUpperCase();
        return `
        <div class="company-card" onclick="window.location.href='/analysis/${
          analysis.slug
        }'">
          <div class="flex items-center space-x-4 mb-4">
            <div class="company-logo">${initial}</div>
            <div>
              <h4 class="font-semibold text-lg">${escapeHtml(
                analysis.company_name
              )}</h4>
              <p class="text-sm text-gray-500">${escapeHtml(
                analysis.company_domain
              )}</p>
            </div>
          </div>
          <p class="text-gray-600 text-sm mb-3">
            Competitive analysis with market insights and Reddit community opinions
          </p>
          <div class="flex items-center justify-between text-xs text-gray-500">
            <span>📊 Analysis available</span>
            <span>🔥 ${analysis.visits} views</span>
          </div>
        </div>
      `;
      })
      .join("");
  };

  const popularCards = createCards(popular);
  const recentCards = createCards(recent);

  let html = indexHtml;

  // Replace popular section
  html = html.replace(
    /<section id="popular"[\s\S]*?<\/section>/,
    `<section id="popular" class="py-16 px-6 neural-bg">
        <div class="max-w-6xl mx-auto">
            <h3 class="gerstner text-3xl font-medium mb-12 text-center index-black-text">
                Popular Analyses
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                ${popularCards}
            </div>
        </div>
    </section>`
  );

  // Replace recent section
  html = html.replace(
    /<section id="recent"[\s\S]*?<\/section>/,
    `<section id="recent" class="py-16 px-6 neural-bg">
        <div class="max-w-6xl mx-auto">
            <h3 class="gerstner text-3xl font-medium mb-12 text-center index-black-text">
                Recent Analyses
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                ${recentCards}
            </div>
        </div>
    </section>`
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

async function handleNew(
  request: Request,
  do_stub: DurableObjectStub<CompetitorAnalysisDO>,
  ctx: UserContext,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const company = url.searchParams.get("company");

  if (!company || company.trim().length === 0) {
    return new Response("Company domain is required", { status: 400 });
  }

  if (!ctx.authenticated) {
    const redirectUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/authorize?redirect_to=${encodeURIComponent(redirectUrl)}`,
      },
    });
  }

  const domain = company.trim().toLowerCase();
  const slug = createSlug(domain);
  const companyName = getCompanyName(domain);

  // Check user limits and slug existence
  const userAnalyses = await do_stub.getUserAnalysisCount(ctx.user?.username);
  if (userAnalyses >= 5 && ctx.user.username !== "janwilmake") {
    return new Response(
      "Maximum of 5 analyses allowed per user. Host it yourself if you need more! \n\nhttps://github.com/janwilmake/competitor-analysis",
      { status: 429 }
    );
  }

  const existingAnalysis = await do_stub.getAnalysis(slug);
  if (existingAnalysis) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/analysis/${slug}`,
      },
    });
  }

  // Create analysis task
  const parallel = new Parallel({ apiKey: env.PARALLEL_API_KEY });

  try {
    const taskRun = await parallel.taskRun.create(
      {
        input: `Analyze the competitive landscape for company: ${domain}`,
        processor: "pro",
        task_spec: {
          output_schema: {
            json_schema: {
              type: "object",
              properties: {
                company_overview: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    domain: { type: "string" },
                    description: { type: "string" },
                    unique_value_proposition: { type: "string" },
                    target_market: { type: "string" },
                    business_model: { type: "string" },
                  },
                  required: [
                    "name",
                    "domain",
                    "description",
                    "unique_value_proposition",
                    "target_market",
                  ],
                  description: "Comprehensive overview of the target company",
                },
                competitors: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      website: { type: "string" },
                      description: { type: "string" },
                      strengths: {
                        type: "array",
                        items: { type: "string" },
                        description: "Key competitive advantages",
                      },
                      weaknesses: {
                        type: "array",
                        items: { type: "string" },
                        description: "Areas where they lag behind",
                      },
                      market_share: { type: "string" },
                      differentiation: { type: "string" },
                    },
                    required: [
                      "name",
                      "description",
                      "strengths",
                      "weaknesses",
                    ],
                  },
                  description:
                    "4-6 key direct and indirect competitors with detailed analysis",
                },
                reddit_insights: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      topic: { type: "string" },
                      summary: { type: "string" },
                      sentiment: {
                        type: "string",
                        enum: ["positive", "negative", "mixed", "neutral"],
                      },
                      sources: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            title: { type: "string" },
                            url: { type: "string" },
                            excerpt: { type: "string" },
                          },
                          required: ["title", "url"],
                        },
                      },
                    },
                    required: ["topic", "summary", "sentiment", "sources"],
                  },
                  description:
                    "Key insights from Reddit discussions about the company and competitors",
                },
                key_insights: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      impact: {
                        type: "string",
                        enum: ["high", "medium", "low"],
                      },
                    },
                    required: ["title", "description", "impact"],
                  },
                  description:
                    "Strategic insights and recommendations based on the competitive analysis",
                },
              },
              required: [
                "company_overview",
                "competitors",
                "reddit_insights",
                "key_insights",
              ],
              additionalProperties: false,
            },
            type: "json",
          },
        },
        metadata: { slug },
        mcp_servers: [
          {
            name: "Reddit",
            url: env.MCP_URL,
            type: "url",
          },
        ],
        webhook: {
          url: `${url.protocol}//${url.host}/webhook`,
          event_types: ["task_run.status"],
        },
      },
      {
        headers: {
          "parallel-beta": "mcp-server-2025-07-17,webhook-2025-08-12",
        },
      }
    );

    console.log({ taskRun });

    await do_stub.createAnalysis({
      slug,
      company_domain: domain,
      company_name: companyName,
      status: "pending",
      username: ctx.user.username,
      profile_image_url: ctx.user.profile_image_url || "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      visits: 0,
      result: null,
      error: null,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/analysis/${slug}`,
      },
    });
  } catch (error) {
    console.error("Error creating analysis task:", error);
    return new Response("Error creating analysis task", { status: 500 });
  }
}

async function handleWebhook(
  request: Request,
  do_stub: DurableObjectStub<CompetitorAnalysisDO>,
  env: Env
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  console.log("Handling webhook");
  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const webhookSignature = request.headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return new Response("Missing webhook headers", { status: 400 });
  }

  const body = await request.text();
  const isSignatureValid = await verifyWebhookSignature(
    env.PARALLEL_WEBHOOK_SECRET,
    webhookId,
    webhookTimestamp,
    body,
    webhookSignature
  );

  if (!isSignatureValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(body);

  if (
    payload.type === "task_run.status" &&
    payload.data.status === "completed"
  ) {
    const slug = payload.data.metadata?.slug;
    if (!slug) {
      return new Response("Missing slug in metadata", { status: 400 });
    }

    try {
      const parallel = new Parallel({ apiKey: env.PARALLEL_API_KEY });
      const result = await parallel.taskRun.result(payload.data.run_id);

      if (result.output.type === "json") {
        await do_stub.updateAnalysisResult(slug, JSON.stringify(result), null);
      } else {
        await do_stub.updateAnalysisResult(
          slug,
          null,
          "Unexpected output format"
        );
      }
    } catch (error) {
      console.error("Error fetching result:", error);
      await do_stub.updateAnalysisResult(slug, null, "Error fetching result");
    }
  } else if (
    payload.type === "task_run.status" &&
    payload.data.status === "failed"
  ) {
    const slug = payload.data.metadata?.slug;
    if (slug) {
      await do_stub.updateAnalysisResult(
        slug,
        null,
        payload.data.error?.message || "Analysis failed"
      );
    }
  }

  return new Response("OK");
}

async function handleResult(
  url: URL,
  slug: string,
  do_stub: DurableObjectStub<CompetitorAnalysisDO>
): Promise<Response> {
  const analysis = await do_stub.getAnalysis(slug);

  if (!analysis) {
    return new Response("Analysis not found", { status: 404 });
  }

  if (analysis.status === "done" && !analysis.error) {
    await do_stub.incrementVisits(slug);
  }

  let html = resultHtml;

  // Inject dynamic title and meta tags
  const pageTitle = `${analysis.company_name} Competitive Analysis - Market Research`;
  const description =
    analysis.status === "done" && !analysis.error
      ? `Comprehensive competitive analysis for ${analysis.company_name}. Discover key competitors, market insights, and Reddit community opinions with AI-powered research.`
      : `Analyzing ${analysis.company_name}'s competitive landscape. Check back soon for comprehensive market research and competitor insights.`;

  // Replace title
  html = html.replace(
    /<title>.*?<\/title>/i,
    `<title>${escapeHtml(pageTitle)}</title>`
  );

  // Inject meta tags
  const metaTags = `
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="keywords" content="competitive analysis, market research, ${escapeHtml(
      analysis.company_name
    )}, competitors, business intelligence">
    <meta name="author" content="Competitor Analysis">
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url.origin}/analysis/${slug}">
    <meta property="og:title" content="${escapeHtml(pageTitle)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:site_name" content="Competitor Analysis">
    
    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${url.origin}/analysis/${slug}">
    <meta property="twitter:title" content="${escapeHtml(pageTitle)}">
    <meta property="twitter:description" content="${escapeHtml(description)}">
    
    <!-- Additional SEO -->
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${url.origin}/analysis/${slug}">
  `;

  html = html.replace("</head>", `${metaTags}</head>`);

  // Inject dynamic data
  const result = analysis.result ? JSON.parse(analysis.result) : null;

  if (result?.output?.["beta_fields"]?.["mcp-server-2025-07-17"]) {
    result.output.mcp_tool_calls =
      result?.output?.["beta_fields"]?.["mcp-server-2025-07-17"];
  }

  const data = {
    analysis: {
      ...analysis,
      result,
    },
  };

  html = html.replace(
    "</head>",
    `<script>window.data = ${JSON.stringify(data)}</script></head>`
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

async function verifyWebhookSignature(
  secret: string,
  webhookId: string,
  webhookTimestamp: string,
  body: string,
  signatureHeader: string
): Promise<boolean> {
  const payload = `${webhookId}.${webhookTimestamp}.${body}`;

  for (const part of signatureHeader.split(" ")) {
    if (part.startsWith("v1,")) {
      const receivedSignature = part.substring(3);

      const arr = await crypto.subtle
        .importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        )
        .then((key) =>
          crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
        )
        .then((sig) => new Uint8Array(sig));

      const expectedSignature = btoa(
        String.fromCharCode(...new Uint8Array(arr))
      );

      if (receivedSignature === expectedSignature) {
        return true;
      }
    }
  }

  return false;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class CompetitorAnalysisDO extends DurableObject<Env> {
  sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.initDatabase();
  }

  private initDatabase() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        slug TEXT PRIMARY KEY,
        company_domain TEXT NOT NULL,
        company_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
        username TEXT NOT NULL,
        profile_image_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        visits INTEGER NOT NULL DEFAULT 0,
        result TEXT,
        error TEXT
      )
    `);
  }

  async createAnalysis(
    analysis: Omit<AnalysisRow, "visits"> & { visits?: number }
  ): Promise<void> {
    this.sql.exec(
      `
      INSERT INTO analyses (slug, company_domain, company_name, status, username, profile_image_url, created_at, updated_at, visits, result, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      analysis.slug,
      analysis.company_domain,
      analysis.company_name,
      analysis.status,
      analysis.username,
      analysis.profile_image_url,
      analysis.created_at,
      analysis.updated_at,
      analysis.visits || 0,
      analysis.result,
      analysis.error
    );
  }

  async getAnalysis(slug: string): Promise<AnalysisRow | null> {
    const results = this.sql.exec(
      "SELECT * FROM analyses WHERE slug = ?",
      slug
    );
    const rows = results.toArray();
    return rows.length > 0 ? (rows[0] as AnalysisRow) : null;
  }

  async getUserAnalysisCount(username: string): Promise<number> {
    const results = this.sql.exec(
      "SELECT COUNT(*) as count FROM analyses WHERE username = ?",
      username
    );
    const rows = results.toArray();
    return (rows[0] as any).count;
  }

  async updateAnalysisResult(
    slug: string,
    result: string | null,
    error: string | null
  ): Promise<void> {
    const status = "done"; // Both success and error are considered "done"
    this.sql.exec(
      `
      UPDATE analyses 
      SET status = ?, result = ?, error = ?, updated_at = ?
      WHERE slug = ?
    `,
      status,
      result,
      error,
      new Date().toISOString(),
      slug
    );
  }

  async incrementVisits(slug: string): Promise<void> {
    this.sql.exec(
      "UPDATE analyses SET visits = visits + 1 WHERE slug = ?",
      slug
    );
  }

  async getPopularAnalyses(limit: number): Promise<AnalysisRow[]> {
    const results = this.sql.exec(
      `
      SELECT * FROM analyses 
      WHERE status = 'done' AND error IS NULL
      ORDER BY visits DESC 
      LIMIT ?
    `,
      limit
    );
    return results.toArray() as AnalysisRow[];
  }

  async getRecentAnalyses(limit: number): Promise<AnalysisRow[]> {
    const results = this.sql.exec(
      `
      SELECT * FROM analyses 
      WHERE status = 'done' AND error IS NULL
      ORDER BY created_at DESC 
      LIMIT ?
    `,
      limit
    );
    return results.toArray() as AnalysisRow[];
  }
}
