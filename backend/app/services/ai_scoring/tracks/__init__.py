"""Track-specific seams for the AI scoring pipeline.

The core graph (extract_evidence → score → caps → synthesize) is
track-agnostic. This package holds the small, clearly-marked pieces that
differ per track so they can be rewritten independently of the graph.

Currently only SIP has a seam (sip_evidence). Everything here is
PROVISIONAL_V0 — see the module docstrings.
"""
