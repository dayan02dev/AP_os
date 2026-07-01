"""AI scoring + summary pipeline (Gemini Flash via OpenRouter).

Single source of AI score + executive summary for TIR and VIP applications.
Used by both the SQS worker (workers/ai_screener/handler.py) and the one-off
backfill (scripts/rescore_all_applications.py).
"""
