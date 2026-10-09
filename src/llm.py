"""Thin wrapper around Gemini so the rest of the app only calls ask()."""
import os

from dotenv import load_dotenv
from google import genai

load_dotenv()

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
_client = None


def _get_client():
    global _client
    if _client is None:
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY is missing. Add it to your .env file.")
        _client = genai.Client(api_key=key)
    return _client


def ask(prompt: str, system: str | None = None) -> str:
    config = {"system_instruction": system} if system else None
    response = _get_client().models.generate_content(model=MODEL, contents=prompt, config=config)
    return response.text
