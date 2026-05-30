"""
Supabase client for the backend.

Uses the service role key (bypasses RLS) for server-side operations like:
  - Writing snapshot data from the scheduler
  - Reading/writing any table without user context

Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (or environment).
Falls back to SUPABASE_ANON_KEY if the service role key is not provided.
"""

import os

from supabase import Client, create_client

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is not None:
        return _client

    url = os.environ.get("SUPABASE_URL", "")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY", "")
    )

    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) "
            "must be set in the environment."
        )

    _client = create_client(url, key)
    return _client


async def sb_upsert(table: str, rows: list[dict], on_conflict: str = "id") -> list[dict]:
    """Upsert rows into a table. Returns the upserted rows."""
    client = get_supabase()
    res = client.table(table).upsert(rows, on_conflict=on_conflict).execute()
    return res.data or []


async def sb_insert(table: str, rows: list[dict]) -> list[dict]:
    client = get_supabase()
    res = client.table(table).insert(rows).execute()
    return res.data or []


async def sb_select(table: str, query: str = "*", filters: dict | None = None) -> list[dict]:
    """Simple select helper. `filters` maps column → value (eq filter)."""
    client  = get_supabase()
    builder = client.table(table).select(query)
    for col, val in (filters or {}).items():
        builder = builder.eq(col, val)
    res = builder.execute()
    return res.data or []
