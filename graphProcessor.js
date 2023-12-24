import fs from "fs";

const inFile = "./scraper/graph.json";
const outFile = "./public/graph.json";
const graph = JSON.parse(fs.readFileSync(inFile, "utf8"));

function hostname(url, orig = undefined) {
  try {
    const u = new URL(url, orig);
    return u.hostname;
  } catch {
    return null;
  }
}

function redirect(url) {
  return Object.entries(graph.redirects).find((x) => url === x[0])?.[1] ?? url;
}

const domainLinks = new Map();
const images = new Map();

function addLink(src, dest) {
  if (!domainLinks.has(src)) {
    domainLinks.set(src, new Set());
  }

  domainLinks.get(src).add(dest);
}

function addImage(src, dest) {
  if (!images.has(src)) {
    images.set(src, []);
  } else {
    const existing = images.get(src);
    if (
      existing.some(
        (x) => x.image === dest.image || x.image_path === dest.image_path
      )
    ) {
      return;
    }
  }

  images.get(src).push(dest);
}

for (const [domain, data] of Object.entries(graph.domains)) {
  const domainHost = hostname(redirect(domain));
  for (const link of data.links) {
    const linkHostname = hostname(redirect(link.url), domain);
    if (domainHost === "" || linkHostname === "") continue;
    addLink(domainHost, linkHostname);
    addImage(linkHostname, {
      image: new URL(link.image, domain).toString(),
      image_path: link.image_path
    });
  }
}

let linkedFrom = new Map();
for (const [domain, links] of domainLinks.entries()) {
  for (const link of links) {
    if (!linkedFrom.has(link)) {
      linkedFrom.set(link, new Set());
    }

    linkedFrom.get(link).add(domain);
  }
}

const out = {
  linksTo: Object.fromEntries(
    Object.entries(Object.fromEntries(domainLinks.entries())).map(([k, v]) => [
      k,
      [...v]
    ])
  ),

  linkedFrom: Object.fromEntries(
    Object.entries(Object.fromEntries(linkedFrom.entries())).map(([k, v]) => [
      k,
      [...v]
    ])
  ),

  images: Object.fromEntries(
    Object.entries(Object.fromEntries(images.entries())).map(([k, v]) => [
      k,
      v.map((x) => x.image)
    ])
  )
};

fs.writeFileSync(outFile, JSON.stringify(out));
