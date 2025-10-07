import os
import json
import uuid
import datetime
import re
import requests
import threading
import time
from typing import Dict, Any, Optional
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_file, Response, stream_template, render_template_string
from werkzeug.utils import secure_filename
import tempfile
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
import urllib.parse

from parallel import Parallel
from parallel.types import TaskSpecParam
# Removed OpenAI import - using direct requests to Parallel API

# Load environment variables
load_dotenv('.env.local')

app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY', 'your-secret-key-here')

# Initialize Parallel client
PARALLEL_API_KEY = os.getenv('PARALLEL_API_KEY')
if not PARALLEL_API_KEY:
    raise ValueError("PARALLEL_API_KEY not found in environment variables")

client = Parallel(api_key=PARALLEL_API_KEY)

# Initialize OpenAI client for Parallel's chat completions API (used for validation)
try:
    openai_client = OpenAI(
        api_key=PARALLEL_API_KEY,
        base_url="https://api.parallel.ai",
        timeout=30.0,
        max_retries=3
    )
except Exception as e:
    print(f"Warning: Failed to initialize OpenAI client: {e}")
    openai_client = None

# Email configuration
RESEND_API_KEY = os.getenv('RESEND_API_KEY')
BASE_URL = os.getenv('BASE_URL', 'https://aimarketresearch.app')

# Configuration
MAX_REPORTS_PER_HOUR = 100  # Global rate limit: 100 reports per hour

# Try different Supabase connection URLs in order of preference
DATABASE_URL = (
    os.getenv('POSTGRES_URL_NON_POOLING') or  # Best for serverless
    os.getenv('POSTGRES_URL') or 
    os.getenv('DATABASE_URL')
)

if not DATABASE_URL:
    raise ValueError("No PostgreSQL URL found in environment variables")

# Clean the URL to remove unsupported query parameters
def clean_database_url(url):
    """Remove query parameters that psycopg2 doesn't support"""
    if '?' in url:
        base_url, query_string = url.split('?', 1)
        # Parse query parameters
        import urllib.parse
        params = urllib.parse.parse_qs(query_string)
        
        # Keep only psycopg2-supported parameters
        supported_params = ['sslmode', 'connect_timeout', 'application_name']
        clean_params = {k: v for k, v in params.items() if k in supported_params}
        
        if clean_params:
            clean_query = urllib.parse.urlencode(clean_params, doseq=True)
            return f"{base_url}?{clean_query}"
        else:
            return base_url
    return url

DATABASE_URL = clean_database_url(DATABASE_URL)

# Initialize connection pool
connection_pool = None

# In-memory task tracking for background monitoring
active_tasks = {}  # {task_run_id: {'metadata': task_metadata, 'thread': thread_obj}}
completed_tasks = set()  # Track completed tasks to prevent duplicate processing


def get_db_connection():
    """Get a database connection"""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

def verify_database_connection():
    """Simple database connection test"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT 1')
        cursor.close()
        conn.close()
        print("✅ Database connection verified")
        return True
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False

def get_recent_report_count():
    """Get the number of reports generated in the last hour (global rate limiting)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get count of reports in the last hour
    one_hour_ago = datetime.datetime.now() - datetime.timedelta(hours=1)
    cursor.execute('SELECT COUNT(*) as count FROM rate_limit WHERE created_at > %s', (one_hour_ago,))
    result = cursor.fetchone()
    
    cursor.close()
    conn.close()
    return result['count'] if result else 0

