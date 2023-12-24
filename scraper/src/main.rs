use manager::Manager;
use serde::Deserialize;
use std::sync::Arc;
use thirtyfour::{DesiredCapabilities, WebDriver};
use tokio::sync::Mutex;

mod manager;
mod types;
mod worker;

#[derive(Deserialize, Debug)]
pub struct Config {
    hosts: Vec<String>,
    initial_hosts: Vec<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path = std::env::args().nth(1).unwrap_or("config.json".to_string());
    let config = std::fs::read_to_string(config_path)?;
    let config: Config = serde_json::from_str(&config)?;

    let manager = Manager::new(config.initial_hosts);
    let manager = Arc::new(Mutex::new(manager));
    let mut tasks = vec![];

    for host in config.hosts {
        let mut caps = DesiredCapabilities::chrome();
        caps.add_chrome_arg(&format!("--user-agent={}", types::USER_AGENT))?;
        let driver = WebDriver::new(&host, caps).await?;
        let worker = worker::Worker::new(manager.clone(), driver);
        tasks.push(worker.run());
    }

    futures::future::join_all(tasks).await;

    Ok(())
}
