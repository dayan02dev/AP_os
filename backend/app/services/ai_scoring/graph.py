"""LangGraph state-machine assembly.

build_graph(llm) returns a compiled LangGraph App. Each pass is its own
node; the 5 Pass-2 scorers fan out in parallel via standard LangGraph
fan-in (each writes to a unique state slot, so no Send-based reducer
is needed — LangGraph's default merge handles it).
"""
from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langgraph.graph import END, START, StateGraph

from .nodes.apply_caps import run as apply_caps_run
from .nodes.compute_confidence import run as compute_conf_run
from .nodes.extract_evidence import run as extract_evidence_run
from .nodes.quality_gate import evaluate_summary
from .nodes.score_signals import make_scorer_node
from .nodes.synthesize import run as synthesize_run
from .state import ScoringState


MAX_QG_RETRIES = 3
_SIGNAL_NAMES_SORTED = (
    "behavioural", "commitment", "completeness",
    "problem_impact", "technical_depth",
)  # alphabetical so the fake-LLM test can script in known order


def build_graph(*, llm: BaseChatModel):
    g = StateGraph(ScoringState)

    # ─── Nodes ──────────────────────────────────────────────────
    # Note: node names must not collide with ScoringState keys, so scorer
    # nodes are named "scorer_<sig>" while they write to "score_<sig>".
    g.add_node("extract_evidence", lambda s: extract_evidence_run(s, llm=llm))

    for sig in _SIGNAL_NAMES_SORTED:
        g.add_node(f"scorer_{sig}", make_scorer_node(sig, llm))

    g.add_node("apply_caps", apply_caps_run)
    g.add_node("compute_confidence", compute_conf_run)
    g.add_node("synthesize", lambda s: synthesize_run(s, llm=llm))
    g.add_node("quality_gate_check", _qg_node)

    # ─── Edges ──────────────────────────────────────────────────
    g.add_edge(START, "extract_evidence")
    # Fan out: evidence → 5 scorers
    for sig in _SIGNAL_NAMES_SORTED:
        g.add_edge("extract_evidence", f"scorer_{sig}")
    # Fan in: all scorers → apply_caps. LangGraph waits for all parents.
    for sig in _SIGNAL_NAMES_SORTED:
        g.add_edge(f"scorer_{sig}", "apply_caps")
    g.add_edge("apply_caps", "compute_confidence")
    g.add_edge("compute_confidence", "synthesize")
    g.add_edge("synthesize", "quality_gate_check")
    g.add_conditional_edges("quality_gate_check", _qg_route, {
        "done": END,
        "retry": "synthesize",
    })

    return g.compile()


def _qg_node(state: dict) -> dict:
    """Run the quality gate; update retry counter + needs-human-review flag."""
    report = evaluate_summary(state["summary_round_1"])
    retries = state.get("qg_retries", 0)
    delta = {
        "qg_last_failures": report["failures"],
    }
    if report["passed"]:
        delta["qg_needs_human_review"] = False
        return delta
    # Failed
    new_retries = retries + 1
    delta["qg_retries"] = new_retries
    if new_retries >= MAX_QG_RETRIES:
        delta["qg_needs_human_review"] = True
    return delta


def _qg_route(state: dict) -> str:
    if not state.get("qg_last_failures"):
        return "done"
    if state.get("qg_needs_human_review"):
        return "done"
    return "retry"
