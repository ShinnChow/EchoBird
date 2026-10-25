use super::*;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Instant,
};

const SHORT_TEXT: &str = "这是语音识别测试，最后的校验词是蓝色咖啡。";
const TAIL_TEXT: &str = "最后的校验词是紫色山峰。";
const SHORT_SHA: &str = "69bf3d356f603e8c957e5d52a27a39b00ab8cb09063fde8d4c5f6f172afdf621";
const LONG_SHA: &str = "08bedf3a262e158882937e3d96895a82f4c45ad8fc42c72cb6c9570069427f49";

struct Fixture {
    name: &'static str,
    path: PathBuf,
    audio: Bytes,
    sha: &'static str,
    tail: &'static str,
    repeats: usize,
}

impl Fixture {
    fn load(
        name: &'static str,
        env: &str,
        sha: &'static str,
        tail: &'static str,
        repeats: usize,
    ) -> Self {
        let path =
            PathBuf::from(std::env::var(env).expect("Explicit public fixture path is required"));
        assert!(path.is_absolute(), "Fixture path must be absolute");
        let audio = Bytes::from(fs::read(&path).expect("Public fixture could not be read"));
        assert_eq!(
            format!("{:x}", Sha256::digest(&audio)),
            sha,
            "Only the fixed public synthetic fixtures are permitted"
        );
        super::super::claude_voice::pcm(&audio)
            .expect("Public fixture format must be 16 kHz mono PCM16 WAV");
        Self {
            name,
            path,
            audio,
            sha,
            tail,
            repeats,
        }
    }

    fn receipt(&self) -> Value {
        json!({"fixture":self.name,"path":self.path,"sha256":self.sha,"bytes":self.audio.len(),
            "duration_ms":(self.audio.len()-44)as u64*1000/32000,
            "format":"16 kHz mono PCM16LE WAV; canonical 44-byte header",
            "public_text":if self.repeats==1 {SHORT_TEXT.to_owned()} else {format!("{SHORT_TEXT}{SHORT_TEXT}{TAIL_TEXT}")},
            "prefix_check":"语音识别测试","tail_check":self.tail,"required_repeats":self.repeats})
    }
}

fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn verification(text: &str, fixture: &Fixture) -> Value {
    let text = normalize(text);
    let beginning = text.chars().take(24).collect::<String>();
    let ending = text
        .chars()
        .rev()
        .take(24)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    let repeats = text.matches("语音识别测试").count();
    let prefix_ok = beginning.contains("语音识别测试");
    let tail_ok = ending.contains(fixture.tail);
    let repeat_ok = repeats >= fixture.repeats;
    json!({"prefix_ok":prefix_ok,"tail_ok":tail_ok,"repeat_count":repeats,"repeat_ok":repeat_ok,
        "verified":!text.is_empty()&&prefix_ok&&tail_ok&&repeat_ok})
}

async fn run_case(client: &reqwest::Client, source: &AccountSource, fixture: &Fixture) -> Value {
    let started = Instant::now();
    let selectors = match list_models(source).await {
        Ok(selectors) => selectors,
        Err(_) => {
            return json!({"outcome":"failed","stage":"catalog","attempted":false,
            "dispatcher_status":null,"elapsed_ms":started.elapsed().as_millis()})
        }
    };
    let Some(selector) = selectors.first() else {
        return json!({"outcome":"failed","stage":"empty_catalog","attempted":false,"dispatcher_status":null});
    };
    if !parse_selector(selector).is_ok_and(|(parsed, _)| {
        parsed.provider == source.provider && parsed.account_id == source.account_id
    }) {
        return json!({"outcome":"failed","stage":"selector","attempted":false,"dispatcher_status":400});
    }
    match transcribe(
        client,
        SpeechRequest {
            selector,
            audio: &fixture.audio,
            filename: "public-synthetic.wav",
            mime: "audio/wav",
        },
    )
    .await
    {
        Ok(text) => {
            let checks = verification(&text, fixture);
            if std::env::var("ECHOBIRD_ACCOUNT_VOICE_BATCH_DEBUG_PUBLIC_TEXT").as_deref() == Ok("1")
            {
                eprintln!("public synthetic result fixture={}: {text:?}", fixture.name);
            }
            json!({"outcome":if checks["verified"]==true {"passed"} else {"failed"},
                "stage":"verification","attempted":true,"dispatcher_status":200,
                "upstream_http_status":null,"status_scope":"speech dispatcher result; transport status not exposed",
                "transcript_chars":text.chars().count(),"checks":checks,"elapsed_ms":started.elapsed().as_millis()})
        }
        Err(error) => json!({"outcome":"failed","stage":"transcription","attempted":true,
            "dispatcher_status":error.status.as_u16(),"upstream_http_status":null,
            "status_scope":"ProxyError status; upstream versus local mapping not exposed",
            "transcript_chars":0,"checks":null,"elapsed_ms":started.elapsed().as_millis()}),
    }
}

fn file_sha(path: &Path) -> String {
    let mut file = File::open(path).expect("Batch executable could not be read");
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .expect("Batch executable hash failed");
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    format!("{:x}", digest.finalize())
}

fn write_json(path: &Path, value: &Value) {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .expect("Use a fresh ignored batch output directory");
    serde_json::to_writer_pretty(&mut file, value).expect("Batch receipt could not be serialized");
    file.flush().expect("Batch receipt could not be flushed");
}

fn record(
    file: &mut File,
    results: &mut Vec<Value>,
    mut value: Value,
    provider: &str,
    ordinal: Option<usize>,
    fixture: &str,
) {
    value["provider"] = json!(provider);
    value["account_ordinal"] = json!(ordinal);
    value["fixture"] = json!(fixture);
    value["finished_at_utc"] = json!(chrono::Utc::now().to_rfc3339());
    writeln!(file, "{value}").expect("Batch event could not be written");
    file.flush().expect("Batch event could not be flushed");
    eprintln!("VOICE_BATCH {value}");
    results.push(value);
}

