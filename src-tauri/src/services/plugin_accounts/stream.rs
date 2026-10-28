use futures_util::StreamExt;
use serde::Deserialize;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

pub type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub text: String,
    pub final_result: bool,
}

pub fn event(message: Message) -> Result<Option<Event>, String> {
    match message {
        Message::Text(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|_| "voice.error.transcribe".into()),
        Message::Ping(_) | Message::Pong(_) => Ok(None),
        _ => Err("voice.error.transcribe".into()),
    }
}

pub async fn connect(application: &str, account: &str) -> Result<(Socket, Event), String> {
    let plugin = super::contribution(application)?.ok_or("accountError.pluginRequired")?;
    if !super::allows(&plugin, application, "voice") {
        return Err("voice.error.transcribe".into());
    }
    let worker = super::worker(&plugin, application).await?;
    let url = format!(
        "ws://127.0.0.1:{}/voice/{}",
        worker.port,
        url::form_urlencoded::byte_serialize(account.as_bytes()).collect::<String>()
    );
    let generation = crate::services::developer_preview::token()?;
    tokio::select! {
        _=generation.cancelled()=>Err("voice.error.cancelled".into()),
        _=worker.cancelled.cancelled()=>Err("voice.error.cancelled".into()),
        result=connect_endpoint(&url,&worker.secret)=>result
    }
}

pub(crate) async fn connect_endpoint(url: &str, secret: &str) -> Result<(Socket, Event), String> {
    let mut request = url
        .into_client_request()
        .map_err(|_| "voice.error.transcribe")?;
    request.headers_mut().insert(
        "authorization",
        secret.parse().map_err(|_| "voice.error.transcribe")?,
    );
    let (mut socket, _) = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        tokio_tungstenite::connect_async(request),
    )
    .await
    .map_err(|_| "voice.error.transcribe")?
    .map_err(|_| "voice.error.transcribe")?;
    let ready = tokio::time::timeout(std::time::Duration::from_secs(20), socket.next())
        .await
        .map_err(|_| "voice.error.transcribe")?
        .ok_or("voice.error.transcribe")?
        .map_err(|_| "voice.error.transcribe")?;
    let ready = event(ready)?.ok_or("voice.error.transcribe")?;
    Ok((socket, ready))
}
