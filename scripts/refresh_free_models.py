#!/usr/bin/env python3
"""Refresh EchoBird's free-model directory from verified upstream candidates.

The job is intentionally add-only. A model must appear in FreeLLMAPI or
awesome-free-llm-apis and in the provider's official model endpoint before it
can be appended to the public catalog. Removal remains a manual decision.
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization


FREELLMAPI_URL = "https://api.freellmapi.co/v1/latest"
AWESOME_URL = (
    "https://raw.githubusercontent.com/open-free-llm-api/"
    "awesome-freellm-apis/main/README.md"
)
USER_AGENT = "EchoBird-Free-Model-Maintainer/1.0"

FREELLMAPI_PUBLIC_KEY = b"""-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAq9yv4+3EeyMHKsfVYBhkcz1lYgIXSUeHNnN6tNgYX3k=
-----END PUBLIC KEY-----
"""

FREELLMAPI_PROVIDER_MAP = {
    "cerebras": "cerebras",
    "google": "google-gemini",
    "groq": "groq",
    "mistral": "mistral",
    "modelscope": "modelscope",
    "nvidia": "nvidia-nim",
    "ollama": "ollama-cloud",
    "openrouter": "openrouter",
}

AWESOME_PROVIDER_MAP = {
    "cerebras": "cerebras",
    "google gemini": "google-gemini",
    "groq": "groq",
    "mistral ai": "mistral",
    "modelscope": "modelscope",
    "nvidia nim": "nvidia-nim",
    "ollama cloud": "ollama-cloud",
    "openrouter": "openrouter",
}

OFFICIAL_ENDPOINTS = {
    "cerebras": {
        "url": "https://api.cerebras.ai/v1/models",
        "secret": "CEREBRAS_API_KEY",
    },
    "google-gemini": {
        "url": "https://generativelanguage.googleapis.com/v1beta/models?key={key}",
        "secret": "GOOGLE_API_KEY",
        "shape": "google",
    },
    "groq": {
        "url": "https://api.groq.com/openai/v1/models",
        "secret": "GROQ_API_KEY",
    },
    "mistral": {
        "url": "https://api.mistral.ai/v1/models",
        "secret": "MISTRAL_API_KEY",
    },
    "modelscope": {"url": "https://api-inference.modelscope.cn/v1/models"},
    "nvidia-nim": {"url": "https://integrate.api.nvidia.com/v1/models"},
    "ollama-cloud": {"url": "https://ollama.com/v1/models"},
    "openrouter": {
        "url": "https://openrouter.ai/api/v1/models",
        "shape": "openrouter",
    },
}

NON_CHAT_MARKERS = (
    "audio",
    "calibration",
    "content-safety",
    "diffusion",
    "embed",
    "image",
    "moderation",
    "ocr",
    "rerank",
    "speech",
    "transcri",
    "tts",
    "video",
    "whisper",
)

REQUIRED_FIELDS = {
    "id",
    "providerId",
    "provider",
    "modelId",
    "baseUrl",
    "freeType",
    "freeTier",
    "rateLimits",
    "notes",
    "docsUrl",
    "cardRequired",
    "phoneRequired",
    "commercialOk",
    "verifiedAt",
}

SECRET_NAMES = tuple(
    str(config["secret"])
    for config in OFFICIAL_ENDPOINTS.values()
    if config.get("secret")
)


class RefreshError(RuntimeError):
    pass


def redact(value: str) -> str:
    redacted = re.sub(r"([?&]key=)[^&\s]+", r"\1***", value)
    for secret_name in SECRET_NAMES:
        secret = os.environ.get(secret_name)
        if secret:
            redacted = redacted.replace(secret, "***")
    return redacted


def fetch_bytes(url: str, headers: dict[str, str] | None = None) -> tuple[bytes, Any]:
    request_headers = {"Accept": "application/json, text/plain", "User-Agent": USER_AGENT}
    request_headers.update(headers or {})
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers=request_headers)
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.read(), response.headers
        except (OSError, urllib.error.URLError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(2**attempt)
    raise RefreshError(redact(f"failed to fetch {url}: {last_error}"))


def load_freellmapi_candidates() -> tuple[dict[str, set[str]], dict[str, Any]]:
    body, headers = fetch_bytes(FREELLMAPI_URL)
    signature = headers.get("x-catalog-signature")
    if not signature:
        raise RefreshError("FreeLLMAPI catalog is missing its signature")

    public_key = serialization.load_pem_public_key(FREELLMAPI_PUBLIC_KEY)
    try:
        public_key.verify(base64.b64decode(signature), body)
    except Exception as error:  # cryptography exposes backend-specific errors
        raise RefreshError("FreeLLMAPI catalog signature verification failed") from error

    payload = json.loads(body)
    if not isinstance(payload, dict) or not isinstance(payload.get("models"), list):
        raise RefreshError("FreeLLMAPI catalog has an unexpected shape")

    candidates: dict[str, set[str]] = defaultdict(set)
    for model in payload["models"]:
        if not isinstance(model, dict) or model.get("enabled") is not True:
            continue
        if model.get("modality", "text") != "text":
            continue
        provider_id = FREELLMAPI_PROVIDER_MAP.get(str(model.get("platform", "")))
        model_id = str(model.get("modelId", "")).strip()
        if provider_id and is_chat_model_id(model_id):
            candidates[provider_id].add(model_id)

    return candidates, {
        "version": payload.get("version"),
        "generatedAt": payload.get("generatedAt"),
        "candidateCount": sum(len(models) for models in candidates.values()),
    }


def clean_markdown_cell(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    return value.replace("`", "").strip()


def parse_awesome_candidates(readme: str) -> dict[str, set[str]]:
    section = re.search(
        r"^## Best Free Models by Provider\s*$([\s\S]*?)(?=^##\s)",
        readme,
        flags=re.MULTILINE,
    )
    if not section:
        raise RefreshError("awesome-free-llm-apis model table was not found")

    candidates: dict[str, set[str]] = defaultdict(set)
    current_provider = ""
    for line in section.group(1).splitlines():
        if not line.startswith("|") or line.startswith("|---"):
            continue
        cells = [clean_markdown_cell(cell) for cell in line.strip().strip("|").split("|")]
        if len(cells) < 3 or cells[0] == "Provider":
            continue
        if cells[0]:
            current_provider = cells[0]
        provider_id = AWESOME_PROVIDER_MAP.get(current_provider.lower())
        model_id = cells[2]
        if provider_id and is_chat_model_id(model_id):
            candidates[provider_id].add(model_id)
    return candidates


def load_awesome_candidates() -> tuple[dict[str, set[str]], dict[str, Any]]:
    body, _ = fetch_bytes(AWESOME_URL)
    readme = body.decode("utf-8")
    candidates = parse_awesome_candidates(readme)
    updated_match = re.search(r"Last updated:\s*(\d{4}-\d{2}-\d{2})", readme)
    return candidates, {
        "updatedAt": updated_match.group(1) if updated_match else None,
        "candidateCount": sum(len(models) for models in candidates.values()),
    }


def is_chat_model_id(model_id: str) -> bool:
    if not model_id or len(model_id) > 256 or any(char.isspace() for char in model_id):
        return False
    lowered = model_id.lower()
    return not any(marker in lowered for marker in NON_CHAT_MARKERS)


def is_free_openrouter_model(model: dict[str, Any]) -> bool:
    pricing = model.get("pricing")
    architecture = model.get("architecture")
    if not isinstance(pricing, dict) or not isinstance(architecture, dict):
        return False
    try:
        free = float(pricing.get("prompt", "1")) == 0 and float(pricing.get("completion", "1")) == 0
    except (TypeError, ValueError):
        return False
    output_modalities = architecture.get("output_modalities", [])
    text_output = "text" in output_modalities or architecture.get("modality") == "text->text"
    return free and text_output


def load_official_models(provider_id: str) -> tuple[set[str] | None, str]:
    config = OFFICIAL_ENDPOINTS[provider_id]
    secret_name = config.get("secret")
    secret = os.environ.get(str(secret_name), "") if secret_name else ""
    if secret_name and not secret:
        return None, f"skipped: {secret_name} is not configured"

    url = str(config["url"])
    headers: dict[str, str] = {}
    if secret_name:
        if config.get("shape") == "google":
            url = url.format(key=secret)
        else:
            headers["Authorization"] = f"Bearer {secret}"

    body, _ = fetch_bytes(url, headers)
    payload = json.loads(body)
    shape = config.get("shape")
    models: set[str] = set()

    if shape == "google":
        rows = payload.get("models", []) if isinstance(payload, dict) else []
        for row in rows:
            methods = row.get("supportedGenerationMethods", []) if isinstance(row, dict) else []
            model_id = str(row.get("name", "")).removeprefix("models/") if isinstance(row, dict) else ""
            if "generateContent" in methods and is_chat_model_id(model_id):
                models.add(model_id)
    else:
        rows = payload.get("data", []) if isinstance(payload, dict) else []
        for row in rows:
            if not isinstance(row, dict):
                continue
            model_id = str(row.get("id", "")).strip()
            if not is_chat_model_id(model_id):
                continue
            if shape == "openrouter" and not is_free_openrouter_model(row):
                continue
            models.add(model_id)

    if not models:
        raise RefreshError(f"official endpoint for {provider_id} returned no chat models")
    return models, "verified"


def merge_candidate_maps(
    destination: dict[str, dict[str, set[str]]],
    source_name: str,
    candidates: dict[str, set[str]],
) -> None:
    for provider_id, model_ids in candidates.items():
        for model_id in model_ids:
            destination[provider_id][model_id.lower()].add(source_name)


def validate_catalog(catalog: dict[str, Any]) -> None:
    if catalog.get("version") != 1 or not isinstance(catalog.get("models"), list):
        raise RefreshError("catalog must be a version 1 object with a models array")
    seen: set[str] = set()
    for index, model in enumerate(catalog["models"]):
        if not isinstance(model, dict) or not REQUIRED_FIELDS.issubset(model):
            raise RefreshError(f"catalog model #{index} is missing required fields")
        if model["id"] in seen:
            raise RefreshError(f"duplicate catalog id: {model['id']}")
        seen.add(model["id"])
        if not str(model["baseUrl"]).startswith("https://") or "{" in str(model["baseUrl"]):
            raise RefreshError(f"invalid base URL for {model['id']}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(model["verifiedAt"])):
            raise RefreshError(f"invalid verification date for {model['id']}")


def add_verified_candidates(
    catalog: dict[str, Any],
    candidates: dict[str, dict[str, set[str]]],
    official_models: dict[str, set[str]],
    today: str,
) -> list[dict[str, Any]]:
    existing_ids = {str(model["id"]).lower() for model in catalog["models"]}
    templates: dict[str, dict[str, Any]] = {}
    for model in catalog["models"]:
        templates.setdefault(str(model["providerId"]), model)

    additions: list[dict[str, Any]] = []
    for provider_id, verified_ids in official_models.items():
        template = templates.get(provider_id)
        if not template:
            continue
        official_by_lower = {model_id.lower(): model_id for model_id in verified_ids}
        for candidate_lower, sources in sorted(candidates.get(provider_id, {}).items()):
            official_id = official_by_lower.get(candidate_lower)
            entry_id = f"{provider_id}:{official_id}" if official_id else ""
            if not official_id or entry_id.lower() in existing_ids:
                continue
            entry = copy.deepcopy(template)
            entry.update({"id": entry_id, "modelId": official_id, "verifiedAt": today})
            additions.append({"entry": entry, "sources": sorted(sources)})
            existing_ids.add(entry_id.lower())

    additions.sort(key=lambda item: (item["entry"]["providerId"], item["entry"]["modelId"].lower()))
    catalog["models"].extend(item["entry"] for item in additions)
    if additions:
        catalog["updatedAt"] = today
    return additions


def find_models_needing_review(
    catalog: dict[str, Any], official_models: dict[str, set[str]]
) -> list[str]:
    official_lower = {
        provider_id: {model_id.lower() for model_id in model_ids}
        for provider_id, model_ids in official_models.items()
    }
    return sorted(
        str(model["id"])
        for model in catalog["models"]
        if str(model["providerId"]) in official_lower
        and str(model["modelId"]).lower() not in official_lower[str(model["providerId"])]
    )


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("docs/api/free-models/index.json"))
    parser.add_argument("--report", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-additions", type=int, default=25)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    validate_catalog(catalog)

    candidates: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    source_report: dict[str, Any] = {}
    source_successes = 0
    for source_name, loader in (
        ("FreeLLMAPI", load_freellmapi_candidates),
        ("awesome-free-llm-apis", load_awesome_candidates),
    ):
        try:
            source_candidates, metadata = loader()
            merge_candidate_maps(candidates, source_name, source_candidates)
            source_report[source_name] = {"status": "ok", **metadata}
            source_successes += 1
        except Exception as error:
            source_report[source_name] = {"status": "error", "detail": str(error)}

    if source_successes == 0:
        raise RefreshError("all candidate sources failed")

    official: dict[str, set[str]] = {}
    official_report: dict[str, Any] = {}
    for provider_id in sorted(OFFICIAL_ENDPOINTS):
        try:
            model_ids, status = load_official_models(provider_id)
            official_report[provider_id] = {
                "status": status,
                "modelCount": len(model_ids) if model_ids is not None else 0,
            }
            if model_ids is not None:
                official[provider_id] = model_ids
        except Exception as error:
            official_report[provider_id] = {"status": "error", "detail": str(error)}

    if not official:
        raise RefreshError("no provider model endpoint could be verified")

    needs_review = find_models_needing_review(catalog, official)
    additions = add_verified_candidates(catalog, candidates, official, date.today().isoformat())
    if len(additions) > args.max_additions:
        raise RefreshError(
            f"refusing to add {len(additions)} models; safety limit is {args.max_additions}"
        )
    validate_catalog(catalog)

    report = {
        "generatedAt": date.today().isoformat(),
        "sources": source_report,
        "officialEndpoints": official_report,
        "additions": [
            {
                "id": item["entry"]["id"],
                "provider": item["entry"]["provider"],
                "sources": item["sources"],
            }
            for item in additions
        ],
        "needsReview": needs_review,
        "catalogChanged": bool(additions),
        "dryRun": args.dry_run,
    }
    if args.report:
        write_json(args.report, report)
    if additions and not args.dry_run:
        write_json(args.catalog, catalog)

    print(
        f"sources={source_successes}/2 official={len(official)} "
        f"additions={len(additions)} needs_review={len(needs_review)} "
        f"dry_run={args.dry_run}"
    )
    for item in additions:
        print(f"  + {item['entry']['id']} ({', '.join(item['sources'])})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RefreshError, json.JSONDecodeError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
