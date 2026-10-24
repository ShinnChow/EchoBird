//! Stable client selectors for the enabled models of one router.
use super::*;
use sha2::{Digest, Sha256};

pub(crate) const SELECTOR_PREFIX: &str = "claude-fable-echobird-";

#[derive(Clone, Debug)]
pub(crate) struct SwitchModel {
    pub id: String,
    pub name: String,
}

#[cfg(test)]
tokio::task_local! { static TEST_MODELS: (String, Vec<SwitchModel>); }

#[cfg(test)]
pub(crate) fn with_test_models<T>(run: impl FnOnce() -> T) -> T {
    with_test_models_at("http://127.0.0.1:53683/v1", run)
}

#[cfg(test)]
pub(crate) fn with_test_models_at<T>(base_url: &str, run: impl FnOnce() -> T) -> T {
    TEST_MODELS.sync_scope(
        (
            base_url.trim_end_matches('/').into(),
            vec![
                SwitchModel {
                    id: "auto".into(),
                    name: "Auto Router".into(),
                },
                SwitchModel {
                    id: selector("first"),
                    name: "First model".into(),
                },
                SwitchModel {
                    id: selector("second"),
                    name: "Second model".into(),
                },
            ],
        ),
        run,
    )
}

pub(crate) fn selector(internal_id: &str) -> String {
    format!(
        "{SELECTOR_PREFIX}{}",
        &hex::encode(Sha256::digest(internal_id.as_bytes()))[..24]
    )
}

pub(super) fn display_name(model_id: &str, title: &str) -> String {
    format!("{model_id} · {title}")
}

pub(crate) fn models_for_url(base_url: &str) -> Result<Vec<SwitchModel>, String> {
    #[cfg(test)]
    if let Ok((url, models)) = TEST_MODELS.try_with(Clone::clone) {
        if url == base_url.trim_end_matches('/') {
            return Ok(models);
        }
    }
    let Some(id) = profiles::ids()
        .into_iter()
        .find(|id| profiles::with(id, || is_loopback_url_on_port(base_url, port())))
    else {
        return Ok(Vec::new());
    };
    profiles::with(&id, || {
        let config = load_config()?;
        let active = config.active_candidate_ids();
        Ok(models(
            &config.model_id,
            &config.name,
            &active,
            &get_candidate_models(),
        ))
    })
}

pub(super) fn models(
    model_id: &str,
    name: &str,
    ids: &[String],
    candidates: &[ModelConfig],
) -> Vec<SwitchModel> {
    let mut models = vec![SwitchModel {
        id: model_id.into(),
        name: name.into(),
    }];
    models.extend(ids.iter().filter_map(|id| {
        let model = candidates
            .iter()
            .find(|m| m.internal_id == *id && model_is_routable(m))?;
        Some(SwitchModel {
            id: selector(id),
            name: display_name(model.model_id.as_deref().unwrap_or_default(), &model.name),
        })
    }));
    models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picker_contains_only_active_models_in_this_group_and_keeps_duplicate_upstream_ids_distinct()
    {
        let candidate = |id: &str| {
            serde_json::from_value::<ModelConfig>(serde_json::json!({
            "internalId":id,"name":id,"modelId":"same-model","baseUrl":"https://fixture.invalid/v1","apiKey":"fixture"
        })).unwrap()
        };
        let mut candidates = vec![
            candidate("first"),
            candidate("second"),
            candidate("paused"),
            candidate("other-group"),
        ];
        candidates[1].name = "哈哈哈哈".into();
        let active = vec!["second".into(), "first".into(), "deleted".into()];
        let listed = models("custom-auto", "My router", &active, &candidates);
        assert_eq!(listed.len(), 3);
        assert_eq!(listed[0].id, "custom-auto");
        assert_eq!(listed[0].name, "My router");
        assert_eq!(listed[1].id, selector("second"));
        assert_eq!(listed[2].id, selector("first"));
        assert_ne!(listed[1].id, listed[2].id);
        assert_eq!(listed[1].name, "same-model · 哈哈哈哈");
        assert_eq!(listed[2].name, "same-model · first");

        let native = crate::services::codex_catalog::build_router_catalog(&listed, false);
        assert_eq!(native["models"][0]["display_name"], "My router");
        assert_eq!(native["models"][1]["display_name"], "same-model · 哈哈哈哈");
        assert_eq!(native["models"][1]["slug"], selector("second"));
    }

    #[test]
    fn selectors_are_stable_and_do_not_depend_on_upstream_names() {
        assert_eq!(selector("one"), selector("one"));
        assert_ne!(selector("one"), selector("two"));
        assert!(selector("vendor/model[1m]").starts_with(SELECTOR_PREFIX));
        assert_eq!(selector("one").len(), SELECTOR_PREFIX.len() + 24);
    }
}
