"""AI assistant package: technical-focus assistant with anti-manipulation
guardrails and error learning.

By construction the assistant is read-only: its tool registry contains only
read tools (signals, indicators, backtest summary, risk state). No order,
risk, config or execution tools exist in this package, and no module here
imports the money-moving backend modules (execution engine, risk guard,
exchange adapters, paper trader).
"""
