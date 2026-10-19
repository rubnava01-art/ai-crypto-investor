"""Mutable runtime state (Phase 1: single worker, in-memory).
Phase 3+ will persist scanner/kill-switch state in the database."""
from dataclasses import dataclass, field


@dataclass
class RuntimeState:
    scanner_running: bool = False
    kill_switch: bool = False
    simulation_mode: str = "simulation"  # simulation | paper | real


state = RuntimeState()
