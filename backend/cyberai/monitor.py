"""Moniteur de ressources système."""
from __future__ import annotations

import time

import psutil

_last = {"t": time.time(), "sent": 0, "recv": 0}
psutil.cpu_percent(percpu=True)


def snapshot() -> dict:
    vm = psutil.virtual_memory()
    net = psutil.net_io_counters()
    now = time.time()
    dt = max(0.001, now - _last["t"])
    up = (net.bytes_sent - _last["sent"]) / dt if _last["sent"] else 0
    down = (net.bytes_recv - _last["recv"]) / dt if _last["recv"] else 0
    _last.update(t=now, sent=net.bytes_sent, recv=net.bytes_recv)
    try:
        disk = psutil.disk_usage("C:\\" if psutil.WINDOWS else "/").percent
    except OSError:
        disk = None
    return {
        "cpu": psutil.cpu_percent(),
        "cores": psutil.cpu_percent(percpu=True),
        "ram": vm.percent,
        "ram_used": vm.used,
        "ram_total": vm.total,
        "disk": disk,
        "net_up": up,
        "net_down": down,
        "procs": len(psutil.pids()),
    }
