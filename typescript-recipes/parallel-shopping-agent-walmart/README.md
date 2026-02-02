# Walmart Shopping Assistant

A Walmart-branded AI shopping assistant powered by Parallel Search API and Cerebras AI. This application helps users make smarter shopping decisions by conducting thorough product research and providing comprehensive shopping recommendations.

## Features

- **Smart Product Search**: AI-powered search that understands natural language shopping queries
- **Multi-Angle Research**: Conducts 1-3 searches from different perspectives (reviews, pricing, alternatives)
- **Real-time Streaming**: Results stream in real-time as the AI searches and analyzes
- **Walmart Branding**: Beautiful interface styled with Walmart's brand colors and design
- **Configurable Prompts**: Users can customize the system prompt for different shopping needs

## Technology Stack

- **Parallel Search API** - AI-native search that provides relevant context in a single call
- **Vercel AI SDK** - Handles streaming AI responses and tool calling
- **Cerebras Qwen 3 235B** - Fast, powerful LLM for product research
- **Cloudflare Workers** - Serverless deployment platform

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
# Create a .env file with:
PARALLEL_API_KEY=your_parallel_api_key
CEREBRAS_API_KEY=your_cerebras_api_key
```

3. Submit secrets to Cloudflare:
```bash
wrangler secret bulk .env
```

## Development

Run the development server:
```bash
npm run dev
```

## Deployment

Deploy to Cloudflare Workers:
```bash
npm run deploy
```

## How It Works

1. User enters a shopping query (e.g., "best wireless headphones under $200")
2. The AI agent uses Parallel's Search API to search from multiple angles:
   - Product reviews and ratings
   - Price comparisons
   - Alternative options
   - Technical specifications
3. Results stream back in real-time with:
   - Search progress indicators
   - AI reasoning (when enabled)
   - Product findings and excerpts
   - Final shopping recommendation
4. User receives a comprehensive shopping report with product recommendations, pricing, pros/cons, and alternatives

## Walmart Branding

This application uses Walmart's official brand guidelines:
- **Colors**: Ripe Mango (#fbc424), Solar Energy (#f8d975), Frosted Blueberries (#0554e2)
- **Slogan**: "Save Money. Live Better."
- **Logo**: Official Walmart SVG logo

## License

This is a demo application built on the [Parallel Cookbook](https://github.com/parallel-web/parallel-cookbook) template.
