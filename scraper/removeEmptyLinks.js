import fs from "fs";
const graph = JSON.parse(fs.readFileSync("graph.json", "utf8"));

for (const domain in graph.domains) {
  if (graph.domains[domain].links.length === 0) {
    delete graph.domains[domain];
    delete graph.visited[domain];
  }
}

fs.writeFileSync("graph.json", JSON.stringify(graph));
