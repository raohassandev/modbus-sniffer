"""Minimal dependency-free client for the local Modbus Engineering Workbench v8 API."""

from __future__ import annotations

import ipaddress
import json
from urllib import request, error, parse


class WorkbenchError(RuntimeError):
    def __init__(self, code: str, message: str, details=None):
        super().__init__(message)
        self.code = code
        self.details = details


def _loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class WorkbenchClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8088", allow_remote: bool = False):
        parsed = parse.urlparse(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise WorkbenchError("INVALID_BASE_URL", "base_url must be HTTP(S)")
        if not allow_remote and not _loopback(parsed.hostname):
            raise WorkbenchError("REMOTE_API_DISABLED", "Remote API access requires explicit allow_remote=True")
        self.base_url = base_url.rstrip("/")

    def _call(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = request.Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with request.urlopen(req, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
        except error.HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode("utf-8"))
            except Exception:
                payload = {"error": {"code": f"HTTP_{exc.code}", "message": str(exc)}}
            info = payload.get("error", {})
            raise WorkbenchError(info.get("code", f"HTTP_{exc.code}"), info.get("message", str(exc)), info.get("details")) from exc
        if payload.get("ok") is False:
            info = payload.get("error", {})
            raise WorkbenchError(info.get("code", "API_ERROR"), info.get("message", "Workbench API error"), info.get("details"))
        return payload

    def status(self):
        return self._call("GET", "/api/v8/status")

    def connections(self):
        return self._call("GET", "/api/v8/connections")

    def read(self, connection_id: str, unit_id: int, function_code: int, address: int, quantity: int = 1):
        return self._call("POST", "/api/v8/master/read", {
            "connectionId": connection_id,
            "unitId": unit_id,
            "functionCode": function_code,
            "address": address,
            "quantity": quantity,
        })

    def write(self, connection_id: str, unit_id: int, function_code: int, address: int, *, value=None, values=None,
              confirmed: bool = False, bulk_confirmed: bool = False, broadcast_confirmed: bool = False, read_back: bool = True):
        if not confirmed:
            raise WorkbenchError("CONFIRMATION_REQUIRED", "Writes require confirmed=True")
        if function_code in (15, 16, 23) and not bulk_confirmed:
            raise WorkbenchError("BULK_CONFIRMATION_REQUIRED", "Bulk writes require bulk_confirmed=True")
        if unit_id == 0 and not broadcast_confirmed:
            raise WorkbenchError("BROADCAST_CONFIRMATION_REQUIRED", "Broadcast writes require broadcast_confirmed=True")
        body = {
            "connectionId": connection_id,
            "unitId": unit_id,
            "functionCode": function_code,
            "address": address,
            "readBack": read_back,
            "confirmation": {"confirmed": True, "bulk": bulk_confirmed, "broadcast": broadcast_confirmed},
        }
        if value is not None:
            body["value"] = value
        if values is not None:
            body["values"] = list(values)
        return self._call("POST", "/api/v8/master/write", body)

    def run_recipe(self, recipe: dict, default_connection_id=None, variables=None):
        return self._call("POST", "/api/v8/test-center/recipe/run", {
            "recipe": recipe,
            "defaultConnectionId": default_connection_id,
            "variables": variables or {},
        })
