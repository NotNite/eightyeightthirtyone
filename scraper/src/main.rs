use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::time::Duration;
use texting_robots::{get_robots_url, Robot};
use thirtyfour::{fantoccini::wd::Locator, By, DesiredCapabilities, WebDriver, WebElement};

pub static USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 eightyeightthirtyone/1.0.0 (https://github.com/NotNite/eightyeightthirtyone)";

#[derive(Deserialize, Debug, Clone)]
pub struct Config {
    host: String,
    key: String,
    drivers: Vec<String>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct LinkSchema {
    pub to: String,
    pub image: String,
    pub image_hash: String,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct WorkSchema {
    pub orig_url: String,
    pub result_url: String,
    pub links: Vec<LinkSchema>,
}

#[async_recursion::async_recursion]
async fn recursive_children(el: &WebElement) -> anyhow::Result<Vec<WebElement>> {
    let mut children = vec![];

    for child in el.find_all(Locator::Css("*")).await? {
        children.append(&mut recursive_children(&child).await?);
        children.push(child);
    }

    Ok(children)
}

async fn image_is_88x31(url: &str, reqwest_client: &reqwest::Client) -> anyhow::Result<String> {
    let response = reqwest_client.get(url).send().await?;
    let bytes = response.bytes().await?;
    let image = image::load_from_memory(&bytes)?;

    let nudge = 2;
    let width = 88;
    let height = 31;

    if !(image.width() <= width + nudge
        && image.width() >= width - nudge
        && image.height() <= height + nudge
        && image.height() >= height - nudge)
    {
        anyhow::bail!("image is not 88x31");
    }

    let hash = format!("{:x}", sha2::Sha256::digest(&bytes));
    Ok(hash)
}

async fn check_robots_txt(url: &str) -> anyhow::Result<bool> {
    let robot_url = get_robots_url(url)?;
    let response = reqwest::get(robot_url).await?;
    let text = response.text().await?;
    let robots = Robot::new(USER_AGENT, text.as_bytes())?;
    Ok(robots.allowed(url))
}

async fn process(
    driver: &WebDriver,
    url: &str,
    reqwest_client: &reqwest::Client,
) -> anyhow::Result<WorkSchema> {
    if !check_robots_txt(url).await.unwrap_or_default() {
        anyhow::bail!("robots.txt disallowed");
    }

    let parsed_url = url::Url::parse(url)?;

    driver.goto(url).await?;
    let current_url = driver.current_url().await?;
    let body = driver.active_element().await?;

    let links = body.find_all(By::Tag("a")).await?;
    let mut result = Vec::new();
    for link in links {
        if let Some(href) = link.attr("href").await? {
            if let Some(real_href) = url::Url::parse(current_url.as_str())
                .and_then(|u| u.join(&href))
                .ok()
                .map(|u| u.to_string())
            {
                let children = recursive_children(&link).await?;
                for child in children {
                    if child.tag_name().await? == "img" {
                        if let Some(src) = child.attr("src").await? {
                            let src = parsed_url.join(&src)?.to_string();

                            if let Ok(hash) = image_is_88x31(&src, reqwest_client).await {
                                result.push(LinkSchema {
                                    to: real_href.clone(),
                                    image: src,
                                    image_hash: hash,
                                })
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(WorkSchema {
        orig_url: url.to_string(),
        result_url: current_url.to_string(),
        links: result,
    })
}

async fn try_work(
    client: &reqwest::Client,
    driver: &WebDriver,
    config: &Config,
) -> anyhow::Result<()> {
    let req = client
        .get(&format!("{}/work", config.host))
        .header("Authorization", config.key.clone())
        .send()
        .await?;
    if !req.status().is_success() {
        anyhow::bail!("failed to get work");
    }

    let url = req.text().await?;

    if !url.is_empty() {
        println!("Processing: {}", url);
        let work = process(driver, &url, client).await?;
        let work = serde_json::to_string(&work)?;
        client
            .post(&format!("{}/work", config.host))
            .header("Content-Type", "application/json")
            .header("Authorization", config.key.clone())
            .body(work)
            .send()
            .await?;
    }

    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path = std::env::args().nth(1).unwrap_or("config.json".to_string());
    let config = std::fs::read_to_string(config_path)?;
    let config: Config = serde_json::from_str(&config)?;

    let mut tasks = vec![];

    let (shutdown_tx, shutdown_rx) = flume::unbounded();

    for host in &config.drivers {
        let mut caps = DesiredCapabilities::chrome();
        caps.add_chrome_arg(&format!("--user-agent={}", USER_AGENT))?;
        let driver = WebDriver::new(host, caps).await?;

        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .user_agent(USER_AGENT)
            .build()?;

        let config = config.clone();
        let shutdown_rx = shutdown_rx.clone();
        tasks.push(tokio::spawn(async move {
            loop {
                if shutdown_rx.try_recv().is_ok() {
                    driver.quit().await.ok();
                    break;
                }

                if let Err(e) = try_work(&client, &driver, &config).await {
                    eprintln!("error: {}", e);
                }

                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
        }));
    }

    tasks.push(tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        shutdown_tx.send(()).ok();
    }));

    tokio::select! {
        _ = futures::future::join_all(tasks) => {},
        _ = shutdown_rx.recv_async() => {},
    }

    Ok(())
}
