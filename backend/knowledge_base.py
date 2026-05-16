"""
Lightweight knowledge base: BM25 retrieval + code indexing + graph + wiki.
Chat uses Anthropic API if ANTHROPIC_API_KEY is set, otherwise returns raw context.
"""
import ast
import json
import os
import time
from pathlib import Path
from typing import Any

from rank_bm25 import BM25Okapi

BACKEND_DIR = Path(__file__).parent
REPO_ROOT   = BACKEND_DIR.parent


class KnowledgeBase:
    def __init__(self):
        self.documents: list[dict] = []
        self._bm25: BM25Okapi | None = None
        self.indexed_at: float = 0.0
        self.notes: list[dict] = []

    # ── Indexing ──────────────────────────────────────────────────────────────

    def index_codebase(self):
        new_docs: list[dict] = []
        for ext, lang in [("*.py", "python"), ("*.js", "javascript")]:
            for path in REPO_ROOT.rglob(ext):
                if any(s in str(path) for s in (".git", "__pycache__", "node_modules", ".venv")):
                    continue
                try:
                    content = path.read_text(errors="ignore")
                    rel = str(path.relative_to(REPO_ROOT))
                    new_docs.append({
                        "id": f"file::{rel}",
                        "type": "code",
                        "title": rel,
                        "content": content,
                        "metadata": {"path": rel, "language": lang, "size": len(content)},
                    })
                    if lang == "python":
                        new_docs.extend(self._parse_python_ast(path, content, rel))
                except Exception:
                    pass

        self.documents = [d for d in self.documents if d["type"] not in ("code", "function", "class")]
        self.documents.extend(new_docs)
        self._rebuild_bm25()

    def _parse_python_ast(self, path: Path, content: str, rel: str) -> list[dict]:
        docs = []
        try:
            tree = ast.parse(content)
            lines = content.splitlines()
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    docstring = ast.get_docstring(node) or ""
                    end = min(node.lineno + 6, len(lines))
                    sig = "\n".join(lines[node.lineno - 1: end])
                    docs.append({
                        "id": f"fn::{rel}::{node.name}",
                        "type": "function",
                        "title": f"{path.name}::{node.name}()",
                        "content": f"Function {node.name} in {rel}\n{sig}\n{docstring}",
                        "metadata": {"path": rel, "name": node.name, "line": node.lineno},
                    })
                elif isinstance(node, ast.ClassDef):
                    docstring = ast.get_docstring(node) or ""
                    docs.append({
                        "id": f"cls::{rel}::{node.name}",
                        "type": "class",
                        "title": f"{path.name}::{node.name}",
                        "content": f"Class {node.name} in {rel}\n{docstring}",
                        "metadata": {"path": rel, "name": node.name, "line": node.lineno},
                    })
        except Exception:
            pass
        return docs

    def add_market_snapshot(self, snapshot: dict):
        ts = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
        self.documents.append({
            "id": f"market::{ts}",
            "type": "market_data",
            "title": f"Market snapshot {ts}",
            "content": f"Market snapshot at {ts}:\n" + json.dumps(snapshot, indent=2)[:3000],
            "metadata": {"timestamp": ts},
        })
        market_docs = [d for d in self.documents if d["type"] == "market_data"]
        if len(market_docs) > 48:
            drop = {d["id"] for d in market_docs[: len(market_docs) - 48]}
            self.documents = [d for d in self.documents if d["id"] not in drop]
        self._rebuild_bm25()

    def add_note(self, title: str, content: str) -> dict:
        note = {
            "id": f"note::{int(time.time())}",
            "type": "note",
            "title": title,
            "content": content,
            "metadata": {"created": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())},
        }
        self.documents.append(note)
        self.notes.append(note)
        self._rebuild_bm25()
        return note

    def delete_note(self, note_id: str) -> bool:
        before = len(self.documents)
        self.documents = [d for d in self.documents if d["id"] != note_id]
        self.notes = [n for n in self.notes if n["id"] != note_id]
        if len(self.documents) < before:
            self._rebuild_bm25()
            return True
        return False

    def _rebuild_bm25(self):
        corpus = [d["content"].lower().split() for d in self.documents]
        self._bm25 = BM25Okapi(corpus) if corpus else None
        self.indexed_at = time.time()

    # ── Search ────────────────────────────────────────────────────────────────

    def search(self, query: str, top_k: int = 6, doc_types: list[str] | None = None) -> list[dict]:
        if not self._bm25:
            self._rebuild_bm25()
        if not self._bm25:
            return []
        scores = self._bm25.get_scores(query.lower().split())
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        results = []
        for i, score in ranked:
            if score <= 0:
                continue
            doc = self.documents[i]
            if doc_types and doc["type"] not in doc_types:
                continue
            results.append({
                **doc,
                "score":   round(float(score), 3),
                "snippet": doc["content"][:500],
                "content": doc["content"][:2000],
            })
            if len(results) >= top_k:
                break
        return results

    # ── LLM answer ───────────────────────────────────────────────────────────

    async def ask(self, question: str) -> dict:
        hits = self.search(question, top_k=5)
        context = "\n\n---\n\n".join(
            f"[{h['title']} | score:{h['score']}]\n{h['snippet']}" for h in hits
        )

        try:
            import anthropic as _anthropic
            api_key = os.getenv("ANTHROPIC_API_KEY", "")
            if not api_key:
                raise ValueError("no key")
            client = _anthropic.Anthropic(api_key=api_key)
            msg = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                messages=[{
                    "role": "user",
                    "content": (
                        "You are an AI assistant for the Hype crypto trading platform. "
                        "Answer the question using only the context provided below. "
                        "Be concise and specific. If the context is insufficient, say so.\n\n"
                        f"Context:\n{context}\n\n"
                        f"Question: {question}"
                    ),
                }],
            )
            answer = msg.content[0].text
            powered_by = "claude-sonnet-4-6"
        except Exception:
            answer = (
                "**No ANTHROPIC_API_KEY set** — showing raw search results.\n\n"
                + "\n\n".join(f"**{h['title']}** (score {h['score']})\n{h['snippet']}" for h in hits)
            )
            powered_by = "bm25-raw"

        return {"answer": answer, "sources": hits, "powered_by": powered_by}

    # ── Knowledge graph ───────────────────────────────────────────────────────

    def build_graph(self) -> dict:
        nodes: list[dict] = []
        links: list[dict] = []
        seen: set[str] = set()

        def node(id_: str, label: str, ntype: str, group: int = 0):
            if id_ not in seen:
                nodes.append({"id": id_, "label": label, "type": ntype, "group": group})
                seen.add(id_)

        file_docs = [d for d in self.documents if d["type"] == "code"]
        for doc in file_docs:
            rel = doc["metadata"]["path"]
            node(f"file::{rel}", Path(rel).name, "file", 1)

        fn_docs = [d for d in self.documents if d["type"] == "function"]
        for doc in fn_docs[:35]:
            rel  = doc["metadata"]["path"]
            node(doc["id"], doc["metadata"]["name"] + "()", "function", 2)
            links.append({"source": f"file::{rel}", "target": doc["id"], "label": "defines"})

        coins  = ["BTC", "ETH", "SOL", "HYPE"]
        phases = ["ACCUMULATION", "MARKUP", "DISTRIBUTION", "MARKDOWN", "NEUTRAL"]
        for coin in coins:
            node(f"coin::{coin}", coin, "coin", 3)
        for ph in phases:
            node(f"phase::{ph}", ph, "phase", 4)
            for coin in coins:
                links.append({"source": f"coin::{coin}", "target": f"phase::{ph}", "label": "can_be"})

        coin_kw = {"BTC": ["btc","bitcoin"], "ETH": ["eth","ethereum"],
                   "SOL": ["sol","solana"],  "HYPE": ["hype","hyperliquid"]}
        for doc in file_docs:
            cl = doc["content"].lower()
            for coin, kws in coin_kw.items():
                if any(kw in cl for kw in kws):
                    links.append({"source": doc["id"], "target": f"coin::{coin}", "label": "references"})
            if "phase_detector" in doc["metadata"]["path"]:
                for ph in phases:
                    links.append({"source": doc["id"], "target": f"phase::{ph}", "label": "detects"})

        for note in self.notes:
            node(note["id"], note["title"][:18], "note", 5)

        return {"nodes": nodes, "links": links}

    # ── Wiki ──────────────────────────────────────────────────────────────────

    def generate_wiki(self) -> list[dict]:
        by_file: dict[str, list] = {}
        for doc in self.documents:
            if doc["type"] in ("code", "function", "class"):
                by_file.setdefault(doc["metadata"]["path"], []).append(doc)
        wiki = []
        for path, docs in sorted(by_file.items()):
            entries = [d for d in docs if d["type"] in ("function", "class")]
            wiki.append({
                "path":     path,
                "filename": Path(path).name,
                "language": docs[0]["metadata"].get("language", "?"),
                "size":     docs[0]["metadata"].get("size", 0) if docs[0]["type"] == "code" else 0,
                "entries":  sorted([
                    {"type": e["type"], "name": e["metadata"]["name"],
                     "line": e["metadata"].get("line", 0), "snippet": e["content"][:300]}
                    for e in entries
                ], key=lambda x: x["line"]),
            })
        return wiki

    def stats(self) -> dict:
        by_type: dict[str, int] = {}
        for d in self.documents:
            by_type[d["type"]] = by_type.get(d["type"], 0) + 1
        return {
            "total_documents": len(self.documents),
            "by_type":         by_type,
            "indexed_at":      self.indexed_at,
            "notes":           len(self.notes),
        }


kb = KnowledgeBase()
