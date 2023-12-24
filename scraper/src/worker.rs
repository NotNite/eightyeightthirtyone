use crate::{
    manager::Manager,
    types::{DomainInfo, Link, USER_AGENT},
};
use sha2::Digest;
use std::sync::Arc;
use texting_robots::{get_robots_url, Robot};
use thirtyfour::{fantoccini::wd::Locator, By, WebDriver, WebElement};
use tokio::sync::Mutex;

pub struct Worker {
    manager: Arc<Mutex<Manager>>,
    driver: WebDriver,
    id: String,
    shutdown_rx: flume::Receiver<()>,
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

async fn image_is_88x31(url: &str) -> anyhow::Result<String> {
    let response = reqwest::get(url).await?;
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

    let file_extension_idx = url.rfind('.').unwrap_or_default();
    let file_extension = &url[file_extension_idx..];

    let hash = format!("{:x}", sha2::Sha256::digest(&bytes));
    std::fs::create_dir_all("images")?;
    let path = format!("images/{}{}", hash, file_extension);
    std::fs::write(&path, bytes)?;

    Ok(path)
}

async fn check_robots_txt(url: &str) -> anyhow::Result<bool> {
    let robot_url = get_robots_url(url)?;
    let response = reqwest::get(robot_url).await?;
    let text = response.text().await?;
    let robots = Robot::new(USER_AGENT, text.as_bytes())?;
    Ok(robots.allowed(url))
}

async fn process(driver: &WebDriver, url: &str) -> anyhow::Result<(String, DomainInfo)> {
    if !check_robots_txt(url).await.unwrap_or_default() {
        anyhow::bail!("robots.txt disallowed");
    }

    let parsed_url = url::Url::parse(url)?;

    driver.goto(url).await?;
    let body = driver.active_element().await?;

    let links = body.find_all(By::Tag("a")).await?;
    let mut result = Vec::new();
    for link in links {
        if let Some(href) = link.attr("href").await? {
            let children = recursive_children(&link).await?;
            for child in children {
                if child.tag_name().await? == "img" {
                    if let Some(src) = child.attr("src").await? {
                        let src = parsed_url.join(&src)?.to_string();

                        if let Ok(path) = image_is_88x31(&src).await {
                            result.push(Link {
                                url: href.clone(),
                                image: src,
                                image_path: path,
                            })
                        }
                    }
                }
            }
        }
    }

    let url = driver.current_url().await?;
    Ok((url.to_string(), DomainInfo { links: result }))
}

impl Worker {
    pub fn new(
        manager: Arc<Mutex<Manager>>,
        driver: WebDriver,
        id: String,
        shutdown_rx: flume::Receiver<()>,
    ) -> Self {
        Self {
            manager,
            driver,
            id,
            shutdown_rx,
        }
    }

    pub fn run(&self) -> tokio::task::JoinHandle<()> {
        let manager = self.manager.clone();
        let driver = self.driver.clone();
        let id = self.id.clone();
        let shutdown_rx = self.shutdown_rx.clone();

        tokio::spawn(async move {
            loop {
                if shutdown_rx.try_recv().is_ok() {
                    driver.quit().await.ok();
                    break;
                }

                let url = {
                    let mut manager = manager.lock().await;
                    manager.dequeue()
                };

                if let Some(url) = url {
                    println!("[{}] processing: {}", id, url);
                    if let Ok((real_url, data)) = process(&driver, &url).await {
                        let mut manager = manager.lock().await;
                        if url != real_url {
                            manager.add_redirect(url.clone(), real_url.clone());
                        }

                        manager.mark_visited(url.clone());
                        manager.mark_visited(real_url.clone());
                        manager.save(real_url, data);
                    }
                } else {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }
            }
        })
    }
}
