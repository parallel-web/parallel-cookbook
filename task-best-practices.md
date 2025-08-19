# Parallel Task API: Best Practices & Common Pitfalls Guide

This guide summarizes the key best practices and common pitfalls for defining effective tasks using the Parallel Task API, based on the official documentation.

## Task Specification Best Practices

### Schema Design

**Keep structures flat** - Avoid deeply nested structures and keep input/output schemas as flat as possible to optimize system performance and complexity handling.

> Reference: [Specify a Task - Task Spec Best Practices](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

**Use descriptive field names** - Choose clear, specific field names that leave no ambiguity:

- Use `ceo_name` instead of `name`
- Use `headquarters_address` instead of `address`
- Use `annual_revenue_2024` instead of `revenue`
  > Reference: [Specify a Task - Define effective outputs](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

**Specify data formats** - Always be explicit about data formatting requirements:

- Always specify format for dates: `YYYY-MM-DD`
- Use ranges for numerical values with units: `revenue_in_millions`, `employee_count`
- Specify quantities for lists: `top_5_products`, `recent_3_acquisitions`
  > Reference: [Specify a Task - Define effective outputs](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

### Effective Field Descriptions

Follow this structured format for field-level descriptions:

1. **Entity** (what are you researching)
2. **Action** (what do you want to find)
3. **Specifics** (constraints, time periods, formatting requirements)
4. **Error Handling** (e.g., "if unavailable, return 'Not Available'")

> Reference: [Specify a Task - Define effective outputs](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

### Input Design

**Be specific with text inputs** - When using only text-based inputs, be as specific as possible about what you expect the system to return. Include any instructions and preferences directly in the input text.

**Use minimum required fields for JSON inputs** - Include enough fields to uniquely identify the entity:

- Include both `company_name` and `company_website`
- Include both `person_name` and `social_url` to help the system disambiguate
  > Reference: [Specify a Task - Define effective inputs](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

**Keep input concise** - Deep Research is optimized for concise research prompts and inputs **under 15,000 characters** for optimal performance.

> Reference: [Deep Research - Creating a Deep Research Task](https://docs.parallel.ai/task-api/features/task-deep-research.md)

## Common Schema Pitfalls to Avoid

### Root Type Errors

```json
// ❌ Bad: Root type must be "object"
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "name": { "type": "string" }
    }
  }
}

// ✅ Good: Object root with array property
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" }
        },
        "required": ["name"]
      }
    }
  },
  "required": ["items"],
  "additionalProperties": false
}
```

> Reference: [Specify a Task - Common Schema Errors](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

### Missing Required Properties

```json
// ❌ Bad: Not all fields required
{
  "type": "object",
  "properties": {
    "field1": {"type": "string"},
    "field2": {"type": "string"}
  },
  "required": ["field1"] // Missing field2
}

// ✅ Good: All fields required
{
  "type": "object",
  "properties": {
    "field1": {"type": "string"},
    "field2": {"type": "string"}
  },
  "required": ["field1", "field2"],
  "additionalProperties": false
}
```

> Reference: [Specify a Task - Output Schema Validation Rules](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

### AnyOf at Root Level

```json
// ❌ Bad: Root level cannot use anyOf
{
  "type": "object",
  "anyOf": [
    {
      "properties": {
        "field1": { "type": "string" }
      }
    },
    {
      "properties": {
        "field2": { "type": "string" }
      }
    }
  ]
}

// ✅ Good: Combine properties into single object
{
  "type": "object",
  "properties": {
    "field1": { "type": "string" },
    "field2": { "type": "string" }
  },
  "required": ["field1", "field2"],
  "additionalProperties": false
}
```

> Reference: [Specify a Task - Common Schema Errors](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

### Unnecessary Fields

**Don't include** fields like `reasoning` or `confidence_score` - these are automatically included in the research basis and don't need to be specified in your output schema.

> Reference: [Specify a Task - Define effective outputs](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

**Avoid unsupported keywords** - The following JSON Schema keywords are not supported:
`contains`, `format`, `maxContains`, `maxItems`, `maxLength`, `maxProperties`, `maximum`, `minContains`, `minItems`, `minLength`, `minimum`, `minProperties`, `multipleOf`, `pattern`, `patternProperties`, `propertyNames`, `uniqueItems`, `unevaluatedItems`, `unevaluatedProperties`

> Reference: [Specify a Task - Unsupported Keywords](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

## High Confidence Output Pitfalls

### Overly Subjective Properties

**❌ Avoid subjective assessments:**

- `"market_disruption_potential"` - Requires predicting future impact
- `"most_strategically_significant"` - Subjective valuation of importance
- `"notable_series_a"` - Vague criteria for what's "notable"
- `"interesting_pricing_model"` - Undefined success criteria

**✅ Use fact-based alternatives:**

- `"product_category"` and `"target_market_size"`
- `"largest_acquisition_by_value"` with specific amount
- `"series_a_rounds_over_10m"` with clear threshold
- `"freemium_vs_subscription_model"` with defined categories

### Aggregation-Heavy Fields

**❌ Avoid complex aggregations:**

- `"sector_trending"` - Requires analyzing multiple deals to identify patterns
- `"most_active_vc_firm"` - Needs ranking across many entities
- `"geographic_hotspot"` - Complex geographic analysis across regions

**✅ Use concrete metrics:**

- `"top_3_sectors_by_funding_amount"` with specific format
- `"investors_with_3plus_deals_today"` with clear threshold
- `"funding_by_region"` with predefined regions list

### Interpretation-Based Fields

**❌ Avoid interpretive analysis:**

- `"competitive_response"` - Requires understanding strategic intent
- `"enforcement_action_severity"` - Subjective assessment of impact
- `"supply_chain_criticality"` - Complex impact assessment

**✅ Use verifiable data:**

- `"companies_announcing_partnerships"` with official announcements
- `"fines_over_1m_dollars"` with specific amounts and agencies
- `"materials_with_shortage_alerts"` from official sources

### Processor Complexity Mismatch

**❌ Common mismatches:**

- Using `core` processor for highly interpretive tasks
- Expecting `lite` processor to handle 10+ complex fields
- Using `pro` processor for simple data extraction

**✅ Proper processor selection:**

- `lite`/`base`: 2-5 factual fields, simple data extraction
- `core`: 5-10 fields with moderate complexity, clear success criteria
- `pro`/`ultra`: Complex analysis, 10+ fields, interpretive reasoning required

### Format Specification Gaps

**❌ Vague format requirements:**

- `"funding_amount"` without specifying millions/billions
- `"company_list"` without count or format specification
- `"recent_events"` without time frame definition

**✅ Explicit format requirements:**

- `"funding_amount_in_millions"` with format: "$X.XM"
- `"top_5_companies"` with format: "1. CompanyName, 2. CompanyName..."
- `"events_last_30_days"` with specific date range

## Processor Selection Guidelines

Choose processors based on task complexity and required reasoning depth:

- **`lite`/`base`**: Simple enrichments and basic metadata (~2-5 fields)
- **`core`**: Reliable accuracy for moderately complex outputs (~10 fields)
- **`pro`/`ultra`**: When reasoning depth is critical and for exploratory research (~20+ fields)
- **`ultra2x`/`ultra4x`/`ultra8x`**: For increasingly difficult deep research tasks

**Deep Research mode**: Use `auto` schema with `pro`+ processors for comprehensive, exploratory research that automatically generates optimal output structures.

> Reference: [Choose a Processor](https://docs.parallel.ai/task-api/core-concepts/choose-a-processor.md) and [Deep Research - Auto Schema](https://docs.parallel.ai/task-api/features/task-deep-research.md)

## Daily Task Optimization

### Time-Sensitive Data Challenges

**❌ Common daily task pitfalls:**

- Expecting real-time data that may not be indexed yet
- Using overly broad time windows ("recent developments")
- Requesting predictions based on single-day data

**✅ Daily task best practices:**

- Use specific date ranges: "announced on [YYYY-MM-DD]"
- Focus on events likely to be officially announced and indexed
- Request concrete data points rather than trend analysis
- Include fallback handling: "if no data for today, return 'No events found'"

### Source Availability Considerations

**❌ Unrealistic daily expectations:**

- Assuming all events are immediately published online
- Expecting comprehensive coverage of private company activities
- Requesting data that requires insider knowledge

**✅ Realistic daily monitoring:**

- Focus on publicly announced events and filings
- Target companies and sectors with high media coverage
- Use official sources: press releases, SEC filings, government announcements
- Include error handling for data unavailability

## Size and Performance Limits

### Hard Limits

- **Schema nesting depth**: Maximum 5 levels
- **Total properties**: Maximum 100 across all levels
- **Task spec size**: Maximum 10,000 characters
- **Total request size**: Maximum 15,000 characters (spec + input)
- **Enum values**: Maximum 500 across all properties
  > Reference: [Specify a Task - Size and Complexity Limits](https://docs.parallel.ai/task-api/core-concepts/specify-a-task.md)

### Rate Limits

- **2,000 requests per minute** per API key across all POST and GET requests
  > Reference: [Execute Task Run - Rate Limits](https://docs.parallel.ai/task-api/core-concepts/execute-task-run.md)

## Task Execution Best Practices

### For Long-Running Tasks

- Use **webhooks** or **server-sent events** instead of polling for Deep Research tasks (can take up to 15 minutes)
- Set `enable_events: true` for real-time progress updates on premium processors
  > Reference: [Webhooks](https://docs.parallel.ai/task-api/features/webhooks.md) and [Streaming Events](https://docs.parallel.ai/task-api/features/task-sse.md)

### For Multiple Tasks

- Use **AsyncParallel** client for concurrent execution of multiple task runs
- Consider batch processing approaches for high-volume scenarios
  > Reference: [Task Quickstart - Run Multiple Tasks](https://docs.parallel.ai/task-api/task-quickstart.md)

### Error Handling

- Always verify webhook signatures using HMAC-SHA256 for security
- Handle duplicate webhook events gracefully with idempotent processing
- Return 2xx status codes from webhook endpoints to avoid unnecessary retries
  > Reference: [Webhooks - Security & Reliability](https://docs.parallel.ai/task-api/features/webhooks.md)

## Source Policy Optimization

**Use either include OR exclude** - Use either `include_domains` OR `exclude_domains`, not both. When `include_domains` is set, `exclude_domains` is ignored.

**List apex domains only** - Specify domains in apex form like `example.com` (not `www.example.com` or `https://example.com`). Subdomains are automatically included.

**Respect limits** - Maximum 10 domains per request. No wildcards supported - each domain must be explicitly listed.

> Reference: [Source Policy](https://docs.parallel.ai/features/source-policy.md)

## Task States and Monitoring

### Understanding Task Lifecycle

Tasks progress through defined states: `queued` → `running` → `completed`/`failed`

**Running time varies** by processor type and task complexity. Use appropriate monitoring strategies:

- Polling for simple tasks
- Webhooks for production systems
- SSE for real-time progress updates
  > Reference: [Execute Task Run - Task Run States](https://docs.parallel.ai/task-api/core-concepts/execute-task-run.md)

## Research Basis and Citations

**Every output includes basis** - All task results include structured research basis with citations, reasoning, and confidence levels (on premium processors).

**Granular field-level citations** - Each output field is backed by specific web sources, allowing for transparent verification of results.

**Nested field support** - Deep Research provides citations for nested fields using slash notation (e.g., `key_players.0`, `industry_overview.growth_cagr`).

> Reference: [Access Research Basis](https://docs.parallel.ai/task-api/core-concepts/access-research-basis.md) and [Deep Research - Nested FieldBasis](https://docs.parallel.ai/task-api/features/task-deep-research.md)

---

Following these best practices will help ensure reliable task execution, proper schema validation, and optimal performance across different processor types and use cases.
