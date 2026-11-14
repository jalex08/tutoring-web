"""Booking-form endpoint for josediaztutoring.com.

POST /api/contact (JSON) -> emails the request to Jose and a confirmation to
the client, via Gmail SMTP. Everything else on the site is served as static
files by App Engine and never reaches this code.

Credentials live in Secret Manager (never in this repo):
  smtp-user      the Gmail address that sends the mail (also gets the requests)
  smtp-password  a Gmail App Password for that account
Optional secret:
  owner-email    send requests here instead of smtp-user
"""
import json
import logging
import os
import re
import smtplib
import ssl
import threading
import time
from collections import defaultdict, deque
from email.message import EmailMessage
from email.utils import formataddr

from flask import Flask, jsonify, request

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
SITE_NAME = "Jose Diaz Tutoring"
EMAIL_RE = re.compile(r"^[^@\s<>\"',;]+@[^@\s<>\"',;]+\.[^@\s<>\"',;]+$")
LIMITS = {"name": 100, "email": 254, "phone": 40, "level": 60, "course": 150, "message": 4000}

# --- secrets ---------------------------------------------------------------
_secrets = {}


def secret(name, required=True):
    if name in _secrets:
        return _secrets[name]
    from google.cloud import secretmanager

    client = secretmanager.SecretManagerServiceClient()
    path = f"projects/{PROJECT}/secrets/{name}/versions/latest"
    try:
        value = client.access_secret_version(name=path).payload.data.decode().strip()
    except Exception:
        if required:
            raise
        value = ""
    _secrets[name] = value
    return value


# --- abuse limits (in memory; app.yaml keeps this to one instance) -----------
_lock = threading.Lock()
_by_ip = defaultdict(deque)
_all = deque()
PER_IP = (3, 3600)       # 3 requests per IP per hour
GLOBAL = (40, 86400)     # 40 requests per day in total (Gmail allows ~500/day)


def allowed(ip):
    now = time.time()
    with _lock:
        q = _by_ip[ip]
        while q and now - q[0] > PER_IP[1]:
            q.popleft()
        while _all and now - _all[0] > GLOBAL[1]:
            _all.popleft()
        if len(q) >= PER_IP[0] or len(_all) >= GLOBAL[0]:
            return False
        q.append(now)
        _all.append(now)
        return True


# --- email -------------------------------------------------------------------
LABELS = {
    "en": {"name": "Name", "email": "Email", "phone": "Phone", "level": "Level",
           "course": "Course", "message": "Message"},
    "es": {"name": "Nombre", "email": "Correo", "phone": "Teléfono", "level": "Nivel",
           "course": "Curso", "message": "Mensaje"},
}

CONFIRM = {
    "en": {
        "subject": "I got your tutoring request",
        "body": (
            "Hi {name},\n\n"
            "Thanks for reaching out. I received your request for a free 20-minute intro "
            "and I'll reply within one business day to set up a time.\n\n"
            "Level: {level}\nCourse: {course}\n\n"
            "If you need to add anything, just reply to this email.\n\n"
            "Jose Diaz\nhttps://josediaztutoring.com\n"
        ),
    },
    "es": {
        "subject": "Recibí tu solicitud de tutoría",
        "body": (
            "Hola {name}:\n\n"
            "Gracias por escribirme. Recibí tu solicitud para una intro gratis de 20 minutos "
            "y te respondo en un día hábil para coordinar el horario.\n\n"
            "Nivel: {level}\nCurso: {course}\n\n"
            "Si quieres agregar algo, solo responde a este correo.\n\n"
            "Jose Diaz\nhttps://josediaztutoring.com\n"
        ),
    },
}


def one_line(s):
    return " ".join(s.split())


def send(messages):
    user = secret("smtp-user")
    password = secret("smtp-password")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=20) as smtp:
        smtp.login(user, password)
        for m in messages:
            smtp.send_message(m)


def build_messages(d, lang):
    user = secret("smtp-user")
    owner = secret("owner-email", required=False) or user
    sender = formataddr((SITE_NAME, user))
    L = LABELS[lang]

    # To Jose: everything the client typed. Reply goes straight to the client.
    to_owner = EmailMessage()
    to_owner["Subject"] = f"New tutoring request: {one_line(d['name'])}"
    to_owner["From"] = sender
    to_owner["To"] = owner
    to_owner["Reply-To"] = formataddr((one_line(d["name"]), d["email"]))
    lines = [f"{L[k]}: {one_line(d[k])}" for k in ("name", "email", "phone", "level", "course") if d[k]]
    if d["message"]:
        lines.append(f"\n{L['message']}:\n{d['message']}")
    lines.append(f"\n(Form language: {lang.upper()})")
    to_owner.set_content("\n".join(lines))

    # To the client: a fixed confirmation. Their free-text message is NOT echoed,
    # so the form can't be used to send arbitrary text to arbitrary addresses.
    c = CONFIRM[lang]
    to_client = EmailMessage()
    to_client["Subject"] = c["subject"]
    to_client["From"] = sender
    to_client["To"] = d["email"]
    to_client["Reply-To"] = owner
    to_client.set_content(c["body"].format(
        name=one_line(d["name"])[:60],
        level=one_line(d["level"])[:60] or "-",
        course=one_line(d["course"])[:100] or "-",
    ))
    return [to_owner, to_client]


# --- route -------------------------------------------------------------------
def reply(payload, status):
    resp = jsonify(payload)
    resp.status_code = status
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return resp


@app.post("/api/contact")
def contact():
    try:
        raw = request.get_json(force=True, silent=True) or {}
    except Exception:
        raw = {}
    if not isinstance(raw, dict):
        return reply({"ok": False, "error": "bad_request"}, 400)

    # Honeypot: real visitors never see or fill the "website" field.
    if str(raw.get("website", "")).strip():
        return reply({"ok": True}, 200)

    d = {k: str(raw.get(k, "") or "").strip()[:n] for k, n in LIMITS.items()}
    lang = "es" if raw.get("lang") == "es" else "en"
    if not d["name"] or not EMAIL_RE.match(d["email"]):
        return reply({"ok": False, "error": "invalid"}, 400)

    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0]).strip()
    if not allowed(ip):
        return reply({"ok": False, "error": "rate_limited"}, 429)

    try:
        send(build_messages(d, lang))
    except Exception:
        logging.exception("Failed to send booking email")
        return reply({"ok": False, "error": "send_failed"}, 502)

    logging.info(json.dumps({"event": "booking_request", "lang": lang}))
    return reply({"ok": True}, 200)
