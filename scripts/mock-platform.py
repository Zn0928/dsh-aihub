# Offline OpenAI-compatible mock used by the `selftest` chain.
# Start it, then pick the "Selftest" model in the model selector: the first
# target points at a dead port, so an answer proves failover actually ran.
#
#   python scripts/mock-platform.py            # listens on 127.0.0.1:4010
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 4010


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            self._json({"data": [{"id": "mock", "object": "model", "owned_by": "aihub"}]})
            return
        self._json({"status": "ok"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            request = json.loads(raw.decode("utf-8"))
        except Exception:
            request = {}
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self._json({"error": {"message": "not found"}}, 404)
            return

        model = request.get("model") or "mock"
        base = {
            "id": "mock-1",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
        }

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(chunk):
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.flush()

        emit({**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}]})
        emit({**base, "choices": [{"index": 0, "delta": {"content": "收到，mock 平台在线"}, "finish_reason": None}]})
        emit({
            **base,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 6, "total_tokens": 9},
        })
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


if __name__ == "__main__":
    print(f"mock platform on http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()