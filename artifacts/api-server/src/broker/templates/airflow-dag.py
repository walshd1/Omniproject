"""
Apache Airflow broker template — the HONEST one.

Airflow is BATCH/SCHEDULED, not request/response. It CANNOT be the live data hop:
the OmniProject binding is synchronous (the gateway POSTs and waits for
{success,data} in the same call), and a DAG can't answer that. So Airflow is
modelled `synchronous: false` in the broker registry — exactly like Zapier/IFTTT.

There are two LEGITIMATE Airflow patterns instead — both code, not a re-implement
of the synchronous binding:

  1. Scheduled SYNC  — a DAG pulls each backend on a schedule into a store
     (Postgres/etc.) that a REAL synchronous broker (the HTTP sidecar, n8n, Make,
     a serverless function) then serves read-through. Airflow does the ETL; the
     sidecar does the binding.
  2. Event PUSH      — a DAG pushes changes into POST /api/notifications/ingest
     (NOTIFY_INGEST_SECRET) so OmniProject's bell updates.

This file sketches pattern 1. For the live binding, deploy one of the synchronous
templates (serverless-function.ts / pipedream-component.ts) or the sidecar.
"""
from __future__ import annotations

from datetime import datetime

# from airflow import DAG
# from airflow.operators.python import PythonOperator
# import requests  # or your backend SDK


def sync_projects(**_context) -> None:
    """Pull projects from YOUR backend and upsert into the store the broker reads."""
    # rows = requests.get(f"{BASE}/projects", headers=auth).json()
    # upsert_into_store("projects", normalise(rows))   # contract shape
    raise NotImplementedError("wire this to your backend + store")


def sync_issues(**_context) -> None:
    """Pull issues per project and upsert."""
    raise NotImplementedError("wire this to your backend + store")


def push_changes(**_context) -> None:
    """Optionally POST deltas to /api/notifications/ingest (pattern 2)."""
    raise NotImplementedError("optional: push events to OmniProject ingest")


# with DAG(
#     dag_id="omniproject_backend_sync",
#     schedule="*/15 * * * *",   # every 15 min — tune to your freshness needs
#     start_date=datetime(2026, 1, 1),
#     catchup=False,
#     tags=["omniproject", "sync"],
# ) as dag:
#     t1 = PythonOperator(task_id="sync_projects", python_callable=sync_projects)
#     t2 = PythonOperator(task_id="sync_issues", python_callable=sync_issues)
#     t3 = PythonOperator(task_id="push_changes", python_callable=push_changes)
#     t1 >> t2 >> t3
