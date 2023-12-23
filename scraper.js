import puppeteer from "puppeteer";
import fs from "fs";

const startUrl = new URL("https://notnite.com/");

const blacklisted = [
  "web.archive.org",
  "discord.gg",
  "discord.com",
  "discordapp.com"
];

function shouldBePurged(graph, domain) {
  if (domain.trim() === "") return true;
  if (blacklisted.some((x) => domain.endsWith(x))) return true;
  if (domain.startsWith("www.") && graph[domain.replace("www.", "")] != null)
    return true;
  if (graph[domain]?.length === 1 && graph[domain][0] === domain) return true;
  return false;
}

function cleanGraph(graph) {
  const newGraph = {};

  for (const [key, value] of Object.entries(graph)) {
    if (shouldBePurged(graph, key)) continue;
    newGraph[key] = Array.from(new Set(value)).filter(
      (x) => x != null && !shouldBePurged(graph, x)
    );
  }

  return newGraph;
}

function readGraph() {
  if (!fs.existsSync("./graph.json")) return {};
  return JSON.parse(fs.readFileSync("./graph.json", "utf8"));
}

function write(data) {
  // We don't need SQLite where we're going
  if (fs.existsSync("graph.bak.json")) {
    fs.rmSync("graph.bak.json");
  }

  if (fs.existsSync("graph.json")) {
    fs.renameSync("graph.json", "graph.bak.json");
  }

  fs.writeFileSync("graph.json", JSON.stringify(data, null, 2));
}

function alreadyVisited(graph, host) {
  return Object.keys(graph).find((x) => x === host) != null;
}

let graph = readGraph();
graph = cleanGraph(graph);
const queue = [];

if (!alreadyVisited(graph, startUrl.host)) queue.push(startUrl.toString());
const notVisited = Object.values(graph)
  .flat()
  .filter((x) => x != null && x.trim() !== "" && !alreadyVisited(graph, x))
  .map((x) => `https://${x}/`);
console.log("Not visited", notVisited.length);
queue.push(...notVisited);

const browser = await puppeteer.launch({ headless: false });
const page = await browser.newPage();

const ua = await browser.userAgent();
page.setUserAgent(
  `${ua} eightyeightthirtyone/1.0.0 (https://github.com/NotNite/eightyeightthirtyone)`
);
while (queue.length > 0) {
  console.log("Queue length", queue.length);
  const url = queue.shift();
  const uri = new URL(url);
  if (alreadyVisited(graph, uri.host)) continue;
  console.log("Visiting", uri.host);

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 10000 });
    const links = await page.evaluate(() => {
      function recursiveChildren(el) {
        const children = Array.from(el.childNodes);
        if (children.length === 0) return [el];
        return children.map((x) => recursiveChildren(x)).flat();
      }

      const links = Array.from(document.querySelectorAll("a"));
      const linksChildren = links.map((x) => [x, recursiveChildren(x)]);
      const buttons = [];

      const variance = 2;
      const width = 88;
      const height = 31;
      for (const [link, children] of linksChildren) {
        const images = children.filter(
          (x) =>
            x.tagName === "IMG" &&
            x.width <= width + variance &&
            x.width >= width - variance &&
            x.height <= height + variance &&
            x.height >= height - variance
        );
        if (images.length > 0) {
          buttons.push(link.href);
        }
      }

      return buttons.filter((x) => x != null && x.trim() !== "");
    });

    const oldLinks = graph[url] || [];
    const newLinks = [...oldLinks, ...links].map((x) => new URL(x).host);
    graph[uri.host] = Array.from(new Set(newLinks));
    write(graph);

    for (const link of links) {
      const url = new URL(link);
      if (url.host.trim() === "") continue;
      if (!alreadyVisited(graph, url.host)) {
        queue.push(`https://` + url.host + url.pathname);
      }
    }
  } catch (e) {
    console.error(e);
    // Remove the host from the graph
    delete graph[uri.host];
    graph = Object.fromEntries(
      Object.entries(graph).map(([key, value]) => [
        key,
        value.filter((x) => x !== uri.host)
      ])
    );
    write(graph);
  }
}
