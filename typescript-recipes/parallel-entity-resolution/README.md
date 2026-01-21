# Person Entity Resolution API

> AI-powered digital identity resolution across social platforms

Available at: https://entity-resolution-demo.parallel.ai

## What It Does

This API finds all social media profiles belonging to a single person. Give it a name, email, username, or any profile URL—it returns verified matches across Twitter, LinkedIn, GitHub, Instagram, Facebook, TikTok, and more.

**The problem**: People fragment their presence across dozens of platforms. Traditional search can't reliably connect these scattered identities.

**The solution**: AI-powered entity resolution that finds and verifies profiles through cross-referencing and confidence scoring.

## Why It Matters

- Sales & Revenue: Find prospects' complete digital footprint beyond LinkedIn for richer intelligence
- Recruiting: Evaluate technical skills (GitHub), communication (Twitter), and thought leadership in one view
- Customer Success: Identify vocal advocates and at-risk customers across all their active channels
- Data Quality: Merge duplicate CRM records by linking profiles to single verified entities
- SaaS Products: Understand your users by connecting their product usage to their public presence

## How It Works

1. Submit a person identifier (name, email, username, or profile URL)
2. AI searches across major platforms and verifies matches
3. Returns structured profile data with confidence indicators

Built using [Parallel's Task API](https://docs.parallel.ai/task-api/guides/choose-a-processor) and [OAuth Provider](https://docs.parallel.ai/integrations/oauth-provider).

![](view.drawio.png)

## Quick Start

```ts example.ts
// Submit resolution request
const response = await fetch("https://your-api.com/resolve", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "your-api-key",
  },
  body: JSON.stringify({
    input: "john.doe@techcorp.com or @johndoe on Twitter",
  }),
});

const { trun_id } = await response.json();

// Poll for results
const result = await fetch(`https://your-api.com/resolve/${trun_id}`, {
  headers: { "x-api-key": "your-api-key" },
});

const { profiles } = await result.json();
```

### Example Response

```json:example-response.json
{
  "profiles": [
    {
      "platform_slug": "twitter",
      "profile_url": "https://twitter.com/johndoe",
      "is_self_proclaimed": true,
      "is_self_referring": true,
      "match_reasoning": "Profile bio links to LinkedIn and GitHub profiles found in search",
      "profile_snippet": "CTO @TechCorp | Building AI infrastructure | Thoughts on ML systems"
    },
    {
      "platform_slug": "github",
      "profile_url": "https://github.com/johndoe",
      "is_self_proclaimed": true,
      "is_self_referring": false,
      "match_reasoning": "Linked from Twitter profile, same name and company affiliation",
      "profile_snippet": "CTO at TechCorp. 50 repositories, 2.3k followers"
    }
  ]
}
```

## Field Explanations

**`is_self_proclaimed`**: Whether this profile was discovered through the input's chain of references.

`true` if:

1.  directly mentioned in the original input,
2.  linked from a profile mentioned in the input, or
3.  linked from any profile in this chain (transitive relationship).

`false` if discovered only through external search without a self-reference chain.",

**`is_self_referring`**: Whether this profile links back to input profile(s) or other found profile(s)

**`match_reasoning`**: Human-readable explanation of why the AI matched this profile. Use for quality assurance and debugging.

## Real-World Impact

- Sales teams: 10x more context per lead in CRM
- Recruiting firms: 30 minutes → 30 seconds per candidate
- Customer success: Early warning system via social sentiment
- Investment firms: Due diligence on startup founders
- Marketing: Identify real industry influencers

## Conservative Matching

The API only returns high-confidence matches. No false positives means you can trust the results for critical decisions like sales outreach, hiring, and compliance.
