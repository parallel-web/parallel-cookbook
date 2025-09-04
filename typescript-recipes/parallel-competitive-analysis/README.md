# Competitor Analysis - AI-Powered Market Research

An intelligent competitive analysis tool that researches companies, identifies competitors, and mines Reddit for real user insights to create comprehensive market research reports.

![Competitor Analysis Demo](https://via.placeholder.com/800x400?text=Competitor+Analysis+Demo)

## Features

- **Company Research**: AI automatically researches target companies to understand their business model, UVP, and market position
- **Competitor Identification**: Finds 4-6 key direct and indirect competitors in the same market space  
- **Reddit Mining**: Analyzes Reddit discussions for authentic user opinions and market insights
- **SEO-Optimized Reports**: Generates public, shareable competitive analysis pages optimized for search engines
- **Real-time Analysis**: Live progress tracking with webhook updates
- **User Authentication**: Simple X/Twitter login with usage limits

## How It Works

1. **Company Research**: User enters a company domain (e.g., `openai.com`, `stripe.com`)
2. **AI Analysis**: The system uses Parallel's Task API with Reddit MCP to:
   - Research the target company's business model and positioning
   - Identify key competitors with similar value propositions
   - Mine Reddit discussions for user opinions and market insights
3. **Report Generation**: Creates a comprehensive analysis including:
   - Company overview and unique value proposition
   - Detailed competitor analysis with strengths/weaknesses
   - Reddit community insights and sentiment
   - Strategic recommendations and key insights
4. **Public Results**: Each analysis gets a shareable URL with full SEO optimization

## Tech Stack

- **Backend**: Cloudflare Workers with Durable Objects (SQLite storage)
- **AI Processing**: [Parallel Task API](https://docs.parallel.ai/) with MCP tool calling
- **Data Source**: Reddit MCP server for community insights
- **Authentication**: SimpleAuth for X/Twitter login
- **Frontend**: Pure HTML/CSS/JS with Tailwind CSS
- **Fonts**: Parallel design system assets

## JSON Schema

The AI generates structured competitive analysis data:

```json
{
  "company_overview": {
    "name": "string",
    "domain": "string", 
    "description": "string",
    "unique_value_proposition": "string",
    "target_market": "string",
    "business_model": "string"
  },
  "competitors": [
    {
      "name": "string",
      "website": "string",
      "description": "string", 
      "strengths": ["string"],
      "weaknesses": ["string"],
      "market_share": "string",
      "differentiation": "string"
    }
  ],
  "reddit_insights": [
    {
      "topic": "string",
      "summary": "string",
      "sentiment": "positive|negative|mixed|neutral",
      "sources": [
        {
          "title": "string",
          "url": "string", 
          "excerpt": "string"
        }
      ]
    }
  ],
  "key_insights": [
    {
      "title": "string",
      "description": "string",
      "impact": "high|medium|low"
    }
  ]
}
```

## Setup

1. **Clone and Install**:
   ```bash
   git clone <repository>
   cd competitor-analysis
   npm install
   ```

2. **Environment Variables**:
   ```bash
   cp .env.example .env
   # Fill in your API keys
   ```

3. **Deploy**:
   ```bash
   npm run deploy
   ```

4. **Configure**:
   - Set up your domain in `wrangler.json`
   - Configure Reddit MCP server URL
   - Set up Parallel API credentials
   - Configure webhook secret for result callbacks

## API Endpoints

- `GET /` - Homepage with popular and recent analyses
- `GET /new?company=domain.com` - Create new analysis (requires auth)
- `GET /analysis/{slug}` - View analysis results
- `POST /webhook` - Parallel webhook for task completion

## Usage Limits

- 5 free analyses per user (demo limitation)
- Analysis takes up to 10 minutes depending on complexity
- Results are cached and publicly shareable

## Inspiration

Inspired by [Exa's Company Researcher](https://github.com/exa-labs/company-researcher) but focused on competitive analysis with Reddit community insights for authentic market research.

## License

MIT License - feel free to fork and customize for your needs!