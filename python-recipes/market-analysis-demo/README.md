# AI-Powered Market Research Tool

A comprehensive web application that generates detailed market research reports using **Parallel's Deep Research API**. Built with Flask, this tool provides real-time streaming progress updates and delivers professional market analysis reports with comprehensive citations and competitive intelligence.

## ✨ Features

- **AI-Powered Research**: Uses Parallel's Deep Research API with "ultra2x" processor for comprehensive market analysis
- **Real-Time Progress Streaming**: Server-Sent Events (SSE) for live task progress updates with source tracking
- **Email Notifications**: Optional email alerts via Resend API when reports are ready
- **Public Report Library**: Browse all generated reports without any authentication required
- **Global Access**: No authentication needed - anyone can generate and view reports
- **Interactive Dashboard**: Clean, modern web interface with real-time progress visualization
- **Download Support**: Export reports as Markdown files
- **Shareable URLs**: Each report gets a unique URL slug for easy sharing
- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Input Validation**: Low-latency validation of inputs via Parallel's Chat API

## Quick Start

### Prerequisites

- Python 3.8 or higher
- **Parallel API key** (get yours at [platform.parallel.ai](https://platform.parallel.ai))
- **Supabase project** (for PostgreSQL database)
- **Resend API key** (optional, for email notifications)

### Installation

1. **Clone the repository**:

   ```bash
   git clone <repository-url>
   cd market-research-demo
   ```

2. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment variables**:
   Create a `.env.local` file with:

   ```env
   # Required - Parallel Deep Research API
   PARALLEL_API_KEY=your_parallel_api_key_here
   SECRET_KEY=your_secret_key_here
   
   # Required - Supabase Database
   POSTGRES_URL_NON_POOLING=postgresql://postgres:[password]@[host]/postgres
   # Or alternatively:
   # POSTGRES_URL=postgresql://postgres:[password]@[host]/postgres
   # DATABASE_URL=postgresql://postgres:[password]@[host]/postgres
   
   # Optional - Email Notifications via Resend
   RESEND_API_KEY=your_resend_api_key_here
   BASE_URL=https://yourdomain.com
   ```

4. **Set up your database** (see [Database Setup](#%EF%B8%8F-database-setup) below)

5. **Run the application**:

   ```bash
   python app.py
   ```

6. **Open your browser** and go to `http://localhost:5000`

## 🔑 API Keys Setup

### Parallel Deep Research API

1. Sign up at [platform.parallel.ai](https://platform.parallel.ai)
2. Navigate to your API keys section
3. Create a new API key
4. Add it to your `.env.local` as `PARALLEL_API_KEY`

**Documentation**: [Parallel Deep Research Docs](https://docs.parallel.ai/task-api/features/task-deep-research)

### Supabase (Database)

1. Create a free account at [supabase.com](https://supabase.com)
2. Create a new project
3. Go to **Settings** → **Database**
4. Copy the connection string (use the "Direct connection" or "Connection pooling" URL)
5. Add it to your `.env.local` as `POSTGRES_URL_NON_POOLING`

**Documentation**: [Supabase Database Setup](https://supabase.com/docs/guides/database/connecting-to-postgres)

### Resend (Email Notifications) - Optional

1. Sign up at [resend.com](https://resend.com)
2. Verify your domain or use the resend.dev domain for testing
3. Create an API key
4. Add it to your `.env.local` as `RESEND_API_KEY`

**Documentation**: [Resend API Documentation](https://resend.com/docs)

## 🗄️ Database Setup

The application requires PostgreSQL tables. The app will attempt to create them automatically, but you can also set them up manually:

```sql
-- Reports table (stores both running tasks and completed reports)
CREATE TABLE reports (
    id VARCHAR PRIMARY KEY,
    task_run_id VARCHAR UNIQUE NOT NULL,
    title VARCHAR,
    slug VARCHAR UNIQUE,
    industry VARCHAR NOT NULL,
    geography VARCHAR,
    details TEXT,
    content TEXT,
    basis JSONB,
    status VARCHAR DEFAULT 'running',
    session_id VARCHAR,
    email VARCHAR,
    is_public BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_slug ON reports(slug);
CREATE INDEX idx_reports_task_run_id ON reports(task_run_id);
CREATE INDEX idx_rate_limit_created_at ON rate_limit(created_at);
```

## 🎯 Usage

### Generating Reports

1. **Visit the homepage**: Open the application in your browser
2. **Fill out the form**:
   - **Industry** (required): e.g., "HVAC", "SaaS", "Electric Vehicles"
   - **Geography** (optional): Select target region or leave blank for global analysis
   - **Research Focus** (optional): Specify details like "CAGR analysis", "M&A activity", etc.
   - **Email** (optional): Get notified when your report is ready

3. **Launch Research**: Click "Launch AI Research" and watch real-time progress
4. **Real-Time Updates**: See live progress with source tracking and task status via SSE
5. **Get Results**: Reports are automatically saved and added to the public library

### Real-Time Progress Streaming

The application uses **Server-Sent Events (SSE)** to provide live updates during report generation:

- **Task Status**: See current processing stage
- **Source Tracking**: Monitor pages read vs. pages considered
- **Recent Sources**: View the most recently processed web sources
- **Progress Messages**: Get detailed updates on research progress
- **Completion Notification**: Automatic redirect when report is ready

### Browsing Reports

- **Public Library**: All reports are publicly viewable without any authentication
- **Direct URLs**: Each report gets a unique URL like `/report/hvac-market-research-report`
- **Download**: Click the download button to get a Markdown file
- **Share**: Copy and share report URLs with anyone
- **Print**: Reports are optimized for professional printing

## 📡 Server-Sent Events (SSE) Implementation

This app showcases advanced SSE implementation for real-time AI task monitoring:

### SSE Features

- **Real-time progress updates** during report generation
- **Source tracking** with live statistics
- **Robust reconnection** with exponential backoff
- **Graceful error handling** and recovery
- **Automatic completion detection** and report saving

### SSE Endpoints

- `GET /stream-events/<task_run_id>` - Main SSE stream for task progress
- `POST /monitor-task/<task_run_id>` - Fallback monitoring with robust reconnection
- `GET /task-status/<task_run_id>` - Polling fallback for task status

### SSE Documentation

For detailed SSE implementation patterns, see the code in:

- `stream_task_events()` function - Core SSE streaming logic
- `monitor_task_completion_robust()` - Robust reconnection with exponential backoff
- JavaScript SSE handling in `static/js/app.js`

## ⚙️ Configuration

### Environment Variables

```env
# Required - Core Application
PARALLEL_API_KEY=your_parallel_api_key          # Parallel Deep Research API key
SECRET_KEY=your_secret_key                      # Flask session secret

# Required - Database (use one of these)
POSTGRES_URL_NON_POOLING=postgresql://...       # Supabase direct connection (recommended)
POSTGRES_URL=postgresql://...                   # Supabase pooled connection
DATABASE_URL=postgresql://...                   # Alternative database URL

# Optional - Email Notifications
RESEND_API_KEY=your_resend_api_key              # Resend email API key
BASE_URL=https://yourdomain.com                 # Your app's base URL for email links

# Optional - Rate Limiting
MAX_REPORTS_PER_HOUR=100                        # Global reports per hour (default: 100)
```

### Customization

- **Rate Limits**: Modify `MAX_REPORTS_PER_HOUR` in `app.py`
- **Styling**: Edit `static/css/style.css` for custom themes
- **Templates**: Modify HTML templates in the `templates/` directory
- **Email Templates**: Customize `templates/email_report_ready.html`

## 🏗️ Architecture

### Technology Stack
- **Backend**: Flask (Python web framework)
- **Database**: PostgreSQL via Supabase
- **AI Research**: Parallel Deep Research API ("ultra2x" processor)
- **Email**: Resend API for notifications
- **Real-time**: Server-Sent Events (SSE) for progress streaming
- **Frontend**: Bootstrap 5, Font Awesome icons, custom CSS
- **Deployment**: Vercel-ready with serverless configuration

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main dashboard with form and report library |
| `/generate-report` | POST | Generate new report (returns task_run_id) |
| `/stream-events/<task_run_id>` | GET | SSE stream for real-time progress |
| `/monitor-task/<task_run_id>` | POST | Monitor task with robust reconnection |
| `/complete-task/<task_run_id>` | POST | Complete task and save report |
| `/task-status/<task_run_id>` | GET | Get current task status |
| `/report/<slug>` | GET | View specific report |
| `/download/<slug>` | GET | Download report as Markdown |
| `/api/status` | GET | Check rate limit status |
| `/api/library-html` | GET | Get library section HTML for updates |
| `/api/active-tasks` | GET | Get active tasks for monitoring |

### Project Structure

```
market-research-demo/
├── app.py                          # Main Flask application
├── requirements.txt                # Python dependencies
├── runtime.txt                     # Python version for deployment
├── vercel.json                     # Vercel deployment configuration
├── .env.local                      # Environment variables (create this)
├── README.md                       # This file
├── templates/                      # HTML templates
│   ├── base.html                   # Base template
│   ├── index.html                  # Main dashboard
│   ├── report.html                 # Report view page
│   ├── email_report_ready.html     # Email notification template
│   └── 404.html                    # Error page
└── static/                         # Static assets
    ├── css/
    │   └── style.css               # Custom styles
    └── js/
        └── app.js                  # Frontend JavaScript with SSE handling
```

## 🐛 Troubleshooting

### Common Issues

1. **API Key Errors**:

   ```text
   ValueError: PARALLEL_API_KEY not found in environment variables
   ```

   - Ensure your `.env.local` file exists and contains the correct API key
   - Verify the key is active at [platform.parallel.ai](https://platform.parallel.ai)

2. **Database Connection Errors**:

   ```text
   ValueError: No PostgreSQL URL found in environment variables
   ```

   - Check your Supabase connection string is correct
   - Ensure your Supabase project is active and the database is accessible

3. **Email Notification Issues**:
   - Resend API key missing: emails will be skipped (not an error)
   - Domain verification required for production email sending
   - Check Resend dashboard for delivery status

4. **SSE Connection Problems**:
   - Browser may limit concurrent SSE connections
   - Network proxies might block SSE streams
   - Fallback monitoring systems will still complete tasks

### Debug Mode

Set `DEBUG=True` in your environment for detailed error messages:

```env
DEBUG=True
```

## 🚀 Production Deployment

### Vercel Deployment (Recommended)

This app is optimized for Vercel deployment:

1. **Push to GitHub** and connect to Vercel
2. **Set environment variables** in Vercel dashboard
3. **Deploy**: Vercel will automatically build and deploy

### Manual Production Setup

For other platforms:

1. Set `DEBUG=False`
2. Use a production WSGI server (Gunicorn recommended)
3. Set up proper logging and monitoring
4. Configure environment variables securely
5. Set up SSL/HTTPS for production domains

### Environment Variables for Production

```env
# Production settings
DEBUG=False
BASE_URL=https://your-production-domain.com

# Database (use NON_POOLING for serverless)
POSTGRES_URL_NON_POOLING=postgresql://...

# Required API keys
PARALLEL_API_KEY=your_production_parallel_key
RESEND_API_KEY=your_production_resend_key
SECRET_KEY=your_secure_secret_key
```

## 📚 Additional Resources

### Parallel Deep Research

- **Platform**: [platform.parallel.ai](https://platform.parallel.ai)
- **Documentation**: [docs.parallel.ai](https://docs.parallel.ai/task-api/features/task-sse)
- **API Reference**: [Deep Research API](https://docs.parallel.ai/api-reference/task-api-v1/create-task-run)


### 🤝 Contributing

This is a demo application showcasing Parallel's Deep Research capabilities and modern web development patterns including SSE streaming. Feel free to fork and modify for your own use cases.