def record_report_generation():
    """Record a new report generation for global rate limiting"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('INSERT INTO rate_limit DEFAULT VALUES')
    
    conn.commit()
    cursor.close()
    conn.close()

def send_report_ready_email(email, report_title, report_slug, task_id):
    """Send email notification when report is ready using Resend API"""
    if not RESEND_API_KEY or not email:
        print(f"Skipping email: RESEND_API_KEY={'present' if RESEND_API_KEY else 'missing'}, email={'present' if email else 'missing'}")
        return False
    
    try:
        # Build the report URL
        report_url = f"{BASE_URL}/report/{report_slug}"
        
        # Render the email HTML template
        html_content = render_template(
            'email_report_ready.html',
            report_title=report_title,
            report_url=report_url,
            task_id=task_id
        )
        
        # Prepare email data
        email_data = {
            "from": "Market Research <updates@aimarketresearch.app>",
            "to": [email],
            "subject": "Market Research report is now available",
            "html": html_content,
            "reply_to": "updates@aimarketresearch.app"
        }
        
        # Send email via Resend API
        headers = {
            'Authorization': f'Bearer {RESEND_API_KEY}',
            'Content-Type': 'application/json'
        }
        
        response = requests.post(
            'https://api.resend.com/emails',
            headers=headers,
            json=email_data,
            timeout=30
        )
        
        if response.status_code == 200:
            print(f"✅ Email sent successfully to {email} for report {report_slug}")
            return True
        else:
            print(f"❌ Email failed: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Email sending error: {e}")
        return False

def create_slug(title):
    """Create URL-friendly slug from title"""
    # Remove special characters and convert to lowercase
    slug = re.sub(r'[^a-zA-Z0-9\s-]', '', title)
    slug = re.sub(r'\s+', '-', slug.strip())
    slug = slug.lower()
    
    # Ensure uniqueness by checking database
    base_slug = slug
    counter = 1
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    while True:
        cursor.execute('SELECT id FROM reports WHERE slug = %s', (slug,))
        if not cursor.fetchone():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1
    
    cursor.close()
    conn.close()
    return slug

def generate_market_research_input(industry, geography, details):
    """Generate research input based on user parameters"""
    geography_text = geography if geography and geography.strip() else "Not specified"
    details_text = details if details and details.strip() else "Not specified"
    
    research_input = (
        "Generate a comprehensive market research report based on the following criteria:\n\n"
        "If geography is not specified, default to a global market scope.\n"
        "Ensure the report includes key trends, risks, metrics, and major players.\n"
        "Incorporate the specific details provided when applicable.\n\n"
        f"Industry: {industry}\n"
        f"Geography: {geography_text}\n"
        f"Specific Details Required: {details_text}"
    )
    
    return research_input

def convert_basis_to_dict(basis):
    """Convert FieldBasis objects to dictionaries for JSON serialization"""
    if not basis:
        return None
    
    result = []
    for field_basis in basis:
        # Convert FieldBasis object to dictionary
        basis_dict = {
            'field': getattr(field_basis, 'field', ''),
            'reasoning': getattr(field_basis, 'reasoning', ''),
            'confidence': getattr(field_basis, 'confidence', None),
            'citations': []
        }
        
        # Convert citation objects to dictionaries
        citations = getattr(field_basis, 'citations', [])
        if citations:
            for citation in citations:
                citation_dict = {
                    'url': getattr(citation, 'url', ''),
                    'excerpts': getattr(citation, 'excerpts', [])
                }
                basis_dict['citations'].append(citation_dict)
        
        result.append(basis_dict)
    
    return result

def save_report(title, slug, industry, geography, details, content, basis=None, task_run_id=None):
    """Complete a task by updating it with final report data"""
    # Final safety check to prevent NULL values reaching database
    if not title or not isinstance(title, str):
        print(f"⚠️  Invalid title detected: {repr(title)}, creating fallback")
        title = f"Market Research Report {task_run_id[-8:] if task_run_id else 'unknown'}"
    
    if not slug or not isinstance(slug, str):
        print(f"⚠️  Invalid slug detected: {repr(slug)}, creating fallback")
        slug = f"market-report-{task_run_id[-12:] if task_run_id else 'unknown'}"
    
    # Clean content to prevent PostgreSQL errors
    if content and isinstance(content, str):
        original_length = len(content)
        # Remove NULL characters and other problematic characters
        content = content.replace('\x00', '')  # Remove NULL bytes
        content = content.replace('\uffff', '')  # Remove Unicode replacement characters
        cleaned_length = len(content)
        
        if original_length != cleaned_length:
            removed_chars = original_length - cleaned_length
            print(f"🧹 Cleaned content: removed {removed_chars} problematic character(s)")
    
    # Clean other string fields as well
    if title and isinstance(title, str):
        title = title.replace('\x00', '').replace('\uffff', '')
    if slug and isinstance(slug, str):
        slug = slug.replace('\x00', '').replace('\uffff', '')
    if industry and isinstance(industry, str):
        industry = industry.replace('\x00', '').replace('\uffff', '')
    if geography and isinstance(geography, str):
        geography = geography.replace('\x00', '').replace('\uffff', '')
    if details and isinstance(details, str):
        details = details.replace('\x00', '').replace('\uffff', '')
    
    print(f"💾 Saving report: title='{title}', slug='{slug}', task_run_id='{task_run_id}'")
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Check if task already completed AND has content (skip only if fully complete)
        if task_run_id:
            cursor.execute('SELECT status, content FROM reports WHERE task_run_id = %s', (task_run_id,))
            existing_task = cursor.fetchone()
            if existing_task and existing_task['status'] == 'completed' and existing_task['content'] is not None:
                print(f"Task {task_run_id} already completed with content, skipping duplicate save")
                cursor.close()
                conn.close()
                return task_run_id  # Return task_run_id as report_id
        
        # Convert basis to JSON string if provided
        basis_json = None
        if basis:
            try:
                basis_dict = convert_basis_to_dict(basis)
                basis_json = json.dumps(basis_dict) if basis_dict else None
                # Clean basis JSON as well
                if basis_json and isinstance(basis_json, str):
                    basis_json = basis_json.replace('\x00', '').replace('\uffff', '')
            except Exception as e:
                print(f"Error converting basis to JSON: {e}")
                basis_json = None
        
        # Generate unique ID for slug conflicts
        report_id = str(uuid.uuid4())
        
        # Update existing running task to completed status
        cursor.execute('''
            UPDATE reports 
            SET id = %s, title = %s, slug = %s, content = %s, basis = %s, 
                status = 'completed', completed_at = CURRENT_TIMESTAMP,
                is_public = TRUE
            WHERE task_run_id = %s
        ''', (report_id, title, slug, content, basis_json, task_run_id))
        
        if cursor.rowcount == 0:
            # Task doesn't exist, create new completed report
            cursor.execute('''
                INSERT INTO reports (id, task_run_id, title, slug, industry, geography, details, content, basis, status, completed_at, is_public)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'completed', CURRENT_TIMESTAMP, TRUE)
            ''', (report_id, task_run_id, title, slug, industry, geography, details, content, basis_json))
        
        conn.commit()
        print(f"Successfully completed task {task_run_id} with report {report_id}")
        
        # Send email notification if email was provided during task creation
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT email FROM reports WHERE task_run_id = %s', (task_run_id,))
            email_result = cursor.fetchone()
            cursor.close()
            
            if email_result and email_result['email']:
                email = email_result['email']
                print(f"Sending report ready email to {email}")
                send_report_ready_email(email, title, slug, task_run_id)
            else:
                print("No email provided for this task, skipping email notification")
        except Exception as e:
            print(f"Error sending email notification: {e}")
            # Don't fail the report saving if email fails
        
        return report_id
        
    except psycopg2.IntegrityError as e:
        # Handle case where slug already exists (create new slug)
        if "slug" in str(e).lower():
            # Generate new slug and retry
            base_slug = slug
            counter = 1
            while True:
                new_slug = f"{base_slug}-{counter}"
                cursor.execute('SELECT id FROM reports WHERE slug = %s', (new_slug,))
                if not cursor.fetchone():
                    slug = new_slug
                    break
                counter += 1
            
            # Retry with new slug
            cursor.execute('''
                UPDATE reports 
                SET id = %s, title = %s, slug = %s, content = %s, basis = %s, 
                    status = 'completed', completed_at = CURRENT_TIMESTAMP,
                    is_public = TRUE
                WHERE task_run_id = %s
            ''', (report_id, title, slug, content, basis_json, task_run_id))
            
            conn.commit()
            print(f"Successfully completed task {task_run_id} with adjusted slug {slug}")
            
            # Send email notification if email was provided during task creation
            try:
                cursor = conn.cursor()
                cursor.execute('SELECT email FROM reports WHERE task_run_id = %s', (task_run_id,))
                email_result = cursor.fetchone()
                cursor.close()
                
                if email_result and email_result['email']:
                    email = email_result['email']
                    print(f"Sending report ready email to {email}")
                    send_report_ready_email(email, title, slug, task_run_id)
                else:
                    print("No email provided for this task, skipping email notification")
            except Exception as e:
                print(f"Error sending email notification: {e}")
                # Don't fail the report saving if email fails
            
            return report_id
        else:
            raise e
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()
        conn.close()

def repair_null_slug_report(task_run_id):
    """Repair a report with NULL slug using available data"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Get the report with NULL title/slug
        cursor.execute('''
            SELECT industry, geography, content 
            FROM reports 
            WHERE task_run_id = %s AND (title IS NULL OR slug IS NULL) AND content IS NOT NULL
        ''', (task_run_id,))
        
        result = cursor.fetchone()
        if not result:
            return None
            
        # Generate title and slug from available data
        industry = result['industry'] or f"Report {task_run_id[-8:]}"
        geography = result['geography']
        
        title = f"{industry} Market Research Report"
        if geography and geography.strip() and geography != "Not specified":
            title += f" - {geography}"
            
        slug = create_slug(title)
        
        # Update the record
        cursor.execute('''
            UPDATE reports 
            SET title = %s, slug = %s 
            WHERE task_run_id = %s
        ''', (title, slug, task_run_id))
        
        conn.commit()
        print(f"🔧 Auto-repaired NULL slug report {task_run_id}: title='{title}', slug='{slug}'")
        
        cursor.close()
        conn.close()
        return {'title': title, 'slug': slug}
        
    except Exception as e:
        print(f"❌ Failed to repair NULL slug report {task_run_id}: {e}")
        conn.rollback()
        cursor.close()
        conn.close()
        return None

