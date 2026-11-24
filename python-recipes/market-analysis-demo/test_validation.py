import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests

# Import the Flask app with fake settings and a mocked startup database check.
with (
    patch.dict(os.environ, {
        "PARALLEL_API_KEY": "test-parallel-key",
        "POSTGRES_URL_NON_POOLING": "postgresql://localhost/test",
        "SECRET_KEY": "test-session",
    }),
    patch("dotenv.load_dotenv"),
    patch("psycopg2.connect"),
):
    import app as demo


REJECTION = "Please adjust your inputs to be focused on a specific industry."


def research_response(content, *, status="completed", status_code=200):
    response = Mock(spec=requests.Response, status_code=status_code)
    response.json.return_value = {
        "id": "research_test",
        "status": status,
        "output": [
            {"type": "reasoning"},
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": content}],
            },
        ],
    }
    return response


def decision(is_valid):
    return json.dumps({
        "is_valid": is_valid,
        "reasoning": "Mocked validation decision",
        "issues_found": [] if is_valid else ["Placeholder industry"],
    })


class FormValidationTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(demo.app.config, {"TESTING": True}))
        self.enterContext(patch.object(demo, "active_tasks", {}))
        self.enterContext(patch.object(demo, "get_recent_report_count", return_value=0))
        self.enterContext(patch.object(demo.threading, "Thread"))
        self.save_running_task = self.enterContext(patch.object(demo, "save_running_task"))
        self.task_create = self.enterContext(patch.object(
            demo.client.task_run, "create", return_value=SimpleNamespace(run_id="fake-run")
        ))
        self.research_post = self.enterContext(patch.object(demo.requests, "post"))
        self.client = demo.app.test_client()

    def test_valid_form_uses_research_on_both_routes_and_starts_one_report(self):
        self.research_post.return_value = research_response(decision(True))
        form = {
            "industry": "Industrial heat pumps",
            "geography": "Europe",
            "details": "Focus on adoption",
            "email": "reader@example.com",
        }

        preflight = self.client.post("/api/validate-inputs", json=form)
        self.assertEqual(preflight.status_code, 200)
        self.assertEqual(preflight.json, {
            "is_valid": True, "message": "Looks good!", "type": "success"
        })
        self.task_create.assert_not_called()

        report = self.client.post("/generate-report", json=form)
        self.assertEqual(report.status_code, 200)
        self.assertEqual(report.json, {
            "success": True, "task_run_id": "fake-run", "stream_url": "/stream-events/fake-run"
        })
        self.task_create.assert_called_once()
        self.assertEqual(self.task_create.call_args.kwargs["processor"], "ultra2x")
        self.save_running_task.assert_called_once_with(
            "fake-run", form["industry"], form["geography"], form["details"],
            "fake-run", form["email"],
        )

        self.assertEqual(self.research_post.call_count, 2)
        for request in self.research_post.call_args_list:
            self.assertEqual(request.args, ("https://api.parallel.ai/v1/research",))
            self.assertEqual(request.kwargs["timeout"], 30)
            self.assertEqual(request.kwargs["headers"]["Authorization"], "Bearer test-parallel-key")
            payload = request.kwargs["json"]
            self.assertEqual(payload["model"], "parallel")
            self.assertEqual(payload["reasoning"], {"effort": "low"})
            self.assertIs(payload["background"], False)
            self.assertEqual(json.loads(payload["input"]), {
                "industry": form["industry"],
                "geography": form["geography"],
                "details": form["details"],
            })
            output_format = payload["text"]["format"]
            self.assertEqual(output_format["type"], "json_schema")
            self.assertIs(output_format["strict"], True)
            self.assertEqual(output_format["schema"]["properties"]["is_valid"], {"type": "boolean"})

    def test_optional_fields_can_be_omitted_or_blank(self):
        self.research_post.return_value = research_response(decision(True))
        for optional in ({}, {"geography": " ", "details": "", "email": ""}):
            with self.subTest(optional=optional):
                self.research_post.reset_mock()
                self.task_create.reset_mock()
                form = {"industry": " AI ", **optional}
                self.assertTrue(self.client.post("/api/validate-inputs", json=form).json["is_valid"])
                self.assertEqual(self.client.post("/generate-report", json=form).status_code, 200)
                for request in self.research_post.call_args_list:
                    self.assertEqual(json.loads(request.kwargs["json"]["input"]), {
                        "industry": "AI", "geography": "", "details": ""
                    })
                self.task_create.assert_called_once()
                self.assertIn("Geography: Not specified", self.task_create.call_args.kwargs["input"])

    def test_blank_industry_skips_research_and_report_creation(self):
        form = {"industry": " "}
        preflight = self.client.post("/api/validate-inputs", json=form)
        self.assertEqual(preflight.status_code, 200)
        self.assertEqual(preflight.json, {
            "is_valid": False, "message": "Industry is required", "type": "required"
        })
        report = self.client.post("/generate-report", json=form)
        self.assertEqual(report.status_code, 400)
        self.assertEqual(report.json, {"error": "Industry is required"})
        self.research_post.assert_not_called()
        self.task_create.assert_not_called()

    def test_rejected_input_does_not_start_a_report_even_on_direct_submission(self):
        self.research_post.return_value = research_response(decision(False))
        form = {"industry": "asdf"}
        preflight = self.client.post("/api/validate-inputs", json=form)
        self.assertEqual(preflight.status_code, 200)
        self.assertEqual(preflight.json, {
            "is_valid": False, "message": REJECTION, "type": "validation_error"
        })
        report = self.client.post("/generate-report", json=form)
        self.assertEqual(report.status_code, 400)
        self.assertEqual(report.json, {"error": REJECTION})
        self.task_create.assert_not_called()

    def test_provider_errors_allow_submission_on_both_routes(self):
        no_text = research_response(decision(False))
        no_text.json.return_value["output"].pop()
        failures = {
            "timeout": requests.Timeout(),
            "HTTP error": Mock(spec=requests.Response, status_code=503),
            "unexpected redirect": research_response(decision(False), status_code=302),
            "incomplete response": research_response(decision(False), status="incomplete"),
            "missing output text": no_text,
            "malformed JSON": research_response("not JSON"),
            "missing verdict": research_response("{}"),
            "non-boolean verdict": research_response(decision("false")),
            "missing required fields": research_response('{"is_valid": false}'),
            "invalid issue type": research_response(
                '{"is_valid": false, "reasoning": "Placeholder", "issues_found": [1]}'
            ),
            "extra field in verdict": research_response(
                '{"is_valid": false, "reasoning": "Placeholder", "issues_found": [], "extra": true}'
            ),
        }

        for name, failure in failures.items():
            with self.subTest(failure=name):
                self.research_post.reset_mock(side_effect=True)
                self.task_create.reset_mock()
                if isinstance(failure, Exception):
                    self.research_post.side_effect = failure
                else:
                    self.research_post.return_value = failure

                form = {"industry": "Heat pumps"}
                with self.assertLogs(demo.app.logger, level="WARNING") as logs:
                    preflight = self.client.post("/api/validate-inputs", json=form)
                    self.assertEqual(preflight.json, {
                        "is_valid": True, "message": "Looks good!", "type": "success"
                    })
                    self.task_create.assert_not_called()
                    report = self.client.post("/generate-report", json=form)
                    self.assertEqual(report.status_code, 200)
                self.assertEqual(self.research_post.call_count, 2)
                self.assertEqual(len(logs.output), 2)
                self.assertNotIn(form["industry"], "\n".join(logs.output))
                self.task_create.assert_called_once()


if __name__ == "__main__":
    unittest.main()
