/**
 * Newsletter writer agent: Claude writes polished HTML email newsletters
 * using deep research from the Parallel Task API, with a parallel_lookup
 * tool for fact-checking via Task API base with interaction chaining.
 */

import Anthropic from "@anthropic-ai/sdk";

const PARALLEL_BASE = "https://api.parallel.ai";

const NEWSLETTER_SYSTEM = `You are the editor of "Datacenter Signal," a weekly intelligence brief for datacenter infrastructure investors. Your job is to transform raw research into a polished, professional HTML email newsletter.

VOICE: Analytical, concise, data-anchored. Write like a Financial Times or Stratechery briefing. No hype, no speculation. Evidence and clarity. No emoji.

STRUCTURE (follow exactly):
1. MASTHEAD — already provided in the template, don't generate
2. THE WEEK IN ONE READ — 2-3 sentence executive summary of the most important theme
3. CRITICAL DEVELOPMENTS — for each critical event:
   - Category tag + region
   - Headline (bold, 18px)
   - 2-3 paragraphs of analysis: what happened, background context, implications for investors, what to watch
   - Inline source links woven into prose (e.g., "according to <a href='url'>Virginia Mercury</a>")
   - NEVER use numbered references like [1] or [27]
4. REGIONAL ROUNDUP — one line per active region, the most important headline
5. BY THE NUMBERS — 8-12 key data points as a clean list

CITATION RULES — THIS IS THE MOST IMPORTANT PART:
- Cite AGGRESSIVELY. The research provides a large SOURCE POOL of real URLs — use as many DISTINCT sources as you can. A strong issue links 25-40+ distinct sources. Sparse linking is a failure.
- EVERY factual sentence — every number, date, dollar figure, vote count, company name, quote, or claim — MUST carry an inline <a> link to a source from the pool.
- Prefer 2-3 links per paragraph over one. When multiple sources support a point, link several ("<a>Reuters</a> and <a>the Virginia Mercury</a> both report…").
- Use the publication/domain name as the link text, not the article title.
- Only use URLs that appear in the SOURCE POOL or research below — never invent a URL. Match each link to the most relevant source.
- Do NOT use numbered references like [1] or [27] — always inline hyperlinks.

HTML FORMAT:
- Use inline styles only (email-safe)
- Headings: <h2 style="font-size:17px;font-weight:500;color:#1D1B16;margin:24px 0 8px;padding-bottom:5px;border-bottom:1px solid #E5E5E5">
- Body: <p style="font-size:14px;line-height:22px;color:#5C5B59;margin:0 0 10px">
- Links: <a href="url" style="color:#FB631B;text-decoration:none">
- Bold: <strong style="color:#1D1B16;font-weight:500">
- Lists: <ul style="padding-left:18px;margin:0 0 12px"><li style="font-size:14px;line-height:22px;color:#5C5B59;margin-bottom:4px">
- Category tags: <span style="font-family:'Courier New',monospace;font-size:8px;text-transform:uppercase;letter-spacing:0.05em;font-weight:500;padding:2px 6px;border-radius:2px;color:#fff;background:COLOR">CATEGORY</span>
  Colors: Power & Grid=#FB631B, Zoning & Policy=#F79A6F, Capital & Ownership=#E14942, Community=#5C5B59, Construction=#858483

OUTPUT: Return ONLY the HTML content for the body section (between masthead and footer — those are added separately). No markdown. Pure HTML with inline styles.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "parallel_lookup",
    description:
      "Look up a specific fact, verify a claim, or find missing information using Parallel's research API. This tool has full context from the deep research already performed. Use it for: verifying exact numbers, finding primary source URLs, checking dates, getting vote counts, confirming deal values, etc. Ask a clear, specific question.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "A specific factual question to look up, e.g., 'What was the exact vote count for the Loudoun County data center moratorium?' or 'What is the dollar amount of the NextEra-Dominion merger?'",
        },
      },
      required: ["query"],
    },
  },
];

async function callParallelLookup(
  query: string,
  interactionId: string,
  apiKey: string,
): Promise<string> {
  console.log(`  [lookup] ${query.slice(0, 80)}...`);
  const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: query,
      processor: "base",
      previous_interaction_id: interactionId,
    }),
  });
  if (!res.ok) return `Error: ${res.status}`;
  const task = await res.json();

  const start = Date.now();
  while (Date.now() - start < 120000) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(
      `${PARALLEL_BASE}/v1/tasks/runs/${task.run_id}`,
      { headers: { "x-api-key": apiKey } },
    );
    if (!statusRes.ok) continue;
    const data = await statusRes.json();
    if (data.status === "completed") {
      const resultRes = await fetch(
        `${PARALLEL_BASE}/v1/tasks/runs/${task.run_id}/result`,
        { headers: { "x-api-key": apiKey } },
      );
      const result = await resultRes.json();
      const raw = result.output?.content;
      return typeof raw === "string"
        ? raw
        : JSON.stringify(raw) || "No result found.";
    }
    if (data.status === "failed") return "Lookup failed.";
  }
  return "Lookup timed out.";
}

export async function writeNewsletter(opts: {
  research: string;
  interactionId: string;
  issueNumber: number;
  eventsTotal: number;
  criticalCount: number;
  marketsActive: number;
  regionSummaries: string;
  parallelApiKey: string;
  anthropicApiKey: string;
  citationPool?: { title: string; url: string }[];
}): Promise<string> {
  const {
    research,
    interactionId,
    issueNumber,
    eventsTotal,
    criticalCount,
    marketsActive,
    regionSummaries,
    parallelApiKey,
    anthropicApiKey,
    citationPool = [],
  } = opts;

  // Dedupe the pool by URL and cap it so the prompt stays manageable
  const pool = Array.from(
    new Map(citationPool.filter((c) => c.url).map((c) => [c.url, c])).values()
  ).slice(0, 120);
  const poolBlock = pool.length
    ? pool.map((c, i) => `${i + 1}. ${c.title || "Source"} — ${c.url}`).join("\n")
    : "(none supplied — pull URLs from the research text below)";

  const userMessage = `Write Datacenter Signal Issue ${issueNumber}.

