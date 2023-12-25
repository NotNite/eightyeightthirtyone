use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::time::Duration;
use texting_robots::{get_robots_url, Robot};
use thirtyfour::{
    error::WebDriverError, fantoccini::wd::Locator, By, DesiredCapabilities, WebDriver, WebElement,
};
use thiserror::Error;

pub static USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 eightyeightthirtyone/1.0.0 (https://github.com/NotNite/eightyeightthirtyone)";

#[derive(Deserialize, Debug, Clone)]
pub struct Config {
    host: String,
    key: String,
    drivers: Option<Vec<String>>,
    tasks: Option<usize>,
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
    pub success: bool,
    pub links: Option<Vec<LinkSchema>>,
}

#[derive(Error, Debug)]
pub enum ScrapeError {
    #[error("webdriver error")]
    WebDriver(#[from] thirtyfour::error::WebDriverError),

    #[error("API call error")]
    Api(#[from] Option<reqwest::Error>),

    #[error("robots.txt disallowed")]
    Robots,

    #[error("unknown error")]
    Unknown(#[from] anyhow::Error),
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

async fn image_is_88x31(
    url: &str,
    reqwest_client: &reqwest::Client,
    config: &Config,
) -> anyhow::Result<String> {
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

    reqwest_client
        .post(&format!("{}/badge/{}", config.host, hash))
        .header("Authorization", &format!("Bearer {}", config.key))
        .body(bytes)
        .send()
        .await
        .ok();

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
    driver: &Option<WebDriver>,
    url: &str,
    reqwest_client: &reqwest::Client,
    config: &Config,
) -> Result<WorkSchema, ScrapeError> {
    if !check_robots_txt(url).await.unwrap_or_default() {
        return Err(ScrapeError::Robots);
    }

    let parsed_url = url::Url::parse(url).map_err(|e| ScrapeError::Unknown(e.into()))?;
    let mut result = Vec::new();
    let mut current_url = parsed_url.clone();

    if let Some(driver) = driver {
        driver.goto(url).await?;
        current_url = driver.current_url().await?;
        let body = driver.active_element().await?;

        let links = body.find_all(By::Tag("a")).await?;
        for link in links {
            if let Some(href) = link.attr("href").await? {
                if let Some(real_href) = url::Url::parse(current_url.as_str())
                    .and_then(|u| u.join(&href))
                    .ok()
                    .map(|u| u.to_string())
                {
                    let children = recursive_children(&link)
                        .await
                        .map_err(ScrapeError::Unknown)?;
                    for child in children {
                        if child.tag_name().await? == "img" {
                            if let Some(src) = child.attr("src").await? {
                                let src = parsed_url
                                    .join(&src)
                                    .map_err(|e| ScrapeError::Unknown(e.into()))?
                                    .to_string();

                                if let Ok(hash) = image_is_88x31(&src, reqwest_client, config).await
                                {
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
    } else {
        let mut queued_images: Vec<(String, String)> = Vec::new();
        {
            let response = reqwest_client.get(url).send().await?;
            let text = response.text().await?;

            let document = scraper::Html::parse_document(&text);
            let body = document.root_element();

            let selector = scraper::Selector::parse("a").unwrap();
            let links = body.select(&selector);
            for link in links {
                if let Some(href) = link.value().attr("href") {
                    if let Some(real_href) = url::Url::parse(current_url.as_str())
                        .and_then(|u| u.join(href))
                        .ok()
                        .map(|u| u.to_string())
                    {
                        let children = link.children();
                        for child in children {
                            if let Some(elem) = child.value().as_element() {
                                if let Some(src) = elem.attr("src") {
                                    let src = parsed_url
                                        .join(src)
                                        .map_err(|e| ScrapeError::Unknown(e.into()))?
                                        .to_string();

                                    queued_images.push((real_href.clone(), src));
                                }
                            }
                        }
                    }
                }
            }
        }

        for (real_href, src) in queued_images {
            if let Ok(hash) = image_is_88x31(&src, reqwest_client, config).await {
                result.push(LinkSchema {
                    to: real_href.clone(),
                    image: src,
                    image_hash: hash,
                })
            }
        }
    }

    Ok(WorkSchema {
        orig_url: url.to_string(),
        result_url: current_url.to_string(),
        success: true,
        links: Some(result),
    })
}

async fn try_work(
    client: &reqwest::Client,
    driver: &Option<WebDriver>,
    config: &Config,
) -> Result<(), ScrapeError> {
    let req = client
        .get(&format!("{}/work", config.host))
        .header("Authorization", format!("Bearer {}", config.key.clone()))
        .send()
        .await
        .map_err(|e| ScrapeError::Api(Some(e)))?;

    if !req.status().is_success() {
        return Err(ScrapeError::Api(None));
    }

    let url = req.text().await?;

    if !url.is_empty() {
        println!("Processing: {}", url);
        let result = process(driver, &url, client, config).await;
        if let Ok(work) = result {
            let work = serde_json::to_string(&work).map_err(|e| ScrapeError::Unknown(e.into()))?;
            client
                .post(&format!("{}/work", config.host))
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", config.key.clone()))
                .body(work)
                .send()
                .await
                .map_err(|e| ScrapeError::Api(Some(e)))?;
        } else {
            // Do not report webdriver errors as a failure - sometimes they crash
            if let Err(ScrapeError::WebDriver(WebDriverError::CmdError(_))) = result {
                return Err(result.err().unwrap());
            }

            client
                .post(&format!("{}/work", config.host))
                .header("Content-Type", "application/json")
                .header("Authorization", config.key.clone())
                .body(
                    serde_json::to_string(&WorkSchema {
                        orig_url: url.to_string(),
                        result_url: url.to_string(),
                        success: false,
                        links: None,
                    })
                    .map_err(|e| ScrapeError::Unknown(e.into()))?,
                )
                .send()
                .await
                .map_err(|e| ScrapeError::Api(Some(e)))?;

            return Err(result.err().unwrap());
        }
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

    let drivers = config.drivers.clone();
    let count = if drivers.is_some() {
        drivers.as_ref().unwrap().len()
    } else {
        config.tasks.unwrap_or(1)
    };

    for i in 0..count {
        let driver = if drivers.is_some() {
            let host = drivers.as_ref().unwrap()[i].clone();
            let mut caps = DesiredCapabilities::chrome();
            caps.add_chrome_arg(&format!("--user-agent={}", USER_AGENT))?;
            let driver = WebDriver::new(&host, caps).await?;
            Some(driver)
        } else {
            None
        };

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
                    if let Some(driver) = driver {
                        driver.quit().await.ok();
                    }

                    break;
                }

                if let Err(e) = try_work(&client, &driver, &config).await {
                    eprintln!("Error: {}", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
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