def get_report_by_slug(slug):
    """Get report by slug (public access) with auto-repair for broken links"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Handle broken email links from NULL slug reports
    if slug == "None":
        print("🔧 Detected broken email link (/report/None), searching for NULL slug report to repair...")
        
        # Find the most recent NULL slug report
        cursor.execute('''
            SELECT task_run_id, industry, geography
            FROM reports 
            WHERE slug IS NULL AND content IS NOT NULL AND status = 'completed'
            ORDER BY completed_at DESC
            LIMIT 1
        ''', ())
        
        null_result = cursor.fetchone()
        if null_result:
            task_run_id = null_result['task_run_id']
            print(f"🔧 Found NULL slug report {task_run_id}, attempting auto-repair...")
            
            # Try to repair it
            repair_result = repair_null_slug_report(task_run_id)
            if repair_result:
                # Successfully repaired, use the new slug
                slug = repair_result['slug']
                print(f"✅ Auto-repaired and redirecting to: /report/{slug}")
    
    cursor.execute('''
        SELECT id, title, industry, geography, details, content, basis, created_at, task_run_id
        FROM reports WHERE slug = %s AND is_public = %s
    ''', (slug, True))
    
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    
    if result:
        # Parse basis JSON if it exists
        basis_data = None
        if result['basis']:  # basis column
            try:
                basis_data = json.loads(result['basis'])
            except (json.JSONDecodeError, TypeError):
                basis_data = None
                
        return {
            'id': result['id'],
            'title': result['title'],
            'industry': result['industry'],
            'geography': result['geography'],
            'details': result['details'],
            'content': result['content'],
            'basis': basis_data,
            'created_at': result['created_at'],
            'task_run_id': result['task_run_id'],
            'slug': slug
        }
    return None

def get_all_public_reports():
    """Get all public reports for the library"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, title, slug, industry, geography, created_at
        FROM reports WHERE is_public = %s AND status = 'completed'
        ORDER BY created_at DESC
    ''', (True,))
    
    results = cursor.fetchall()
    cursor.close()
    conn.close()
    
    # Add color for each report
    colors = ['#FF6B35', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9']
    
    return [{
        'id': row['id'],
        'title': row['title'],
        'slug': row['slug'],
        'industry': row['industry'],
        'geography': row['geography'],
        'created_at': row['created_at'],
        'company_color': colors[i % len(colors)]
    } for i, row in enumerate(results)]

def get_all_public_reports_limited(limit):
    """Get limited public reports for the library"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, title, slug, industry, geography, created_at
        FROM reports WHERE is_public = %s AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT %s
    ''', (True, limit))
    
    results = cursor.fetchall()
    cursor.close()
    conn.close()
    
    # Add color for each report (like in original function)
    colors = ['#FF6B35', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9']
    
    return [{
        'id': row['id'],
        'title': row['title'],
        'slug': row['slug'],
        'industry': row['industry'],
        'geography': row['geography'],
        'created_at': row['created_at'],
        'company_color': colors[i % len(colors)]
    } for i, row in enumerate(results)]

def save_running_task(task_run_id, industry, geography, details, session_id, email=None):
    """Save running task to unified reports table"""
    print(f"DEBUG: save_running_task called with: {task_run_id}, {industry}, {geography}, {details}, {session_id}, {email}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Check if task already exists
        cursor.execute('SELECT task_run_id FROM reports WHERE task_run_id = %s', (task_run_id,))
        if cursor.fetchone():
            # Update existing task
            cursor.execute('''
                UPDATE reports 
                SET status = 'running', created_at = CURRENT_TIMESTAMP, email = %s
                WHERE task_run_id = %s
            ''', (email, task_run_id))
        else:
            # Insert new task (id will be NULL for running tasks)
            cursor.execute('''
                INSERT INTO reports (task_run_id, industry, geography, details, status, session_id, email)
                VALUES (%s, %s, %s, %s, 'running', %s, %s)
            ''', (task_run_id, industry, geography, details, session_id, email))
        
        rows_affected = cursor.rowcount
        conn.commit()
        print(f"SUCCESS: Saved running task {task_run_id} to reports table (rows affected: {rows_affected})")
        
        # Verify it was saved
        cursor.execute('SELECT status FROM reports WHERE task_run_id = %s', (task_run_id,))
        result = cursor.fetchone()
        print(f"VERIFY: Task {task_run_id} status in DB: {result['status'] if result else 'NOT FOUND'}")
        
    except Exception as e:
        print(f"ERROR saving running task {task_run_id}: {e}")
        print(f"ERROR details: {type(e).__name__}: {str(e)}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

def get_running_tasks():
    """Get all running tasks from unified reports table"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check for old running or failed tasks and verify their actual status with Parallel API
    four_hours_ago = datetime.datetime.now() - datetime.timedelta(hours=4)
    
    # Find old running or failed tasks that might need status verification
    cursor.execute('''
        SELECT task_run_id, industry, geography, details, created_at, status
        FROM reports 
        WHERE (status = 'running' OR status = 'failed') AND created_at < %s
    ''', (four_hours_ago,))
    old_tasks = cursor.fetchall()
    
    if old_tasks:
        print(f"🔍 Found {len(old_tasks)} old running/failed tasks, checking actual status...")
        for task in old_tasks:
            task_run_id = task['task_run_id']
            print(f"   - Checking task {task_run_id}: {task['industry']} (status: {task['status']}, started {task['created_at']})")
            
            # Check actual task status with Parallel API
            try:
                run_result = client.task_run.result(task_run_id)
                # If we get here, task is complete - save the report
                print(f"   ✅ Task {task_run_id} actually completed, saving report...")
                
                content = getattr(run_result.output, "content", "No content found.")
                basis = getattr(run_result.output, "basis", None)
                
                # Create title and slug
                title = f"{task['industry']} Market Research Report"
                if task['geography'] and task['geography'] != "Not specified":
                    title += f" - {task['geography']}"
                
                slug = create_slug(title)
                
                # Save the completed report
                report_id = save_report(
                    title, slug,
                    task['industry'],
                    task['geography'], 
                    task['details'],
                    content,
                    basis,
                    task_run_id=task_run_id
                )
                
                record_report_generation()
                print(f"   ✅ Saved report {report_id} for task {task_run_id}")
                
            except Exception as e:
                # Task is still running, queued, or failed - check the actual error
                error_str = str(e).lower()
                if 'not found' in error_str or 'invalid' in error_str:
                    # Task doesn't exist in Parallel API - might be a database inconsistency
                    print(f"   ❌ Task {task_run_id} not found in Parallel API - marking as failed")
                    cursor.execute('''
                        UPDATE reports 
                        SET status = 'failed', error_message = 'Task not found in Parallel API', completed_at = CURRENT_TIMESTAMP
                        WHERE task_run_id = %s
                    ''', (task_run_id,))
                else:
                    # Task exists but still processing (queued/running) - leave it alone
                    print(f"   ⏳ Task {task_run_id} still processing in Parallel API: {e}")
                    # Don't mark as timed out - let it continue
    
    # Check for failed tasks that might need retry (separate from the recovery above)
    retry_failed_tasks()
    
    # Get all running tasks
    cursor.execute('''
        SELECT task_run_id, industry, geography, details, created_at
        FROM reports 
        WHERE status = 'running'
        ORDER BY created_at DESC
    ''')
    
    results = cursor.fetchall()
    
    conn.commit()
    cursor.close()
    conn.close()
    
    return [{
        'task_run_id': row['task_run_id'],
        'industry': row['industry'],
        'geography': row['geography'],
        'details': row['details'],
        'created_at': row['created_at']
    } for row in results]

def retry_failed_tasks():
    """Check for failed tasks and retry them if they failed due to recoverable errors"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Find tasks that failed due to recoverable errors (not too old)
    cursor.execute('''
        SELECT task_run_id, industry, geography, details, error_message, created_at
        FROM reports 
        WHERE status = 'failed' 
        AND error_message IS NOT NULL
        AND (
            error_message ILIKE '%timeout%' OR 
            error_message ILIKE '%connection%' OR 
            error_message ILIKE '%network%' OR 
            error_message ILIKE '%server error%' OR
            error_message ILIKE '%Task timed out%'
        )
        AND created_at > NOW() - INTERVAL '24 hours'  -- Only retry recent failures
        AND created_at < NOW() - INTERVAL '1 hour'    -- But not too recent (give them time)
    ''')
    
    failed_tasks = cursor.fetchall()
    
    if failed_tasks:
        print(f"🔄 Found {len(failed_tasks)} failed tasks with recoverable errors, retrying...")
        for task in failed_tasks:
            task_run_id = task['task_run_id']
            print(f"   - Retrying task {task_run_id}: {task['industry']} (failed: {task['error_message']})")
            
            # Reset task status to running for retry
            cursor.execute('''
                UPDATE reports 
                SET status = 'running', error_message = NULL, completed_at = NULL
                WHERE task_run_id = %s
            ''', (task_run_id,))
            
            # Start background monitoring for the retry
            task_metadata = {
                'industry': task['industry'],
                'geography': task['geography'],
                'details': task['details']
            }
            
            monitor_thread = threading.Thread(
                target=monitor_task_completion,
                args=(task_run_id, task_metadata),
                daemon=True
            )
            monitor_thread.start()
            
            # Track active task
            active_tasks[task_run_id] = {
                'metadata': task_metadata,
                'thread': monitor_thread,
                'start_time': datetime.datetime.now()
            }
            
            print(f"   ✅ Restarted monitoring for task {task_run_id}")
    
    conn.commit()
    cursor.close()
    conn.close()

def update_task_status(task_run_id, status, error_message=None):
    """Update task status in unified reports table"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            UPDATE reports 
            SET status = %s, 
                completed_at = CASE WHEN %s != 'running' THEN CURRENT_TIMESTAMP ELSE completed_at END,
                error_message = %s
            WHERE task_run_id = %s
        ''', (status, status, error_message, task_run_id))
        
        conn.commit()
        print(f"Updated task {task_run_id} status to: {status}")
    except Exception as e:
        print(f"Error updating task {task_run_id} status: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

def check_task_exists_session_independent(task_run_id):
    """Check if task exists without session dependency"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if task exists in reports table
    cursor.execute('SELECT industry, geography, details, status FROM reports WHERE task_run_id = %s', (task_run_id,))
    result = cursor.fetchone()
    
    cursor.close()
    conn.close()
    
    if result:
        return {
            'industry': result['industry'],
            'geography': result['geography'],
            'details': result['details'],
            'status': result['status']
        }
    return None

def get_recently_completed_reports_for_session(session_id):
    """Get recently completed reports for a session (last 24 hours)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get reports completed in last 24 hours that were started by this session
    one_day_ago = datetime.datetime.now() - datetime.timedelta(hours=24)
    
    cursor.execute('''
        SELECT r.title, r.slug, r.industry, r.geography, r.created_at
        FROM reports r
        WHERE r.task_run_id IN (
            SELECT task_run_id FROM active_tasks 
            WHERE session_id = %s AND created_at > %s
        )
        AND r.created_at > %s
        ORDER BY r.created_at DESC
        LIMIT 5
    ''', (session_id, one_day_ago, one_day_ago))
    
    results = cursor.fetchall()
    cursor.close()
    conn.close()
    
    return [{
        'title': row['title'],
        'slug': row['slug'],
        'industry': row['industry'],
        'geography': row['geography'],
        'created_at': row['created_at']
    } for row in results]


def validate_form_inputs(industry, geography, details, debug=False):
    """
    Validate form inputs using Parallel's chat completions API.
    
    Checks for:
    1. Profanity or dangerous content (weapons, etc.)
    2. Real industry/market segment (not test strings like "test", "hello", "ab")
    
    Returns:
        tuple: (is_valid: bool, error_message: str or None, debug_info: dict or None)
        If debug=True, returns additional validation details in debug_info
    """
    # Use direct requests to call Parallel API (no SDK issues)
    
    try:
        # Combine all inputs for validation
        combined_input = f"Industry: {industry or ''}\nGeography: {geography or ''}\nDetails: {details or ''}"
        
        # Create validation prompt
        validation_prompt = f"""
You are a content validation system for a market research platform. Analyze the following form inputs and determine if they are acceptable. Note that the only required field is the industry name, geography is optional, and details is optional and details may be empty:

{combined_input}

Validation criteria:
1. The inputs must NOT contain profanity, offensive language, or dangerous content (weapons, violence, illegal activities)
2. The industry field must represent a real business industry or market segment. REJECT only obvious test strings like:
   - Single words like "test", "hello", "hi", "example"
   - Random character combinations like "ab", "xyz", "asdf", "dsfsdfsdf", "kjhjkhkjh", "mjbkjhkjh"
   - Just numbers like "123", "456"
   - Obvious placeholder text or keyboard mashing
   
ACCEPT legitimate industry terms including:
   - Technology sectors (AI, VR, SaaS, healthcare tech, fintech, etc.)
   - Traditional industries (manufacturing, retail, healthcare, etc.)
   - Short but valid industry acronyms (AI, VR, IoT, etc.)
   - Emerging industries and market segments
   - Large/open-ended industries that encompass sub-industries
   - Very niche and sub industries 

Be reasonably permissive - err on the side of accepting legitimate business queries.

Return your analysis in the specified JSON format.
"""

        # Call Parallel's API directly using requests
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {PARALLEL_API_KEY}"
        }
        
        payload = {
            "model": "speed",
            "messages": [
                {"role": "user", "content": validation_prompt}
            ],
            "stream": False,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "validation_schema",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "is_valid": {
                                "type": "boolean",
                                "description": "Whether the inputs pass validation"
                            },
                            "reasoning": {
                                "type": "string",
                                "description": "Detailed reasoning for the validation decision"
                            },
                            "issues_found": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "List of specific issues found, if any"
                            }
                        },
                        "required": ["is_valid", "reasoning", "issues_found"]
                    }
                }
            },
            "temperature": 0.1,
            "max_tokens": 500
        }
        
        response = requests.post(
            "https://api.parallel.ai/chat/completions",
            headers=headers,
            json=payload,
            timeout=30
        )
        
        if response.status_code != 200:
            print(f"Parallel API error: {response.status_code} - {response.text}")
            # Fail safe - if API is down, allow input to pass
            if debug:
                return True, None, {'error': f'API error: {response.status_code}'}
            else:
                return True, None
        
        # Parse the response
        response_data = response.json()
        result_content = response_data['choices'][0]['message']['content']
        validation_result = json.loads(result_content)
        
        is_valid = validation_result.get('is_valid', False)
        reasoning = validation_result.get('reasoning', 'No reasoning provided')
        issues_found = validation_result.get('issues_found', [])
        
        # Prepare debug info
        debug_info = {
            'response_id': response_data.get('id', 'unknown'),
            'model': 'speed',
            'reasoning': reasoning,
            'issues_found': issues_found,
            'raw_response': result_content,
            'combined_input': combined_input
        } if debug else None
        
        if not is_valid:
            # Return the standard error message for any validation failure
            if debug:
                return False, "Please adjust your inputs to be focused on a specific industry.", debug_info
            else:
                return False, "Please adjust your inputs to be focused on a specific industry."
        
        if debug:
            return True, None, debug_info
        else:
            return True, None
        
    except json.JSONDecodeError as e:
        print(f"JSON parsing error in validation: {e}")
        debug_info = {'error': f'JSON parsing error: {e}'} if debug else None
        # If we can't parse the response, allow the input to be safe
        if debug:
            return True, None, debug_info
        else:
            return True, None
        
    except Exception as e:
        print(f"Validation error: {e}")
        debug_info = {'error': f'Validation error: {e}'} if debug else None
        # If validation fails for any reason, allow the input to be safe
        if debug:
            return True, None, debug_info
        else:
            return True, None


@app.route('/')
def index():
    """Main page with public report library and report generation"""
    # Get running tasks first
    active_tasks_for_library = get_running_tasks()
    
    # Calculate how many slots are left for public reports (max 15 total blocks)
    max_total_blocks = 15
    active_tasks_count = len(active_tasks_for_library)
    max_public_reports = max(0, max_total_blocks - active_tasks_count)
    
    # Get limited public reports for the library
    public_reports = get_all_public_reports_limited(max_public_reports)
    
    # Debug logging
    print(f"Index route - Active tasks: {active_tasks_count}, Max public reports: {max_public_reports}, Got public reports: {len(public_reports)}")
    
    # Get current rate limit status
    recent_report_count = get_recent_report_count()
    
    recently_completed = []  # Simplify for now
    
    # Debug logging
    print(f"Index route - active_tasks found: {len(active_tasks_for_library)}")
    
    return render_template('index.html', 
                         recent_report_count=recent_report_count,
                         max_reports_per_hour=MAX_REPORTS_PER_HOUR,
                         public_reports=public_reports,
                         recently_completed=recently_completed,
                         active_tasks=active_tasks_for_library)

@app.route('/generate-report', methods=['POST'])
def generate_report():
    """Generate a new market research report (global rate limited)"""
    # Check global rate limit
    recent_report_count = get_recent_report_count()
    
    if recent_report_count >= MAX_REPORTS_PER_HOUR:
        return jsonify({
            'error': f'Rate limit exceeded. Maximum {MAX_REPORTS_PER_HOUR} reports per hour globally.',
            'recent_report_count': recent_report_count,
            'max_reports_per_hour': MAX_REPORTS_PER_HOUR
        }), 429
    
    data = request.json
    industry = data.get('industry', '').strip()
    geography = data.get('geography', '').strip()
    details = data.get('details', '').strip()
    email = data.get('email', '').strip() if data.get('email') else None
    
    if not industry:
        return jsonify({'error': 'Industry is required'}), 400
    
    # Validate form inputs using Parallel's chat completions API
    validation_result = validate_form_inputs(industry, geography, details)
    is_valid, validation_error = validation_result[0], validation_result[1]
    if not is_valid:
        return jsonify({'error': validation_error}), 400
    
    try:
        # Generate research input
        research_input = generate_market_research_input(industry, geography, details)
        
        # Create task with Parallel API (events enabled by default for ultra2x processor)
        task_run = client.task_run.create(
            input=research_input,
            processor="ultra2x",
            task_spec={
                "output_schema": {
                    "type": "text",
                }
            }
        )
        
        # Store task metadata for later completion handling
        task_metadata = {
            'task_run_id': task_run.run_id,
            'industry': industry,
            'geography': geography,
            'details': details
        }
        
        # Store in session for completion handling
        session[f'task_{task_run.run_id}'] = task_metadata
        
        # Use task_run_id as the session identifier (much simpler!)
        save_running_task(task_run.run_id, industry, geography, details, task_run.run_id, email)
        print(f"Generate report - saving task {task_run.run_id} with session_id: {task_run.run_id}, email: {email}")
        
        # Start background monitoring thread as ultimate fallback
        monitor_thread = threading.Thread(
            target=monitor_task_completion,
            args=(task_run.run_id, task_metadata),
            daemon=True
        )
        monitor_thread.start()
        
        # Track active task
        active_tasks[task_run.run_id] = {
            'metadata': task_metadata,
            'thread': monitor_thread,
            'start_time': datetime.datetime.now()
        }
        
        # Return task_run_id immediately for SSE streaming
        return jsonify({
            'success': True,
            'task_run_id': task_run.run_id,
            'stream_url': f'/stream-events/{task_run.run_id}'
        })
        
    except Exception as e:
        return jsonify({'error': f'Failed to generate report: {str(e)}'}), 500

@app.route('/stream-events/<task_run_id>')
def stream_events(task_run_id):
    """Stream real-time events from a task run via SSE with robust error handling"""
    print(f"SSE request for task {task_run_id}")
    
    task_metadata = session.get(f'task_{task_run_id}')
    if not task_metadata:
        # Try to get from database for session-independent access
        task_metadata = check_task_exists_session_independent(task_run_id)
        if not task_metadata:
            print(f"SSE: Task metadata not found for {task_run_id}")
            def not_found_error():
                yield f"data: {json.dumps({'type': 'error', 'message': 'Task not found'})}\n\n"
            response = Response(not_found_error(), mimetype='text/event-stream')
            response.headers['Cache-Control'] = 'no-cache'
            return response
    
    print(f"SSE: Starting stream for task {task_run_id}")
    
    def generate_events():
        # Use robust SSE stream handler
        try:
            for event in stream_task_events(task_run_id, PARALLEL_API_KEY):
                yield f"data: {json.dumps(event)}\n\n"
                
                # Stop streaming if task completed
                if event.get('type') == 'task.status' and event.get('is_complete'):
                    return
                    
        except Exception as e:
            print(f"SSE: Stream failed with error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': f'Stream failed: {str(e)}'})}\n\n"
    
    response = Response(generate_events(), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['Connection'] = 'keep-alive'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

def stream_task_events(task_id, api_key):
    """
    Stream events from SSE endpoint with proper parsing and error handling
    - Accept: text/event-stream header
    - Parse 'data: {json}' format  
    - Yield events as generator
    - Handle connection errors
    """
    headers = {
        'x-api-key': api_key,
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'parallel-beta': 'events-sse-2025-07-24'
    }
    
    stream_url = f"https://api.parallel.ai/v1beta/tasks/runs/{task_id}/events"
    
    try:
        # Use separate timeouts: (connection_timeout, read_timeout)
        # Connection: 10s (should be fast), Read: 300s (allow for natural gaps in task processing)
        with requests.get(stream_url, headers=headers, stream=True, timeout=(10, 300)) as response:
            response.raise_for_status()
            
            current_event_type = None
            buffer = ""
            
            for line in response.iter_lines(decode_unicode=True):
                if line is None:
                    continue
                    
                # Handle SSE format
                if line.startswith('event:'):
                    current_event_type = line[6:].strip()
                elif line.startswith('data:'):
                    data_line = line[5:].strip()
                    if data_line:
                        try:
                            # Parse JSON data
                            event_data = json.loads(data_line)
                            
                            # Process event based on type
                            processed_event = process_task_event(current_event_type, event_data)
                            if processed_event:
                                yield processed_event
                                
                        except json.JSONDecodeError as e:
                            print(f"Failed to parse SSE event data: {data_line}, error: {e}")
                            continue
                elif line == "":
                    # Empty line indicates end of event
                    current_event_type = None
                    
    except requests.RequestException as e:
        # Let the caller handle connection errors
        raise ConnectionError(f"SSE connection failed: {str(e)}")
    except Exception as e:
        raise RuntimeError(f"Unexpected error in SSE stream: {str(e)}")

def process_task_event(event_type, event_data):
    """
    Process different event types from Parallel API
    Returns standardized event format for frontend
    """
    # Debug logging to understand event structure
    print(f"Processing event type: {event_data.get('type', event_type)}")
    if 'source_stats' in event_data:
        print(f"Source stats found: {event_data.get('source_stats')}")
    
    processed = {
        'timestamp': event_data.get('timestamp'),
        'raw_type': event_data.get('type', event_type)
    }
    
    # Handle different event types
    if event_data.get('type') == 'task_run.state':
        run_info = event_data.get('run', {})
        status = run_info.get('status', 'unknown')
        
        processed.update({
            'type': 'task.status',
            'status': status,
            'is_complete': status in ['completed', 'failed', 'cancelled'],
            'message': f"Task status: {status}",
            'category': 'status'
        })
        
    elif event_data.get('type') == 'task_run.progress_stats':
        source_stats = event_data.get('source_stats', {})
        num_sources = source_stats.get('num_sources_read', 0)
        total_sources = source_stats.get('num_sources_considered', 0)
        
        processed.update({
            'type': 'task.progress',
            'sources_processed': num_sources,
            'sources_total': total_sources,
            'message': f"Processed {num_sources} of {total_sources} sources",
            'category': 'progress',
            'recent_sources': source_stats.get('sources_read_sample', [])[-5:]  # Last 5
        })
        
    elif 'progress_msg' in event_data.get('type', ''):
        msg_type = event_data.get('type', '').split('.')[-1]  # Get last part after dot
        
        # Check if this progress_msg event has source data
        source_stats = event_data.get('source_stats', {})
        
        processed.update({
            'type': 'task.log',
            'log_level': msg_type,
            'message': event_data.get('message', ''),
            'category': 'log'
        })
        
        # Add source data if available in progress_msg events
        if source_stats:
            num_sources = source_stats.get('num_sources_read', 0)
            total_sources = source_stats.get('num_sources_considered', 0)
            processed.update({
                'sources_processed': num_sources,
                'sources_total': total_sources,
                'recent_sources': source_stats.get('sources_read_sample', [])[-5:]  # Last 5
            })
        
    else:
        # Handle unknown event types
        processed.update({
            'type': 'task.unknown',
            'message': event_data.get('message', str(event_data)),
            'category': 'unknown'
        })
    
    return processed

@app.route('/monitor-task/<task_run_id>', methods=['POST'])
def monitor_task_with_sse(task_run_id):
    """
    Monitor task with robust reconnection and state tracking
    - Track completion state (completed/failed/cancelled)
    - Handle different event types (status/progress/logs)
    - Auto-reconnect on stream interruption
    - Exponential backoff for retries
    - Fetch final result after completion
    """
    try:
        # Check if task exists in session first, then database
        task_metadata = session.get(f'task_{task_run_id}')
        if not task_metadata:
            # Try to get from database for session-independent access
            task_metadata = check_task_exists_session_independent(task_run_id)
            if not task_metadata:
                return jsonify({'error': 'Task not found'}), 404
        
        # Monitor with exponential backoff
        task_completed, final_status, error_msg = monitor_task_completion_robust(
            task_id=task_run_id,
            api_key=PARALLEL_API_KEY,
            max_reconnects=10
        )
        
        if task_completed and final_status == 'completed':
            # Check if this task has already been completed by another monitoring system
            if task_run_id in completed_tasks:
                print(f"Task {task_run_id} already completed by another monitoring system")
                return jsonify({
                    'success': True,
                    'task_completed': True,
                    'message': 'Task already completed'
                })
            
            # Mark as completed to prevent other systems from processing
            completed_tasks.add(task_run_id)
            
            # Fetch final result and save report
            try:
                run_result = client.task_run.result(task_run_id)
                content = getattr(run_result.output, "content", "No content found.")
                basis = getattr(run_result.output, "basis", None)
                
                # Create and save report with error handling
                try:
                    title = f"{task_metadata['industry']} Market Research Report"
                    if task_metadata['geography'] and task_metadata['geography'] != "Not specified":
                        title += f" - {task_metadata['geography']}"
                    
                    slug = create_slug(title)
                    print(f"✅ Generated title='{title}', slug='{slug}' for task {task_run_id}")
                    
                except Exception as e:
                    print(f"❌ Title/slug generation failed for task {task_run_id}: {e}")
                    print(f"❌ task_metadata: {task_metadata}")
                    # Create fallback title/slug to prevent NULL
                    title = f"Market Research Report {task_run_id[-8:]}"
                    slug = f"market-report-{task_run_id[-12:]}"
                    print(f"🔧 Using fallback title='{title}', slug='{slug}'")
                
                report_id = save_report(
                    title, slug,
                    task_metadata['industry'],
                    task_metadata['geography'], 
                    task_metadata['details'],
                    content,
                    basis,
                    task_run_id=task_run_id
                )
                
                record_report_generation()
                
                # Clean up
                session.pop(f'task_{task_run_id}', None)
                if task_run_id in active_tasks:
                    del active_tasks[task_run_id]
                # Status already updated to 'completed' by save_report function
                
                return jsonify({
                    'success': True,
                    'task_completed': True,
                    'report_id': report_id,
                    'slug': slug,
                    'title': title,
                    'url': f'/report/{slug}'
                })
                
            except Exception as e:
                return jsonify({
                    'success': False,
                    'task_completed': True,
                    'error': f'Failed to retrieve final result: {str(e)}'
                }), 500
                
        else:
            return jsonify({
                'success': False,
                'task_completed': task_completed,
                'status': final_status,
                'error': error_msg or 'Task monitoring failed'
            }), 500
            
    except Exception as e:
        return jsonify({'error': f'Monitor task failed: {str(e)}'}), 500

def monitor_task_completion_robust(task_id, api_key, max_reconnects=10):
    """
    Monitor task with robust reconnection using exponential backoff
    Returns: (task_completed: bool, final_status: str, error_msg: str)
    """
    task_completed = False
    final_status = None
    error_msg = None
    reconnect_count = 0
    
    print(f"Starting robust monitoring for task {task_id}")
    
    while not task_completed and reconnect_count < max_reconnects:
        try:
            print(f"Monitoring attempt {reconnect_count + 1}/{max_reconnects}")
            
            # Stream events with timeout
            for event in stream_task_events(task_id, api_key):
                if event.get('type') == 'task.status':
                    final_status = event.get('status')
                    task_completed = event.get('is_complete', False)
                    
                    if task_completed:
                        print(f"Task {task_id} completed with status: {final_status}")
                        return task_completed, final_status, None
                        
                elif event.get('type') == 'error':
                    error_msg = event.get('message', 'Unknown error')
                    print(f"Task {task_id} error: {error_msg}")
                    
                    # Check if this is a recoverable error
                    if is_recoverable_error(error_msg):
                        break  # Break to retry
                    else:
                        return False, 'failed', error_msg
                        
        except (ConnectionError, requests.RequestException) as e:
            # Network errors are recoverable
            print(f"Connection error for task {task_id}: {e}")
            reconnect_count += 1
            
            if reconnect_count < max_reconnects:
                # Exponential backoff: wait_time = min(2 ** retry_count, 30)
                wait_time = min(2 ** reconnect_count, 30)
                print(f"Waiting {wait_time}s before reconnection attempt {reconnect_count + 1}")
                time.sleep(wait_time)
            else:
                error_msg = f"Max reconnection attempts reached after {max_reconnects} tries"
                
        except Exception as e:
            # Unexpected errors
            error_msg = f"Unexpected monitoring error: {str(e)}"
            print(f"Unexpected error for task {task_id}: {e}")
            break
    
    # Final status check if monitoring failed
    if not task_completed:
        try:
            print(f"Performing final status check for task {task_id}")
            run_result = client.task_run.result(task_id)
            return True, 'completed', None
        except Exception as e:
            print(f"Final status check failed for task {task_id}: {e}")
            return False, 'failed', error_msg or f"Monitoring failed after {max_reconnects} attempts"
    
    return task_completed, final_status, error_msg

def is_recoverable_error(error_message):
    """
    Classify errors as recoverable (network) vs non-recoverable (task failed)
    """
    error_lower = error_message.lower()
    
    # Non-recoverable errors
    non_recoverable = [
        'unauthorized', 'forbidden', 'not found', 'invalid task',
        'task failed', 'cancelled', 'quota exceeded'
    ]
    
    for pattern in non_recoverable:
        if pattern in error_lower:
            return False
    
    # Recoverable errors (network, timeout, etc.)
    recoverable = [
        'connection', 'timeout', 'network', 'stream', 'disconnected',
        'server error', 'service unavailable', 'gateway timeout'
    ]
    
    for pattern in recoverable:
        if pattern in error_lower:
            return True
    
    # Default to recoverable for unknown errors
    return True

@app.route('/task-status/<task_run_id>')
def get_task_status(task_run_id):
    """Get current task status for polling fallback"""
    try:
        # Check if task exists in session first, then database
        task_metadata = session.get(f'task_{task_run_id}')
        if not task_metadata:
            # Try to get from database for session-independent access
            task_metadata = check_task_exists_session_independent(task_run_id)
            if not task_metadata:
                return jsonify({'error': 'Task not found'}), 404
        
        # Get task status from Parallel API
        try:
            # Try to get task result (this will fail if task is still running)
            run_result = client.task_run.result(task_run_id)
            # If we get here, task is complete
            return jsonify({
                'status': 'completed',
                'is_complete': True,
                'task_run_id': task_run_id
            })
        except Exception as e:
            # If result() fails, the task is likely still running
            # We can't easily determine the exact status without additional API methods
            # So we'll assume it's still running unless we get a specific error
            error_str = str(e).lower()
            if 'not found' in error_str or 'invalid' in error_str:
                return jsonify({
                    'status': 'failed',
                    'is_complete': True,
                    'error': str(e),
                    'task_run_id': task_run_id
                })
            else:
                # Assume still running
                return jsonify({
                    'status': 'running',
                    'is_complete': False,
                    'task_run_id': task_run_id
                })
            
    except Exception as e:
        return jsonify({'error': f'Failed to get task status: {str(e)}'}), 500

def monitor_task_completion(task_run_id, task_metadata):
    """
    Background thread function to monitor task completion using blocking call.
    This is the ultimate fallback to ensure tasks complete even if SSE fails.
    """
    try:
        print(f"Starting background monitoring for task {task_run_id}")
        
        # Use the blocking call to wait for completion
        run_result = client.task_run.result(task_run_id)
        
        # If we reach here, the task completed
        print(f"Background monitor detected completion for task {task_run_id}")
        
        # Check if task has already been completed by another monitoring system
        if task_run_id in completed_tasks:
            print(f"Task {task_run_id} already completed by another monitoring system, background monitor exiting")
            return
        
        # Check if task is still being tracked (not already completed via SSE)
        if task_run_id in active_tasks:
            print(f"Task {task_run_id} completed via background monitor - saving report")
            
            # Mark as completed to prevent other systems from processing
            completed_tasks.add(task_run_id)
            
            # Save the report (same logic as complete_task endpoint)
            try:
                content = getattr(run_result.output, "content", "No content found.")
                basis = getattr(run_result.output, "basis", None)
                
                # Create title and slug with error handling
                try:
                    title = f"{task_metadata['industry']} Market Research Report"
                    if task_metadata['geography'] and task_metadata['geography'] != "Not specified":
                        title += f" - {task_metadata['geography']}"
                    
                    slug = create_slug(title)
                    print(f"✅ Background monitor generated title='{title}', slug='{slug}' for task {task_run_id}")
                    
                except Exception as e:
                    print(f"❌ Background monitor title/slug generation failed for task {task_run_id}: {e}")
                    print(f"❌ task_metadata: {task_metadata}")
                    # Create fallback title/slug to prevent NULL
                    title = f"Market Research Report {task_run_id[-8:]}"
                    slug = f"market-report-{task_run_id[-12:]}"
                    print(f"🔧 Background monitor using fallback title='{title}', slug='{slug}'")
                
                report_id = save_report(
                    title, slug, 
                    task_metadata['industry'], 
                    task_metadata['geography'], 
                    task_metadata['details'], 
                    content,
                    basis,
                    task_run_id=task_run_id
                )
                
                record_report_generation()
                
                print(f"Background monitor saved report {report_id} for task {task_run_id}")
                
                # Task completed successfully - status already updated by save_report
                
            except Exception as e:
                print(f"Error saving report in background monitor for task {task_run_id}: {e}")
                print(f"Task {task_run_id} will remain in active_tasks for retry")
        
        # Clean up in-memory tracking regardless
        if task_run_id in active_tasks:
            del active_tasks[task_run_id]
            
    except Exception as e:
        print(f"Error in background monitor for task {task_run_id}: {e}")
        # Clean up tracking even on error
        if task_run_id in active_tasks:
            del active_tasks[task_run_id]

@app.route('/complete-task/<task_run_id>', methods=['POST'])
def complete_task(task_run_id):
    """Handle task completion and save the report"""
    try:
        # Check if this task has already been completed by another monitoring system
        if task_run_id in completed_tasks:
            print(f"Task {task_run_id} already completed by another monitoring system")
            return jsonify({
                'success': True,
                'message': 'Task already completed'
            })
        
        # Get task metadata from session OR database
        task_metadata = session.get(f'task_{task_run_id}')
        if not task_metadata:
            # Try to get from database using our session-independent function
            db_task = check_task_exists_session_independent(task_run_id)
            if not db_task:
                return jsonify({'error': 'Task metadata not found'}), 404
            # Convert database task to task_metadata format
            task_metadata = {
                'industry': db_task['industry'],
                'geography': db_task['geography'], 
                'details': db_task['details']
            }
        
        # Mark as completed to prevent other systems from processing
        completed_tasks.add(task_run_id)
            
        # Get the final result
        run_result = client.task_run.result(task_run_id)
        
        # Extract content
        content = getattr(run_result.output, "content", "No content found.")
        basis = getattr(run_result.output, "basis", None)
        
        # Create title and slug with error handling
        try:
            title = f"{task_metadata['industry']} Market Research Report"
            if task_metadata['geography'] and task_metadata['geography'] != "Not specified":
                title += f" - {task_metadata['geography']}"
            
            slug = create_slug(title)
            print(f"✅ Complete task generated title='{title}', slug='{slug}' for task {task_run_id}")
            
        except Exception as e:
            print(f"❌ Complete task title/slug generation failed for task {task_run_id}: {e}")
            print(f"❌ task_metadata: {task_metadata}")
            # Create fallback title/slug to prevent NULL
            title = f"Market Research Report {task_run_id[-8:]}"
            slug = f"market-report-{task_run_id[-12:]}"
            print(f"🔧 Complete task using fallback title='{title}', slug='{slug}'")
        
        # Save report
        report_id = save_report(
            title, slug, 
            task_metadata['industry'], 
            task_metadata['geography'], 
            task_metadata['details'], 
            content,
            basis,
            task_run_id=task_run_id
        )
        
        # Record report generation for rate limiting
        record_report_generation()
        
        # Clean up session and active tasks tracking
        session.pop(f'task_{task_run_id}', None)
        if task_run_id in active_tasks:
            del active_tasks[task_run_id]
        # Status already updated to 'completed' by save_report function
        
        return jsonify({
            'success': True,
            'report_id': report_id,
            'slug': slug,
            'title': title,
            'url': f'/report/{slug}'
        })
        
    except Exception as e:
        return jsonify({'error': f'Failed to complete task: {str(e)}'}), 500

@app.route('/report/<slug>')
def view_report(slug):
    """View a specific report by slug"""
    report = get_report_by_slug(slug)
    
    if not report:
        return render_template('404.html'), 404
    
    return render_template('report.html', report=report)

@app.route('/repair-report/<task_run_id>')
def repair_report_endpoint(task_run_id):
    """Manual repair endpoint for reports with NULL title/slug"""
    repair_result = repair_null_slug_report(task_run_id)
    
    if repair_result:
        # Redirect to the repaired report
        return redirect(f"/report/{repair_result['slug']}")
    else:
        return jsonify({
            'error': 'Failed to repair report. Report may not exist or may not need repair.',
            'task_run_id': task_run_id
        }), 404

@app.route('/download/<slug>')
def download_report(slug):
    """Download report as markdown file"""
    report = get_report_by_slug(slug)
    
    if not report:
        return jsonify({'error': 'Report not found'}), 404
    
    # Create temporary file
    temp_file = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.md')
    
    # Write markdown content
    markdown_content = f"""# {report['title']}

**Generated on:** {report['created_at']}  
**Industry:** {report['industry']}  
**Geography:** {report['geography'] or 'Global'}  
**Details:** {report['details'] or 'None specified'}

---

{report['content']}
"""
    
    temp_file.write(markdown_content)
    temp_file.close()
    
    # Send file
    filename = f"{report['slug']}.md"
    return send_file(temp_file.name, as_attachment=True, download_name=filename)

@app.route('/api/validate-inputs', methods=['POST'])
def validate_inputs_api():
    """API endpoint for real-time input validation"""
    try:
        data = request.json
        industry = data.get('industry', '').strip()
        geography = data.get('geography', '').strip()
        details = data.get('details', '').strip()
        
        # Basic check - industry is required
        if not industry:
            return jsonify({
                'is_valid': False,
                'message': 'Industry is required',
                'type': 'required'
            })
        
        # Validate using our AI validation function
        validation_result = validate_form_inputs(industry, geography, details)
        is_valid, validation_error = validation_result[0], validation_result[1]
        
        if is_valid:
            return jsonify({
                'is_valid': True,
                'message': 'Looks good!',
                'type': 'success'
            })
        else:
            return jsonify({
                'is_valid': False,
                'message': validation_error or 'Please adjust your inputs to be focused on a specific industry.',
                'type': 'validation_error'
            })
            
    except Exception as e:
        print(f"Validation API error: {e}")
        return jsonify({
            'is_valid': True,  # Default to valid on error to not block users
            'message': 'Validation unavailable',
            'type': 'error'
        })

@app.route('/api/status')
def api_status():
    """API endpoint to check global rate limit status"""
    recent_report_count = get_recent_report_count()
    remaining_reports = MAX_REPORTS_PER_HOUR - recent_report_count
    
    return jsonify({
        'authenticated': False,  # No authentication required
        'recent_report_count': recent_report_count,
        'max_reports_per_hour': MAX_REPORTS_PER_HOUR,
        'remaining_reports': max(0, remaining_reports),
        'login_required': False
    })

@app.route('/api/library-html')
def get_library_html():
    """Get library section HTML for real-time updates"""
    # Basic rate limiting: max 1 request per second per IP
    client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'unknown'))
    current_time = time.time()
    
    if not hasattr(get_library_html, 'last_requests'):
        get_library_html.last_requests = {}
    
    if client_ip in get_library_html.last_requests:
        if current_time - get_library_html.last_requests[client_ip] < 1.0:  # 1 second
            return jsonify({'error': 'Rate limit exceeded'}), 429
    
    get_library_html.last_requests[client_ip] = current_time
    
    try:
        # Get running tasks first
        active_tasks_for_library = get_running_tasks()
        
        # Calculate how many slots are left for public reports (max 15 total blocks)
        max_total_blocks = 15
        active_tasks_count = len(active_tasks_for_library)
        max_public_reports = max(0, max_total_blocks - active_tasks_count)
        
        # Get limited public reports
        public_reports = get_all_public_reports_limited(max_public_reports)
        
        # Render just the library section 
        return render_template_string('''
        {% if public_reports or active_tasks %}
        <div class="analyses-grid">
            <!-- Active Tasks (Generating) -->
            {% for task in active_tasks %}
            <div class="analysis-card generating-card">
                <div class="company-logo" style="background-color: #9CA3AF; opacity: 0.6;">
                    <i class="fas fa-cogs fa-spin"></i>
                </div>
                
                <div class="company-name" style="color: #6B7280;">{{ task.industry|e }} Market Research Report{% if task.geography %} - {{ task.geography|e }}{% endif %}</div>
                
                <div class="company-description" style="color: #9CA3AF;">
                    <i class="fas fa-hourglass-half me-2"></i>AI is currently researching market trends, competitive landscape, and strategic insights for the {{ task.industry|e }} sector{% if task.geography %} in {{ task.geography|e }}{% endif %}...
                </div>
                
                <div class="d-flex justify-content-between align-items-center">
                    <div class="company-category" style="background-color: #F3F4F6; color: #6B7280; border: 1px dashed #D1D5DB;">Generating...</div>
                    <div class="task-time" style="color: #9CA3AF;">
                        <i class="fas fa-clock"></i>
                        <span>Started {{ task.created_at.strftime('%I:%M %p') }}</span>
                    </div>
                </div>
                
                <div class="mt-3">
                    <button class="btn btn-outline-secondary btn-sm w-100" disabled style="opacity: 0.5;">
                        <i class="fas fa-hourglass-half me-2"></i>Generating Report...
                    </button>
                </div>
            </div>
            {% endfor %}
            
            <!-- Completed Reports -->
            {% for report in public_reports %}
            <div class="analysis-card">
                <div class="company-logo" style="background-color: {{ report.company_color }};">
                    <i class="fas fa-chart-line"></i>
                </div>
                
                <div class="company-name">{{ report.industry }}</div>
                
                <div class="company-description">{{ report.industry }} market analysis with comprehensive competitive intelligence and strategic insights.</div>
                
                <div class="d-flex align-items-center">
                    <div class="company-category">MARKET RESEARCH</div>
                </div>
                
                <div class="mt-3">
                    <a href="/report/{{ report.slug }}" class="btn btn-primary btn-sm w-100">
                        <i class="fas fa-eye me-2"></i>VIEW ANALYSIS
                    </a>
                </div>
            </div>
            {% endfor %}
        </div>
        {% else %}
        <!-- Sample Analyses Cards when no reports exist -->
        <div class="analyses-grid">
            <div class="analysis-card">
                <div class="company-logo" style="background-color: #4A90E2;">
                    <i class="fas fa-layer-group"></i>
                </div>
                <div class="company-name">StackOne Technologies LTD</div>
                <div class="company-description">StackOne provides API integration solutions for HR and ATS systems, offering unified access to multiple platforms.</div>
                <div class="d-flex align-items-center">
                    <div class="company-category">SAMPLE</div>
                </div>
                <div class="mt-3">
                    <button class="btn btn-outline-secondary btn-sm w-100" disabled>
                        <i class="fas fa-lock me-2"></i>Sample Analysis
                    </button>
                </div>
            </div>
            <!-- Additional sample cards... -->
        </div>
        {% endif %}
        ''', public_reports=public_reports, active_tasks=active_tasks_for_library)
        
    except Exception as e:
        print(f"Library HTML generation error: {e}")
        # Return minimal fallback HTML instead of JSON error
        return '''
        <div class="analyses-grid">
            <div class="analysis-card" style="opacity: 0.5;">
                <div class="company-logo" style="background-color: #DC3545;">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <div class="company-name">Error Loading Tasks</div>
                <div class="company-description">Please refresh the page to try again.</div>
            </div>
        </div>
        '''

@app.route('/api/active-tasks')
def get_active_tasks_api():
    """Get active tasks for the current session"""
    try:
        active_tasks_list = get_running_tasks()
        print(f"API active-tasks - found: {len(active_tasks_list)} tasks")
        
        # Check each task status with Parallel API
        for task in active_tasks_list:
            try:
                # Try to get task result to check if completed
                run_result = client.task_run.result(task['task_run_id'])
                # If we get here, task is complete - save full report
                print(f"API detected completed task {task['task_run_id']} - saving report")
                
                content = getattr(run_result.output, "content", "No content found.")
                basis = getattr(run_result.output, "basis", None)
                
                # Create title and slug with error handling
                try:
                    title = f"{task['industry']} Market Research Report"
                    if task['geography'] and task['geography'] != "Not specified":
                        title += f" - {task['geography']}"
                    
                    slug = create_slug(title)
                    print(f"✅ API generated title='{title}', slug='{slug}' for task {task['task_run_id']}")
                    
                except Exception as e:
                    print(f"❌ API title/slug generation failed for task {task['task_run_id']}: {e}")
                    print(f"❌ task data: {task}")
                    # Create fallback title/slug to prevent NULL
                    title = f"Market Research Report {task['task_run_id'][-8:]}"
                    slug = f"market-report-{task['task_run_id'][-12:]}"
                    print(f"🔧 API using fallback title='{title}', slug='{slug}'")
                
                report_id = save_report(
                    title, slug, 
                    task['industry'], 
                    task['geography'], 
                    task['details'], 
                    content,
                    basis,
                    task_run_id=task['task_run_id']
                )
                
                record_report_generation()
                print(f"API saved report {report_id} for completed task {task['task_run_id']}")
                task['status'] = 'completed'
            except Exception as e:
                # Task is still running or error accessing result
                print(f"Task {task['task_run_id']} still running or error: {e}")
                task['status'] = 'running'
        
        # Filter out completed tasks
        running_tasks = [task for task in active_tasks_list if task['status'] == 'running']
        
        return jsonify({
            'success': True,
            'active_tasks': running_tasks
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Verify database connection on import for serverless deployment
try:
    verify_database_connection()
except Exception as e:
    print(f"Database connection error: {e}")


if __name__ == '__main__':
    # Run the application locally
    app.run(debug=True, host='0.0.0.0', port=5000)
