#!/usr/bin/env python3
"""
debug-server.py — tiny WebSocket log sink for the chorus2-tizen app.

Run on your dev machine (WSL / PowerShell / macOS), then put your dev
machine's IP:port into the "Debug host" field on the Tizen setup screen.
Everything the .wgt's bootstrap captures — console.log/warn/error,
unhandled exceptions, click events, XHR responses — prints here with
timestamps.

Stdlib-only (no `pip install`). Implements the bits of RFC 6455 we need:
the upgrade handshake and a single-frame text-message reader.

Usage:
    python3 tools/debug-server.py            # listens on 0.0.0.0:9999
    python3 tools/debug-server.py 9099       # listens on port 9099
    python3 tools/debug-server.py 9099 -q    # quiet — JSON only, no pretty
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import socket
import struct
import sys
import threading


WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
PRETTY = True


# ---- ANSI helpers ----------------------------------------------------------

def colour(code: str, s: str) -> str:
    if not PRETTY:
        return s
    return f"\x1b[{code}m{s}\x1b[0m"


DIM    = lambda s: colour("2", s)
BOLD   = lambda s: colour("1", s)
RED    = lambda s: colour("31", s)
GREEN  = lambda s: colour("32", s)
YELLOW = lambda s: colour("33", s)
BLUE   = lambda s: colour("34", s)
MAG    = lambda s: colour("35", s)
CYAN   = lambda s: colour("36", s)


# ---- WebSocket framing -----------------------------------------------------

def handshake(req: bytes) -> bytes:
    """Build a WS handshake response from the HTTP upgrade request."""
    headers = {}
    for line in req.split(b"\r\n")[1:]:
        if b":" in line:
            k, _, v = line.partition(b":")
            headers[k.strip().lower()] = v.strip()
    key = headers.get(b"sec-websocket-key")
    if not key:
        return b""
    accept = base64.b64encode(
        hashlib.sha1(key + WS_GUID.encode()).digest()
    ).decode()
    return (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
    ).encode()


def read_frame(sock: socket.socket) -> str | None:
    """Read one text frame from a WebSocket. Returns None on close/eof."""
    def recv_exact(n: int) -> bytes | None:
        buf = b""
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return buf

    header = recv_exact(2)
    if header is None:
        return None
    b1, b2 = header[0], header[1]
    opcode = b1 & 0x0F
    if opcode == 0x8:        # close
        return None
    masked = b2 & 0x80
    length = b2 & 0x7F
    if length == 126:
        ext = recv_exact(2)
        if ext is None: return None
        length = struct.unpack(">H", ext)[0]
    elif length == 127:
        ext = recv_exact(8)
        if ext is None: return None
        length = struct.unpack(">Q", ext)[0]
    mask = recv_exact(4) if masked else b"\x00\x00\x00\x00"
    if mask is None: return None
    payload = recv_exact(length)
    if payload is None: return None
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    if opcode == 0x1:        # text
        return payload.decode("utf-8", errors="replace")
    if opcode == 0x9:        # ping → respond with pong
        return ""             # caller will see empty string; treat as no-op
    return ""


# ---- Pretty-printer --------------------------------------------------------

LEVEL_COLOUR = {
    "console.log":   lambda s: s,
    "console.info":  CYAN,
    "console.warn":  YELLOW,
    "console.debug": DIM,
    "console.error": RED,
    "error":         RED,
    "unhandledrejection": RED,
    "click":         BLUE,
    "hello":         GREEN,
    "net.xhr":       MAG,
}


def fmt_data(t: str, data) -> str:
    if t.startswith("console.") and isinstance(data, list):
        parts = []
        for a in data:
            parts.append(a if isinstance(a, str) else json.dumps(a, default=str))
        return " ".join(parts)
    if t == "click":
        tag = data.get("tag", "?")
        cid = f"#{data['id']}" if data.get("id") else ""
        cls = f".{data['cls']}" if data.get("cls") else ""
        txt = data.get("text") or ""
        if txt:
            txt = f"  “{txt[:80]}”"
        return f"{tag}{cid}{cls}{txt}  @({data.get('x','?')},{data.get('y','?')})"
    if t == "net.xhr":
        meth = data.get("method", "?")
        url = data.get("url", "?")
        st = data.get("status", "?")
        head = f"{meth} {url}  -> {st}"
        body_bits = []
        if data.get("req"):
            body_bits.append(f"  req: {data['req']}")
        if data.get("resp"):
            body_bits.append(f"  resp: {data['resp']}")
        return head + ("\n" + "\n".join(body_bits) if body_bits else "")
    return json.dumps(data, default=str, ensure_ascii=False)


def handle_message(raw: str, peer: str) -> None:
    if not raw:
        return
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        print(DIM(f"[{peer}]"), raw)
        return
    ts = msg.get("t", 0)
    t = msg.get("type", "?")
    data = msg.get("data")
    when = dt.datetime.fromtimestamp(ts / 1000).strftime("%H:%M:%S.%f")[:-3] if ts else "--:--:--"
    colour_fn = LEVEL_COLOUR.get(t, BOLD)
    tag = colour_fn(f"{t:<22}")
    body = fmt_data(t, data)
    print(f"{DIM(when)}  {tag}  {body}")


# ---- Server ----------------------------------------------------------------

def serve_client(sock: socket.socket, addr) -> None:
    peer = f"{addr[0]}:{addr[1]}"
    try:
        req = b""
        while b"\r\n\r\n" not in req:
            chunk = sock.recv(4096)
            if not chunk:
                return
            req += chunk
        resp = handshake(req)
        if not resp:
            return
        sock.sendall(resp)
        print(GREEN(f"[+] {peer} connected"))
        while True:
            text = read_frame(sock)
            if text is None:
                break
            if text:
                handle_message(text, peer)
        print(DIM(f"[-] {peer} disconnected"))
    except OSError:
        pass
    finally:
        try: sock.close()
        except OSError: pass


def main() -> int:
    global PRETTY
    args = sys.argv[1:]
    port = 9999
    for a in args:
        if a in ("-q", "--quiet"):
            PRETTY = False
        elif a.isdigit():
            port = int(a)
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", port))
    s.listen(8)
    print(BOLD(f"chorus2-tizen debug log sink listening on 0.0.0.0:{port}"))
    print(DIM("set the same host:port in the .wgt setup screen's "
              "\"Debug host\" field and (re)launch the app.\n"))
    try:
        while True:
            c, addr = s.accept()
            threading.Thread(target=serve_client, args=(c, addr), daemon=True).start()
    except KeyboardInterrupt:
        print()
        return 0


if __name__ == "__main__":
    sys.exit(main())
