use super::{api, credentials, proxy, Credentials};
use serde_json::{json, Value};

pub(crate) async fn voice_credentials(id: &str, rejected: Option<&Value>) -> Result<Value, String> {
    let token = match rejected {
        Some(rejected) => proxy::proxy_credentials_after_rejection(id, rejected).await?,
        None => proxy::proxy_credentials(id, false).await?,
    };
    let c = credentials(id).await?;
    let client = api::Client::authenticated(&c)?;
    prepare(&client, &c, &token).await
}

async fn prepare(client: &api::Client, c: &Credentials, token: &Value) -> Result<Value, String> {
    if c.enterprise() {
        return Err("accountError.unavailable".into());
    }
    let token = api::text(token, "accessToken").ok_or("accountError.invalidAccount")?;
    let account = api::text(&c.profile, "bceAccountId").ok_or("accountError.invalidAccount")?;
    let session = client.speech_session(c).await?;
    // Cookies stay in the account service. BOS credentials live only in this request.
    Ok(json!({"accessToken":token,"bceAccountId":account,"bosSession":session}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::HeaderMap, routing::get, Json, Router};
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn session_uses_cookie_client_and_does_not_export_cookie_or_store_sha_id() {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let app = Router::new().route("/api/dumate/system/sessionToken", get(move |headers:HeaderMap| {
            let captured=captured.clone();
            async move {
                captured.lock().unwrap().push(headers);
                Json(json!({"code":0,"result":{"accessKeyId":"temporary-ak","secretAccessKey":"temporary-sk","sessionToken":"temporary-session"}}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client =
            api::Client::new(format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut c = super::super::tests::fixture();
        c.cookies.push(
            json!({"name":"bce-user-info","value":"fixture-csrf","domain":"127.0.0.1","path":"/"}),
        );
        let value = prepare(
            &client,
            &c,
            &json!({"accessToken":"gateway-token","accountId":"sha-store-key"}),
        )
        .await
        .unwrap();
        assert_eq!(value["accessToken"], "gateway-token");
        assert_eq!(value["bceAccountId"], c.profile["bceAccountId"]);
        assert_eq!(value["bosSession"]["secretAccessKey"], "temporary-sk");
        assert!(value.get("accountId").is_none());
        assert!(!value.to_string().contains("fixture-secret"));
        let headers = requests.lock().unwrap();
        assert_eq!(headers.len(), 1);
        assert!(headers[0]["cookie"]
            .to_str()
            .unwrap()
            .contains("fixture-secret"));
        assert_eq!(headers[0]["csrftoken"], "fixture-csrf");
        assert_eq!(headers[0]["x-dumate-client-type"], "desktop");
        assert_eq!(headers[0]["x-requested-with"], "XMLHttpRequest");
        assert!(!headers[0].contains_key("authorization"));
        server.abort();
    }
}
