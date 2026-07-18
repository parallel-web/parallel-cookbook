"""Attio matching stays conservative when identity is ambiguous."""

from unittest.mock import Mock

from backend import attio_client


def test_name_without_domain_does_not_guess_an_attio_record(monkeypatch):
    query = Mock()
    monkeypatch.setattr(attio_client, "enabled", lambda: True)
    monkeypatch.setattr(attio_client, "_query_companies", query)

    assert attio_client.check_pipeline(None, "Scale") is None
    query.assert_not_called()


def test_domain_lookup_reports_a_confirmed_miss(monkeypatch):
    query = Mock(return_value=[])
    monkeypatch.setattr(attio_client, "enabled", lambda: True)
    monkeypatch.setattr(attio_client, "_query_companies", query)

    result = attio_client.check_pipeline(" Acme.AI ", "Acme")

    assert result == {
        "in_crm": False,
        "record_id": None,
        "deal_count": 0,
        "owner": None,
        "url": None,
    }
    query.assert_called_once_with({"domains": "acme.ai"})
