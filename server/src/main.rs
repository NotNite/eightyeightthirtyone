use axum::{
    body::{Body, Bytes},
    extract::{Path, State},
    http::{Response, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use axum_auth::AuthBearer;
use base64::engine::GeneralPurpose;
use base64::Engine;
use fred::{
    clients::RedisClient,
    interfaces::{
        ClientLike, HashesInterface, HyperloglogInterface, KeysInterface, ListInterface,
        SetsInterface, SortedSetsInterface, TransactionInterface,
    },
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
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
    base64: GeneralPurpose,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Graph {
    links_to: HashMap<String, Vec<String>>,
    linked_from: HashMap<String, Vec<String>>,
    images: HashMap<String, Vec<String>>,
}

#[derive(Serialize, Debug, Clone)]
struct Statistics {
    pub queue: usize,
    pub visited_pages: usize,
    pub known_pages: usize,
    pub leaderboard: Vec<(String, u64)>,
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

fn get_domain(url: &str) -> Option<String> {
    let url = url::Url::parse(url).ok()?;
    let domain = url.domain()?;
    Some(domain.to_string())
}

async fn auth_valid(redis: Arc<Mutex<RedisClient>>, token: String) -> anyhow::Result<bool> {
    let redis = redis.lock().await;
    let key = format!("auth:keys:{}", token);
    let exists: bool = redis.exists(&key).await?;
    Ok(exists)
}

fn url_valid(url: &str) -> bool {
    let url = url::Url::parse(url);
    if url.is_err() {
        return false;
    }
    let url = url.unwrap();

    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return false;
    }

    true
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
) -> AppResult<Response<Body>> {
    if !auth_valid(state.redis.clone(), token.clone()).await? && token != state.config.admin_key {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    }

    let redis = state.redis.lock().await;
    let work: Option<String> = redis.lpop("pages:queue", None).await?;
    if let Some(work) = work {
        let api_key_hash = state.base64.encode(token.as_bytes());
        redis
            .sadd(format!("inprogress:{}", api_key_hash), &[work.clone()])
            .await?;

        let work = state.base64.decode(work.as_bytes())?;
        return Ok(Response::new(work.into()));
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn post_work(
    AuthBearer(token): AuthBearer,
    State(state): State<AppState>,
    Json(work): Json<WorkSchema>,
) -> AppResult<Response<Body>> {
    if !auth_valid(state.redis.clone(), token.clone()).await? && token != state.config.admin_key {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    }

    let orig_url = state.base64.encode(work.orig_url.as_bytes());
    let result_url = state.base64.encode(work.result_url.as_bytes());

    let redis = state.redis.lock().await;
    let max_pages: usize = redis
        .get::<String, _>("domains:max_pages")
        .await
        .unwrap_or("100".to_string())
        .parse()
        .unwrap_or(100);

    // remove from the client's in-progress tracking
    let api_key_hash = state.base64.encode(token.as_bytes());
    redis
        .srem(format!("inprogress:{}", api_key_hash), &[orig_url.clone()])
        .await?;

    if !url_valid(&work.orig_url) || !url_valid(&work.result_url) {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }

    let result_domain = get_domain(&work.result_url);
    if result_domain.is_none() {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }

    if work.orig_url != work.result_url {
        // Update redirect table
        redis
            .set(
                format!("redirect:{}", orig_url),
                result_url.clone(),
                None,
                None,
                false,
            )
            .await?;

        // Merge page record
        let orig_data = redis
            .hgetall::<HashMap<String, String>, _>(format!("pages:data:{}", orig_url))
            .await
            .ok();

        if let Some(orig_data) = orig_data {
            redis
                .hset(
                    format!("pages:data:{}", result_url),
                    orig_data
                        .into_iter()
                        .map(|(k, v)| (k, v.to_string()))
                        .collect::<HashMap<String, String>>(),
                )
                .await?;

            redis.del(format!("pages:data:{}", orig_url)).await?;
        }

        // Update link information
        let links_to = redis
            .smembers::<Vec<String>, _>(format!("pages:linksto:{}", orig_url))
            .await
            .unwrap_or_default();
        for link_to in links_to {
            let orig_link_data = redis
                .hgetall::<HashMap<String, String>, _>(format!("link:{}:{}", orig_url, link_to))
                .await
                .ok();
            if let Some(orig_link_data) = orig_link_data {
                redis
                    .hset(
                        format!("link:{}:{}", result_url, link_to),
                        orig_link_data
                            .into_iter()
                            .map(|(k, v)| (k, v.to_string()))
                            .collect::<HashMap<String, String>>(),
                    )
                    .await?;
            }
        }
        redis.del(format!("pages:linksto:{}", orig_url)).await?;

        let linked_from = redis
            .smembers::<Vec<String>, _>(format!("pages:linkedfrom:{}", orig_url))
            .await
            .unwrap_or_default();
        for link_from in &linked_from {
            let orig_link_data = redis
                .hgetall::<HashMap<String, String>, _>(format!("link:{}:{}", link_from, orig_url))
                .await
                .ok();
            if let Some(orig_link_data) = orig_link_data {
                redis
                    .hset(
                        format!("link:{}:{}", link_from, result_url),
                        orig_link_data
                            .into_iter()
                            .map(|(k, v)| (k, v.to_string()))
                            .collect::<HashMap<String, String>>(),
                    )
                    .await?;
            }
        }
        redis.del(format!("pages:linkedfrom:{}", orig_url)).await?;
        redis
            .sadd(format!("pages:linkedfrom:{}", result_url), linked_from)
            .await?;

        // Update page sets
        redis.sadd("pages", &[result_url.clone()]).await?;
        redis.sadd("pages:visited", &[result_url.clone()]).await?;
        redis.srem("pages", &[orig_url.clone()]).await?;
        redis.srem("pages:visited", &[orig_url.clone()]).await?;
    } else {
        redis.del(format!("redirect:{}", orig_url)).await?;
    }

    // TODO: handle link redirects changing properly
    //  - merge the two records together
    //  - update old links
    //  - update page set

    // Update the page metadata
    redis
        .hset(
            format!("pages:data:{}", result_url),
            HashMap::from_iter(vec![(
                "lastScraped".to_string(),
                chrono::Utc::now().timestamp().to_string(),
            )]),
        )
        .await?;

    if work.success {
        redis.sadd("pages:visited", &[result_url.clone()]).await?;
    } else {
        redis.sadd("pages:failed", &[result_url.clone()]).await?;
    }

    // Discover links
    if let Some(links) = work.links {
        for link in links {
            if !url_valid(&link.to) || !url_valid(&link.image) {
                continue;
            }

            let to = state.base64.encode(link.to.as_bytes());
            let to_domain = get_domain(&link.to);
            if to_domain.is_none() {
                continue;
            }
            let to_domain = state.base64.encode(to_domain.unwrap().as_bytes());

            // Handle denylisting and page-count limits
            if redis
                .sismember("domains:denylist", to_domain.clone())
                .await?
            {
                continue;
            }

            let pages = redis
                .pfcount::<usize, _>(format!("domain:pages:{}", to_domain.clone()))
                .await?;
            if pages >= max_pages {
                continue;
            }

            redis
                .pfadd(format!("domain:pages:{}", to_domain.clone()), &[to.clone()])
                .await?;

            // Update link metadata
            redis
                .sadd(format!("pages:linksto:{}", result_url), &[to.clone()])
                .await?;

            redis
                .sadd(format!("pages:linkedfrom:{}", to), &[result_url.clone()])
                .await?;

            let image_url = state.base64.encode(link.image.as_bytes());
            redis
                .hset(
                    format!("link:{}:{}", result_url, to),
                    HashMap::from_iter(vec![
                        ("imageUrl".to_string(), image_url),
                        ("imageHash".to_string(), link.image_hash),
                    ]),
                )
                .await?;

            // Add link to the known pages and the queue if it doesn't exist yet
            // TODO: this should also consider if the link querying is expired
            let exists: bool = redis.sismember("pages", &to).await?;
            if !exists {
                redis.sadd("pages", &[to.clone()]).await?;
                redis
                    .hset(
                        format!("pages:data:{}", to),
                        HashMap::from_iter(vec![("lastScraped".to_string(), "0".to_string())]),
                    )
                    .await?;

                let redirect: Option<String> =
                    redis.get(format!("redirect:{}", to)).await.unwrap_or(None);
                if let Some(redirect) = redirect {
                    redis.rpush("pages:queue", &[redirect]).await?;
                } else {
                    redis.rpush("pages:queue", &[to.clone()]).await?;
                }
            }
        }
    }

    redis
        .zincrby("scraper:leaderboard", 1.0, api_key_hash)
        .await?;

    println!("Processed {}", work.result_url);
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn submit(
    AuthBearer(token): AuthBearer,
    State(state): State<AppState>,
    url: String,
) -> AppResult<Response<Body>> {
    if token != state.config.admin_key {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    }

    let redis = state.redis.lock().await;
    let transaction = redis.multi();

    let domain = get_domain(&url);
    if domain.is_none() {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }
    let domain = state.base64.encode(domain.unwrap().as_bytes());
    let url = state.base64.encode(url.as_bytes());

    transaction.sadd("pages", &[url.clone()]).await?;
    transaction
        .pfadd(format!("domain:pages:{}", domain.clone()), &[url.clone()])
        .await?;
    transaction.rpush("pages:queue", &[url.clone()]).await?;
    transaction
        .hset(
            format!("pages:data:{}", url),
            HashMap::from_iter(vec![("lastScraped".to_string(), "0".to_string())]),
        )
        .await?;

    transaction.exec(true).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn graph(
    AuthBearer(token): AuthBearer,
    State(state): State<AppState>,
) -> AppResult<Response<Body>> {
    if token != state.config.admin_key {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    }

    let mut graph = Graph {
        links_to: HashMap::new(),
        linked_from: HashMap::new(),
        images: HashMap::new(),
    };

    let redis = state.redis.lock().await;
    let pages = redis.smembers::<Vec<String>, _>("pages").await?;
    for page_b64 in pages {
        let page = String::from_utf8(state.base64.decode(&page_b64)?)?;
        let page_domain = get_domain(&page);
        if page_domain.is_none() {
            continue;
        }
        let page_domain = page_domain.unwrap();

        let links_to = redis
            .smembers::<Vec<String>, _>(format!("pages:linksto:{}", page_b64))
            .await
            .unwrap_or_default();
        for link_to in links_to {
            let redirect = redis
                .get::<String, _>(format!("redirect:{}", link_to))
                .await
                .ok();

            let url = if let Some(redirect) = redirect {
                String::from_utf8(state.base64.decode(&redirect)?)?
            } else {
                String::from_utf8(state.base64.decode(&link_to)?)?
            };

            if let Some(link_domain) = get_domain(&url) {
                graph
                    .links_to
                    .entry(page_domain.clone())
                    .or_default()
                    .push(link_domain.clone());

                graph.links_to.entry(link_domain.clone()).or_default();
                graph.linked_from.entry(link_domain.clone()).or_default();
                graph.images.entry(link_domain.clone()).or_default();

                let image_hash = redis
                    .hget::<String, _, String>(
                        format!("link:{}:{}", page_b64, link_to),
                        "imageHash".to_string(),
                    )
                    .await
                    .ok();

                if let Some(image_hash) = image_hash {
                    let hashes = graph.images.entry(link_domain.clone()).or_default();
                    if !hashes.contains(&image_hash) {
                        hashes.push(image_hash.clone());
                    }
                }
            }
        }

        let linked_from = redis
            .smembers::<Vec<String>, _>(format!("pages:linkedfrom:{}", page_b64))
            .await
            .unwrap_or_default();
        for link_from in linked_from {
            let redirect = redis
                .get::<String, _>(format!("redirect:{}", link_from))
                .await
                .ok();

            let url = if let Some(redirect) = redirect {
                String::from_utf8(state.base64.decode(&redirect)?)?
            } else {
                String::from_utf8(state.base64.decode(&link_from)?)?
            };

            if let Some(link_domain) = get_domain(&url) {
                graph
                    .linked_from
                    .entry(page_domain.clone())
                    .or_default()
                    .push(link_domain.clone());

                graph.links_to.entry(link_domain.clone()).or_default();
                graph.linked_from.entry(link_domain.clone()).or_default();
                graph.images.entry(link_domain.clone()).or_default();
            }
        }
    }

    // Deduplicate
    for (_, links) in graph.links_to.iter_mut() {
        links.sort();
        links.dedup();
    }
    for (_, links) in graph.linked_from.iter_mut() {
        links.sort();
        links.dedup();
    }
    for (_, hashes) in graph.images.iter_mut() {
        hashes.sort();
        hashes.dedup();
    }

    Ok(Json(graph).into_response())
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

async fn get_badge(Path(sha256): Path<String>) -> AppResult<Response<Body>> {
    if !is_sha256(&sha256) {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }

    let exists = tokio::fs::metadata(format!("./images/{}", sha256))
        .await
        .is_ok();
    if !exists {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }

    let data = tokio::fs::read(format!("./images/{}", sha256)).await?;
    let mime = infer::get(&data)
        .map(|x| x.mime_type())
        .unwrap_or("application/octet-stream");
    let response = Response::builder()
        .header("Content-Type", mime.to_string())
        .body(data.into())?;
    Ok(response)
}

async fn post_badge(
    AuthBearer(token): AuthBearer,
    State(state): State<AppState>,
    Path(sha256): Path<String>,
    image: Bytes,
) -> AppResult<Response<Body>> {
    if !auth_valid(state.redis.clone(), token.clone()).await? && token != state.config.admin_key {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    }

    if !is_sha256(&sha256) {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }

    tokio::fs::create_dir_all("./images").await?;
    let exists = tokio::fs::metadata(format!("./images/{}", sha256))
        .await
        .is_ok();
    if exists {
        return Ok(StatusCode::CONFLICT.into_response());
    }

    tokio::fs::write(format!("./images/{}", sha256), image).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn statistics(State(state): State<AppState>) -> AppResult<Json<Statistics>> {
    let redis = state.redis.lock().await;

    let queue: usize = redis.llen("pages:queue").await.unwrap_or(0);
    let visited_pages: usize = redis.scard("pages:visited").await.unwrap_or(0);
    let known_pages: usize = redis.scard("pages").await.unwrap_or(0);

    let top_scrapers = redis
        .zrange::<Vec<(String, u64)>, _, _, _>("scraper:leaderboard", 0, 9, None, false, None, true)
        .await?;

    let mut leaderboard = Vec::new();
    for (api_key_hash, score) in top_scrapers {
        let token = state
            .base64
            .decode(api_key_hash)
            .map(|v| String::from_utf8(v).unwrap_or("".to_owned()))
            .unwrap_or("".to_owned());
        let desc = redis.get(format!("auth:keys:{}", token)).await?;
        leaderboard.push((desc, score))
    }

    Ok(Json(Statistics {
        queue,
        visited_pages,
        known_pages,
        leaderboard,
    }))
}

async fn update_queue(state: &AppState) -> anyhow::Result<()> {
    println!("Updating queue...");

    let now = chrono::Utc::now().timestamp();
    let week_ago = now - (60 * 60 * 24 * 7);

    let redis = state.redis.lock().await;
    redis.del("pages:queue").await?;

    let max_pages: usize = redis
        .get::<String, _>("domains:max_pages")
        .await
        .unwrap_or("100".to_string())
        .parse()
        .unwrap_or(100);

    let pages = redis.smembers::<Vec<String>, _>("pages").await?;
    for page in pages {
        let last_scraped = redis
            .hget::<String, _, String>(format!("pages:data:{}", page), "lastScraped".to_string())
            .await
            .unwrap_or("0".to_string())
            .parse::<i64>()
            .unwrap_or(0);

        if last_scraped == 0 || last_scraped < week_ago {
            // Safety check here just in case
            if redis.sismember("domains:denylist", page.clone()).await? {
                continue;
            }

            let pages = redis
                .pfcount::<usize, _>(format!("domain:pages:{}", page.clone()))
                .await?;
            if pages >= max_pages {
                continue;
            }

            let redirect: Option<String> = redis
                .get(format!("redirect:{}", page))
                .await
                .unwrap_or(None);

            if let Some(redirect) = redirect {
                // Duplicate safety checks for the redirect URL
                if redis
                    .sismember("domains:denylist", redirect.clone())
                    .await?
                {
                    continue;
                }

                let pages = redis
                    .pfcount::<usize, _>(format!("domain:pages:{}", redirect.clone()))
                    .await?;
                if pages >= max_pages {
                    continue;
                }

                redis.rpush("pages:queue", &[redirect]).await?;
            } else {
                redis.rpush("pages:queue", &[page.clone()]).await?;
            }
        }
    }

    let queue_size = redis.llen::<usize, _>("pages:queue").await?;
    println!("Queue updated, new size: {}", queue_size);

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
        base64: base64::prelude::BASE64_STANDARD,
    };

    update_queue(&app_state).await?;

    let app = Router::new()
        .route("/create_account", post(create_account))
        .route("/work", get(get_work))
        .route("/work", post(post_work))
        .route("/submit", post(submit))
        .route("/graph", get(graph))
        .route("/badge/:sha256", post(post_badge))
        .route("/badge/:sha256", get(get_badge))
        .route("/statistics", get(statistics))
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .unwrap();
    axum::serve(listener, app).await?;

    Ok(())
}