STATS: ${eventsTotal} total events, ${criticalCount} critical, ${marketsActive} markets active.

SOURCE POOL — ${pool.length} real citations gathered by the Task API. Weave as many of these as possible into the prose as inline hyperlinks. Reuse the exact URLs:
${poolBlock}

DEEP RESEARCH OUTPUT (your primary narrative source — already fact-checked, contains additional inline URLs):
${research}

ALL MONITOR EVENTS (for the regional roundup — one line per region):
${regionSummaries}

Write the complete HTML email body now, linking densely from the SOURCE POOL. Use the parallel_lookup tool only if you must verify a specific fact.`;

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];
  let finalHtml = "";

  for (let turn = 0; turn < 12; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 20000,
      system: NEWSLETTER_SYSTEM,
      tools: TOOLS,
      messages,
    });

    console.log(
      `  [writer] Turn ${turn + 1}: stop=${response.stop_reason}, blocks=${response.content.length}`,
    );

    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use",
    ) as Anthropic.ToolUseBlock[];

    // Keep the LONGEST text block seen — the finished HTML is far longer than
    // any planning/preamble text, so this survives multi-turn tool use without
    // being clobbered by a short "I'll verify a few facts…" preamble.
    for (const block of response.content) {
      if (block.type === "text" && block.text.length > finalHtml.length) {
        finalHtml = block.text;
      }
    }

    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      break;
    }

    // Execute all tool calls in parallel for speed
    const lookupResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const query = (block.input as { query: string }).query;
        const result = await callParallelLookup(
          query,
          interactionId,
          parallelApiKey,
        );
        return { tool_use_id: block.id, result };
      }),
    );

    const toolResultContent = lookupResults.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.tool_use_id,
      content: [{ type: "text" as const, text: r.result }],
    }));

    messages = [
      ...messages,
      { role: "assistant", content: response.content },
      { role: "user", content: toolResultContent },
    ];
  }

  // Safety net: if the loop exhausted its turns on tool use before producing a
  // full document, force one final write with no tools available.
  if (finalHtml.replace(/```html|```/g, "").trim().length < 1500) {
    console.log("  [writer] Output too short — forcing a final no-tools write.");
    const forced = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 20000,
      system: NEWSLETTER_SYSTEM,
      messages: [
        ...messages,
        { role: "user", content: "Write the complete HTML email body now using everything gathered above. Link densely from the SOURCE POOL. Output only the HTML." },
      ],
    });
    const text = forced.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    if (text.length > finalHtml.length) finalHtml = text;
  }

  // Extract HTML from code fences if Claude wrapped it
  const fenceMatch = finalHtml.match(/```html\s*([\s\S]*?)```/);
  if (fenceMatch) finalHtml = fenceMatch[1].trim();

  return finalHtml;
}

export function wrapEmailTemplate(
  bodyHtml: string,
  issueNumber: number,
): string {
  return `<div style="max-width:644px;margin:0 auto;background:#fff;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="padding:28px 30px 18px;border-bottom:1px solid #E5E5E5;background:#FCFBFA">
<div style="font-family:'Courier New',monospace;font-weight:700;font-size:18px;color:#1D1B16;margin-bottom:14px">parallel</div>
<div style="display:flex;justify-content:space-between;align-items:baseline">
<span style="font-family:'Courier New',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#1D1B16">Datacenter Signal</span>
<span style="font-family:'Courier New',monospace;font-size:9px;color:#A6A5A4">Issue ${issueNumber}</span>
</div></div>
<div style="padding:24px 30px">${bodyHtml}</div>
<div style="padding:24px 30px;background:#FCFBFA;border-top:1px solid #E5E5E5">
<div style="font-family:'Courier New',monospace;font-weight:700;font-size:13px;color:#1D1B16;opacity:0.6;margin-bottom:8px">parallel</div>
<div style="font-family:'Courier New',monospace;font-size:9px;color:#A6A5A4">hello@parallel.ai · Palo Alto, CA</div>
</div></div>`;
}