#[tokio::test]
#[ignore = "Explicit batch only: fixed public synthetic WAVs and saved accounts; no native import or selection changes"]
async fn live_saved_speech_batch() {
    let names: Vec<String> = serde_json::from_str(
        &std::env::var("ECHOBIRD_ACCOUNT_VOICE_BATCH_PROVIDERS")
            .expect("Explicit JSON provider list is required"),
    )
    .expect("Provider list must be JSON strings");
    assert!(!names.is_empty(), "At least one new provider is required");
    let mut providers = Vec::new();
    for name in &names {
        assert!(
            matches!(
                name.as_str(),
                "cursor"
                    | "grokbot"
                    | "dumate"
                    | "devin"
                    | "trae"
                    | "codeArts"
                    | "doubaowork"
                    | "dola"
            ),
            "Batch only permits the explicitly selected new speech providers"
        );
        let provider: AccountProvider = serde_json::from_value(json!(name))
            .expect("Provider must be registered in this executable");
        assert!(
            !providers.contains(&provider),
            "Duplicate provider would repeat account requests"
        );
        providers.push(provider);
    }
    let output = PathBuf::from(
        std::env::var("ECHOBIRD_ACCOUNT_VOICE_BATCH_OUTPUT")
            .expect("Explicit ignored output directory is required"),
    )
    .canonicalize()
    .expect("Runner must create the ignored output directory first");
    let research = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../internal-docs/voice-account-research")
        .canonicalize()
        .expect("Research output root is unavailable");
    assert!(
        output.starts_with(&research) && output != research,
        "Batch output must be a child of the ignored research directory"
    );
    let fixtures = [
        Fixture::load(
            "zh-short",
            "ECHOBIRD_ACCOUNT_VOICE_BATCH_SHORT_WAV",
            SHORT_SHA,
            "蓝色咖啡",
            1,
        ),
        Fixture::load(
            "zh-paused-long",
            "ECHOBIRD_ACCOUNT_VOICE_BATCH_LONG_WAV",
            LONG_SHA,
            "紫色山峰",
            2,
        ),
    ];
    let exe = std::env::current_exe().expect("Batch executable identity is unavailable");
    let receipt = json!({"started_at_utc":chrono::Utc::now().to_rfc3339(),"requested_providers":names,
        "executable":{"path":exe,"sha256":file_sha(&exe)},"fixtures":fixtures.iter().map(Fixture::receipt).collect::<Vec<_>>(),
        "synthetic_only":true,"account_names_ids_tokens_logged":false,
        "protocol_trace":std::env::var("ECHOBIRD_ACCOUNT_VOICE_TEST_TRACE").as_deref()==Ok("1"),
        "debug_public_text":std::env::var("ECHOBIRD_ACCOUNT_VOICE_BATCH_DEBUG_PUBLIC_TEXT").as_deref()==Ok("1")});
    write_json(&output.join("batch-receipt.json"), &receipt);
    let mut events = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(output.join("batch-events.jsonl"))
        .expect("Batch event file must be new");
    let mut results = Vec::new();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("Batch HTTP client unavailable");
    for (provider, name) in providers.into_iter().zip(&names) {
        let rows = match account_model_sources::list_accounts(provider).await {
            Ok(rows) => rows,
            Err(_) => {
                record(
                    &mut events,
                    &mut results,
                    json!({"outcome":"failed","stage":"inventory","attempted":false,
                "reason":"saved_directory_unavailable"}),
                    name,
                    None,
                    "both",
                );
                continue;
            }
        };
        if rows.is_empty() {
            record(
                &mut events,
                &mut results,
                json!({"outcome":"skipped","stage":"inventory","attempted":false,
            "reason":"no_saved_account_unverified"}),
                name,
                None,
                "both",
            );
            continue;
        }
        for (index, row) in rows.into_iter().enumerate() {
            let short = run_case(&client, &row.source, &fixtures[0]).await;
            let short_passed = short["outcome"] == "passed";
            record(
                &mut events,
                &mut results,
                short,
                name,
                Some(index + 1),
                fixtures[0].name,
            );
            let long = if short_passed {
                run_case(&client, &row.source, &fixtures[1]).await
            } else {
                json!({"outcome":"skipped","stage":"policy","attempted":false,"reason":"short_failed"})
            };
            record(
                &mut events,
                &mut results,
                long,
                name,
                Some(index + 1),
                fixtures[1].name,
            );
        }
    }
    let attempted = results.iter().filter(|r| r["attempted"] == true).count();
    let passed = results.iter().filter(|r| r["outcome"] == "passed").count();
    let failed = results.iter().filter(|r| r["outcome"] == "failed").count();
    let skipped = results.iter().filter(|r| r["outcome"] == "skipped").count();
    let complete = attempted > 0 && passed > 0 && failed == 0 && skipped == 0;
    let summary = json!({"finished_at_utc":chrono::Utc::now().to_rfc3339(),"attempted":attempted,"verified_successes":passed,
        "failed":failed,"skipped":skipped,"positive_control":passed>0,"complete":complete,
        "status":if complete {"passed"} else if attempted==0||passed==0 {"no_positive_control"} else if failed>0 {"failed"} else {"partial_unverified"}});
    write_json(
        &output.join("batch-summary.json"),
        &json!({"receipt":receipt,"summary":summary,"results":results}),
    );
    eprintln!("VOICE_BATCH_SUMMARY {summary}");
    assert!(complete,"Batch incomplete; inspect ignored summary. Missing accounts never count as verified success");
}
