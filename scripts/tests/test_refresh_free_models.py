import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from scripts import refresh_free_models as refresh


def model(model_id: str = "existing", provider_id: str = "openrouter") -> dict:
    return {
        "id": f"{provider_id}:{model_id}",
        "providerId": provider_id,
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
    def test_preserves_fixed_entries_metadata_and_order_when_appending(self) -> None:
        fixed = [model("kilo-auto/free", "kilo"), model("space-bunny-free", "opencode-zen")]
        fixed[0]["notes"] = "Manual anonymous-access instructions"
        catalog = {"version": 1, "updatedAt": "2026-10-11", "models": fixed + [model()]}
        before = copy.deepcopy(catalog["models"])

        additions = refresh.add_verified_candidates(
            catalog,
            {"openrouter": {"new:free": {"FreeLLMAPI"}}},
            {"openrouter": {"new:free"}},
            "2026-10-12",
        )

        self.assertEqual(catalog["models"][:len(before)], before)
        self.assertEqual([item["entry"]["id"] for item in additions], ["openrouter:new:free"])
        self.assertEqual(catalog["models"][-1]["id"], "openrouter:new:free")

    def test_deduplicates_case_insensitively_and_repeat_run_is_unchanged(self) -> None:
        catalog = {"version": 1, "updatedAt": "2026-10-11", "models": [model("Existing:free")]}
        candidates = {"openrouter": {"existing:free": {"FreeLLMAPI"}, "new:free": {"FreeLLMAPI"}}}
        official = {"openrouter": {"existing:FREE", "new:free"}}

        additions = refresh.add_verified_candidates(catalog, candidates, official, "2026-10-12")
        self.assertEqual(len(additions), 1)
        self.assertEqual(catalog["models"][0], model("Existing:free"))
        after = copy.deepcopy(catalog)

        self.assertEqual(refresh.add_verified_candidates(catalog, candidates, official, "2026-10-13"), [])
        self.assertEqual(catalog, after)

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
        with mock.patch.dict("os.environ", {"GOOGLE_API_KEY": "very-secret-key"}):
            message = refresh.redact(
                "failed https://example.test/models?key=very-secret-key: very-secret-key"
            )

        self.assertNotIn("very-secret-key", message)
        self.assertIn("key=***", message)


class RefreshRunTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.catalog_path = Path(self.directory.name) / "index.json"
        self.report_path = Path(self.directory.name) / "report.json"
        self.catalog = {
            "version": 1,
            "updatedAt": "2026-10-11",
            "models": [model("kilo-auto/free", "kilo"), model("space-bunny-free", "opencode-zen"), model()],
        }
        refresh.write_json(self.catalog_path, self.catalog)
        self.original_bytes = self.catalog_path.read_bytes()
        self.args = SimpleNamespace(
            catalog=self.catalog_path, report=self.report_path, dry_run=False, max_additions=25,
        )
        self.patch = mock.patch.object(refresh, "parse_args", return_value=self.args)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_all_discovery_sources_failing_does_not_write_or_verify(self) -> None:
        with (
            mock.patch.object(refresh, "load_freellmapi_candidates", side_effect=refresh.RefreshError("offline")),
            mock.patch.object(refresh, "load_awesome_candidates", side_effect=refresh.RefreshError("offline")),
            mock.patch.object(refresh, "load_official_models") as official,
        ):
            with self.assertRaisesRegex(refresh.RefreshError, "all candidate sources failed"):
                refresh.main()
            official.assert_not_called()

        self.assertEqual(self.catalog_path.read_bytes(), self.original_bytes)

    def test_partial_failure_preserves_fixed_entries_and_adds_verified_model(self) -> None:
        def load_official(provider_id: str) -> tuple:
            if provider_id == "openrouter":
                return {"existing", "new:free"}, "verified"
            raise refresh.RefreshError("provider unavailable")

        with (
            mock.patch.object(refresh, "load_freellmapi_candidates", side_effect=refresh.RefreshError("offline")),
            mock.patch.object(refresh, "load_awesome_candidates", return_value=({"openrouter": {"new:free"}}, {})),
            mock.patch.object(refresh, "load_official_models", side_effect=load_official),
        ):
            self.assertEqual(refresh.main(), 0)

        result = json.loads(self.catalog_path.read_text(encoding="utf-8"))
        self.assertEqual(result["models"][:-1], self.catalog["models"])
        self.assertEqual(result["models"][-1]["id"], "openrouter:new:free")
        report = json.loads(self.report_path.read_text(encoding="utf-8"))
        self.assertEqual(report["sources"]["FreeLLMAPI"]["status"], "error")
        self.assertEqual(report["officialEndpoints"]["nvidia-nim"]["status"], "error")

    def test_dry_run_and_verification_failure_do_not_write_catalog(self) -> None:
        self.args.dry_run = True
        with (
            mock.patch.object(refresh, "load_freellmapi_candidates", return_value=({"openrouter": {"new:free"}}, {})),
            mock.patch.object(refresh, "load_awesome_candidates", side_effect=refresh.RefreshError("offline")),
            mock.patch.object(refresh, "load_official_models", return_value=({"existing", "new:free"}, "verified")),
        ):
            self.assertEqual(refresh.main(), 0)
        self.assertEqual(self.catalog_path.read_bytes(), self.original_bytes)
        self.assertTrue(json.loads(self.report_path.read_text(encoding="utf-8"))["dryRun"])

        self.args.dry_run = False
        with (
            mock.patch.object(refresh, "load_freellmapi_candidates", return_value=({}, {})),
            mock.patch.object(refresh, "load_awesome_candidates", return_value=({}, {})),
            mock.patch.object(refresh, "load_official_models", side_effect=refresh.RefreshError("offline")),
        ):
            with self.assertRaisesRegex(refresh.RefreshError, "no provider model endpoint"):
                refresh.main()
        self.assertEqual(self.catalog_path.read_bytes(), self.original_bytes)


if __name__ == "__main__":
    unittest.main()
