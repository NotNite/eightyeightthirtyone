use manager::Manager;
use std::sync::Arc;
use thirtyfour::{DesiredCapabilities, WebDriver};
use tokio::sync::Mutex;

mod manager;
mod types;
mod worker;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let manager = Manager::new();
    let manager = Arc::new(Mutex::new(manager));
    let mut tasks = vec![];

    for i in 0..2 {
        let port = 4444 + i;
        let mut caps = DesiredCapabilities::chrome();
        caps.add_chrome_arg(&format!("--user-agent={}", types::USER_AGENT))?;

        let driver = WebDriver::new(&format!("http://localhost:{}", port), caps).await?;
        let worker = worker::Worker::new(manager.clone(), driver);
        tasks.push(worker.run());
    }

    futures::future::join_all(tasks).await;

    Ok(())
}
