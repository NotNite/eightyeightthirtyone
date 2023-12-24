use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub static USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 eightyeightthirtyone/1.0.0 (https://github.com/NotNite/eightyeightthirtyone)";

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct Link {
    pub url: String,
    pub image: String,
    pub image_path: String,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct DomainInfo {
    pub links: Vec<Link>,
}

#[derive(Deserialize, Serialize, Debug, Clone, Default)]
pub struct Graph {
    pub domains: HashMap<String, DomainInfo>,
    pub redirects: HashMap<String, String>,
    pub visited: HashMap<String, usize>,
}
