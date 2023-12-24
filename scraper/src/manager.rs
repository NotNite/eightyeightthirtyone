use crate::types::{DomainInfo, Graph};

pub struct Manager {
    pub queue: Vec<String>,
    pub graph: Graph,
}

impl Manager {
    pub fn new() -> Self {
        let mut manager = Self {
            queue: vec!["https://notnite.com/".to_string()],
            graph: Graph::default(),
        };

        manager.read().ok();
        manager.purge();

        manager
    }

    fn read(&mut self) -> anyhow::Result<()> {
        let text = std::fs::read_to_string("graph.json")?;
        self.graph = serde_json::from_str(&text)?;
        Ok(())
    }

    fn write(&self) -> anyhow::Result<()> {
        if std::fs::metadata("graph.bak.json").is_ok() {
            std::fs::remove_file("graph.bak.json")?;
        }

        if std::fs::metadata("graph.json").is_ok() {
            std::fs::rename("graph.json", "graph.bak.json")?;
        }

        let text = serde_json::to_string(&self.graph)?;
        std::fs::write("graph.json", text)?;

        Ok(())
    }

    pub fn dequeue(&mut self) -> Option<String> {
        let len = self.queue.len();
        if len > 0 {
            println!("queue: {}", len);
        }
        self.queue.pop()
    }

    pub fn mark_visited(&mut self, url: String) {
        let timestamp = chrono::Utc::now().timestamp() as usize;
        self.graph.visited.insert(url, timestamp);
        self.write().ok();
    }

    pub fn save(&mut self, real_url: String, info: DomainInfo) {
        if self.should_be_purged(real_url.clone()) {
            self.graph.domains.remove(&real_url);
            return;
        }

        for link in &info.links {
            if !self.graph.domains.contains_key(&link.url) {
                self.queue.push(link.url.clone());
            }
        }

        self.graph.domains.insert(real_url, info);
        self.write().ok();
        self.purge();
    }

    pub fn add_redirect(&mut self, from: String, to: String) {
        self.graph.redirects.insert(from, to);
        self.write().ok();
    }

    fn purge(&mut self) {
        for (url, data) in self.graph.domains.clone() {
            if self.should_be_purged(url.clone()) {
                self.graph.domains.remove(&url);
            }

            for url in data.links {
                if self.should_be_purged(url.url.clone()) {
                    self.graph.domains.remove(&url.url);
                }
            }
        }

        self.queue.dedup();
        for entry in self.queue.clone() {
            if self.graph.visited.contains_key(&entry) || self.should_be_purged(entry.clone()) {
                self.queue.retain(|x| x != &entry);
            }
        }

        self.write().ok();
    }

    fn should_be_purged(&self, url: String) -> bool {
        if url.trim().is_empty() {
            return true;
        }

        if self.graph.domains.contains_key(&url)
            && self.graph.domains[&url].links.len() == 1
            && self.graph.domains[&url].links[0].url == url
        {
            return true;
        }

        if self.graph.visited.contains_key(&url) {
            let timestamp = self.graph.visited[&url];
            let now = chrono::Utc::now().timestamp() as usize;
            let diff = now - timestamp;
            if diff > 60 * 60 * 24 * 7 {
                return true;
            }
        }

        false
    }
}
