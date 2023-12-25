use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{Response, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use axum_auth::AuthBearer;
use fred::{
    clients::RedisClient,
    interfaces::{ClientLike, KeysInterface},
};
use serde::Deserialize;
use std::{collections::VecDeque, sync::Arc};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Deserialize, Debug, Clone)]
struct Config {
    port: u16,
    admin_key: String,
}

#[derive(Deserialize, Debug, Clone)]
struct LinkSchema {
    pub to: String,
    pub image: String,
    pub image_hash: String,
}

#[derive(Deserialize, Debug, Clone)]
struct WorkSchema {
    pub orig_url: String,
    pub result_url: String,
    pub success: bool,
    pub links: Option<Vec<LinkSchema>>,
}

#[derive(Clone)]
struct AppState {
    config: Config,
    redis: Arc<Mutex<RedisClient>>,
    queue: Arc<Mutex<VecDeque<String>>>,
}

struct AppError(anyhow::Error);
type AppResult<T> = axum::response::Result<T, AppError>;
impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0.to_string()).into_response()
    }
}
impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

async fn is_valid(redis: Arc<Mutex<RedisClient>>, token: String) -> anyhow::Result<bool> {
    let redis = redis.lock().await;
    let key = format!("auth:keys:{}", token);
    let exists: bool = redis.exists(&key).await?;
    Ok(exists)
}

async fn create_account(
    AuthBearer(token): AuthBearer,
    State(state): State<AppState>,
    desc: String,
) -> AppResult<Response<axum::body::Body>> {
    if token != state.config.admin_key {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    }

    let key = Uuid::new_v4();
    let redis = state.redis.lock().await;
    redis
        .set(&format!("auth:keys:{}", key), &desc, None, None, false)
        .await?;

    Ok(Response::new(key.to_string().into()))
}

async fn get_work(
    AuthBearer(token): AuthBearer,
    State(state): State<AppState>,
) -> AppResult<Response<String>> {
    if !is_valid(state.redis.clone(), token.clone()).await? {
        return Ok(Response::builder().status(401).body("".to_string())?);
    }

    /*
    let mut queue = state.queue.lock().await;
    if let Some(work) = queue.pop_front() {
        Response::new(work)
    } else {
        Response::builder()
            .status(204)
            .body("".to_string())
            .unwrap()
    }*/

    Ok(Response::new("https://notnite.com/".to_string()))
}

async fn post_work(
    AuthBearer(token): AuthBearer,
    State(state): State<AppState>,
    Json(work): Json<WorkSchema>,
) -> axum::response::Result<()> {
    Ok(())
}

async fn get_badge(Path(sha256): Path<String>) -> axum::response::Result<()> {
    Ok(())
}

async fn post_badge(
    AuthBearer(token): AuthBearer,
    State(state): State<AppState>,
    Path(sha256): Path<String>,
    image: Bytes,
) -> axum::response::Result<()> {
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path = std::env::args().nth(1).unwrap_or("config.json".to_string());
    let config = std::fs::read_to_string(config_path)?;
    let config: Config = serde_json::from_str(&config)?;

    let client = RedisClient::default();
    client.connect();
    client.wait_for_connect().await?;

    let app_state = AppState {
        config: config.clone(),
        redis: Arc::new(Mutex::new(client)),
        queue: Arc::new(Mutex::new(VecDeque::new())),
    };

    let app = Router::new()
        .route("/create_account", post(create_account))
        .route("/work", get(get_work))
        .route("/work", post(post_work))
        .route("/badge/:sha256", post(post_badge))
        .route("/badge/:sha256", get(get_badge))
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .unwrap();
    axum::serve(listener, app).await?;

    Ok(())
}
