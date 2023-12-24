import Koa from "koa";
import Router from "@koa/router";
import { bodyParser } from "@koa/bodyparser";
import { PrismaClient } from "@prisma/client";
import { v4 } from "uuid";
import z from "zod";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      ADMIN_KEY: string;
    }
  }
}

const app = new Koa();
const router = new Router();
const db = new PrismaClient();
let queue = ["https://notnite.com/"];

await fillQueue();
await pruneQueue();

function validateUrl(url: string) {
  try {
    new URL(url);
  } catch (e) {
    return false;
  }

  return true;
}

function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

async function fillQueue() {
  const links = await db.link.findMany({
    where: {
      dst: {
        OR: [
          {
            lastScraped: {
              lt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7)
            }
          },
          {
            lastScraped: null
          }
        ]
      },

      dstUrl: {
        notIn: queue
      }
    }
  });

  for (const link of links) {
    if (!queue.includes(link.dstUrl)) {
      queue.push(link.dstUrl);
    }
  }
}

async function pruneQueue() {
  const blacklistedHosts = ["www.youtube.com", "youtube.com"];

  for (const url of [...queue]) {
    // No invalid URLs
    if (!validateUrl(url)) {
      queue.splice(queue.indexOf(url), 1);
      continue;
    }

    const page = await db.page.findUnique({
      where: {
        url
      }
    });

    // Only allow scraping if we haven't scraped this page in the last week
    if (page != null && page.lastScraped != null) {
      const diff = Date.now() - page.lastScraped.getTime();
      if (diff < 1000 * 60 * 60 * 24 * 7) {
        queue.splice(queue.indexOf(url), 1);
      }
    }

    const host = hostname(url);
    if (blacklistedHosts.some((x) => host?.endsWith(x))) {
      queue.splice(queue.indexOf(url), 1);
    }
  }

  queue = Array.from(new Set(queue));
}

router.post("/create_account", async (ctx) => {
  if (ctx.request.header.authorization !== process.env.ADMIN_KEY) {
    ctx.status = 401;
    return;
  }

  const client = await db.client.create({
    data: {
      apiKey: v4()
    }
  });
  ctx.body = client.apiKey;
});

router.get("/work", async (ctx) => {
  const client = await db.client.findUnique({
    where: {
      apiKey: ctx.request.header.authorization
    }
  });
  if (client == null) {
    ctx.status = 401;
    return;
  }

  await pruneQueue();
  ctx.body = queue.pop();
  console.log("Queue length:", queue.length);
});

const LinkSchema = z.object({
  to: z.string(),
  image: z.string(),
  image_hash: z.string()
});

const WorkSchema = z.object({
  orig_url: z.string(),
  result_url: z.string(), // for redirects
  links: z.array(LinkSchema)
});

router.post("/work", async (ctx) => {
  const client = await db.client.findUnique({
    where: {
      apiKey: ctx.request.header.authorization
    }
  });
  if (client == null) {
    ctx.status = 401;
    return;
  }

  const data = WorkSchema.parse(ctx.request.body);
  if (data.orig_url !== data.result_url) {
    await db.redirect.upsert({
      create: {
        from: data.orig_url,
        to: data.result_url
      },
      update: {
        to: data.result_url
      },
      where: {
        from: data.orig_url
      }
    });
  }

  const host = hostname(data.result_url);
  if (host == null) {
    ctx.status = 400;
    return;
  }

  await db.page.upsert({
    create: {
      url: data.result_url,
      domain: host,
      lastScraped: new Date()
    },
    update: {
      lastScraped: new Date()
    },
    where: {
      url: data.result_url
    }
  });

  for (const link of data.links) {
    if (!validateUrl(link.to)) continue;

    const redirect = await db.redirect.findUnique({
      where: {
        from: link.to
      }
    });

    const url = redirect == null ? link.to : redirect.to;
    if (!validateUrl(url)) continue;
    const pageHost = hostname(url);
    if (pageHost == null) continue;

    const page = await db.page.findUnique({
      where: {
        url
      }
    });
    if (!page) {
      await db.page.create({
        data: {
          url,
          domain: pageHost
        }
      });
    }

    const dbLink = await db.link.findFirst({
      where: {
        srcUrl: data.result_url,
        dstUrl: link.to,
        imageUrl: link.image
      }
    });

    if (dbLink == null) {
      await db.link.create({
        data: {
          srcUrl: data.result_url,
          dstUrl: link.to,
          imageUrl: link.image,
          imageHash: link.image_hash
        }
      });
    } else {
      await db.link.update({
        where: {
          id: dbLink.id
        },
        data: {
          srcUrl: data.result_url,
          dstUrl: link.to,
          imageUrl: link.image
        }
      });
    }

    if (!queue.includes(link.to)) {
      queue.push(link.to);
    }
  }

  await pruneQueue();
  ctx.status = 204;
  console.log("Processed:", data.result_url);
});

router.get("/graph", async (ctx) => {
  if (ctx.request.header.authorization !== process.env.ADMIN_KEY) {
    ctx.status = 401;
    return;
  }

  const pages = await db.page.findMany({});

  const linksTo: Record<string, string[]> = {};
  const linkedFrom: Record<string, string[]> = {};
  const images: Record<string, { url: string; hash: string }[]> = {};

  for (const page of pages) {
    const links = await db.link.findMany({
      where: {
        srcUrl: page.url
      }
    });

    const redirect = await db.redirect.findUnique({
      where: {
        from: page.url
      }
    });
    const url = redirect == null ? page.url : redirect.to;
    const host = hostname(url);
    if (host == null) continue;
    linksTo[host] = linksTo[host] ?? [];

    for (const link of links) {
      const redirect = await db.redirect.findUnique({
        where: {
          from: link.dstUrl
        }
      });
      const dstUrl = redirect == null ? link.dstUrl : redirect.to;
      const dstHost = hostname(dstUrl);
      if (dstHost == null) continue;

      linksTo[host].push(dstHost);
      if (linkedFrom[dstHost] == null) linkedFrom[dstHost] = [];
      linkedFrom[dstHost].push(host);

      images[dstHost] = images[dstHost] ?? [];
      if (!images[dstHost].some((i) => i.hash === link.imageHash)) {
        images[dstHost].push({
          url: link.imageUrl,
          hash: link.imageHash
        });
      }
    }

    const properImages = Object.entries(images).map(([host, images]) => {
      return {
        host,
        images: images.map((x) => x.url)
      };
    });

    ctx.body = {
      linksTo,
      linkedFrom,
      images: properImages
    };
  }
});

app.use(bodyParser()).use(router.routes()).use(router.allowedMethods());
app.listen(3000);
console.log(":thumbsup:");

export {};
