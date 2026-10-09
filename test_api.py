"""Run this once to confirm the API key works: python test_api.py"""
from src.llm import MODEL, ask

print(f"Calling {MODEL} ...")
print("Reply:", ask("Reply with exactly: API key works!"))
