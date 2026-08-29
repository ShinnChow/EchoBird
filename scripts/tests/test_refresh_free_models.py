import copy
import os
import unittest

from scripts import refresh_free_models as refresh


def model(model_id: str = "existing") -> dict:
    return {
        "id": f"openrouter:{model_id}",
        "providerId": "openrouter",
        "provider": "OpenRouter",
        "modelId": model_id,
        "baseUrl": "https://openrouter.ai/api/v1",
        "freeType": "perpetual",
        "freeTier": "Free models",
        "rateLimits": "Varies",
        "notes": "Free model availability varies",
        "docsUrl": "https://openrouter.ai/docs",
        "cardRequired": False,
        "phoneRequired": False,
        "commercialOk": None,
        "verifiedAt": "2026-08-01",
    }


class AwesomeParserTests(unittest.TestCase):
    def test_parses_provider_and_continuation_rows(self) -> None:
        readme = """
## Best Free Models by Provider

| Provider | Model | Model ID | Context | Limits |
|---|---|---|---|---|
| OpenRouter | Model A | `vendor/model-a:free` | 128K | Free |
|  | Model B | `vendor/model-b:free` | 128K | Free |
| NVIDIA NIM | Vision | `vendor/image-model` | 32K | Free |

## Next Section
"""

        parsed = refresh.parse_awesome_candidates(readme)

        self.assertEqual(
            parsed["openrouter"],
            {"vendor/model-a:free", "vendor/model-b:free"},
        )
        self.assertNotIn("nvidia-nim", parsed)

    def test_excludes_non_chat_specialists(self) -> None:
        self.assertFalse(refresh.is_chat_model_id("vendor/content-safety"))
        self.assertFalse(refresh.is_chat_model_id("vendor/diffusion-model"))
        self.assertFalse(refresh.is_chat_model_id("vendor/calibration-model"))
        self.assertTrue(refresh.is_chat_model_id("vendor/vision-instruct"))


class CatalogMergeTests(unittest.TestCase):
    def test_adds_only_candidates_confirmed_by_official_endpoint(self) -> None:
        catalog = {
            "version": 1,
            "updatedAt": "2026-08-01",
            "models": [model()],
        }
        candidates = {
            "openrouter": {
                "vendor/model-a:free": {"FreeLLMAPI"},
                "vendor/unconfirmed:free": {"awesome-free-llm-apis"},
            }
        }

        additions = refresh.add_verified_candidates(
            catalog,
            candidates,
            {"openrouter": {"vendor/model-a:free"}},
            "2026-08-30",
        )

        self.assertEqual([item["entry"]["id"] for item in additions], ["openrouter:vendor/model-a:free"])
        self.assertEqual(catalog["updatedAt"], "2026-08-30")
        self.assertEqual(catalog["models"][-1]["verifiedAt"], "2026-08-30")

    def test_no_addition_leaves_update_date_untouched(self) -> None:
        catalog = {
            "version": 1,
            "updatedAt": "2026-08-01",
            "models": [model()],
        }
        before = copy.deepcopy(catalog)

        additions = refresh.add_verified_candidates(
            catalog,
            {"openrouter": {"existing": {"FreeLLMAPI"}}},
            {"openrouter": {"existing"}},
            "2026-08-30",
        )

        self.assertEqual(additions, [])
        self.assertEqual(catalog, before)

    def test_catalog_validation_rejects_duplicate_ids(self) -> None:
        catalog = {
            "version": 1,
            "updatedAt": "2026-08-01",
            "models": [model(), model()],
        }

        with self.assertRaises(refresh.RefreshError):
            refresh.validate_catalog(catalog)

    def test_reports_missing_models_without_removing_them(self) -> None:
        catalog = {
            "version": 1,
            "updatedAt": "2026-08-01",
            "models": [model("retired")],
        }

        missing = refresh.find_models_needing_review(
            catalog,
            {"openrouter": {"still-available"}},
        )

        self.assertEqual(missing, ["openrouter:retired"])
        self.assertEqual(catalog["models"], [model("retired")])

    def test_redacts_query_parameter_secrets(self) -> None:
        os.environ["GOOGLE_API_KEY"] = "very-secret-key"
        try:
            message = refresh.redact(
                "failed https://example.test/models?key=very-secret-key: very-secret-key"
            )
        finally:
            del os.environ["GOOGLE_API_KEY"]

        self.assertNotIn("very-secret-key", message)
        self.assertIn("key=***", message)


if __name__ == "__main__":
    unittest.main()
