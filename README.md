# eightyeightthirtyone

<div align="center">
  <img src="https://raw.githubusercontent.com/NotNite/eightyeightthirtyone/main/client/public/88x31.png"></img>
  <img src="https://namazu.photos/i/gnqd8knk.png"></img>
</div>

<hr />

Building a graph of the Internet, one button at a time. Website available [here](https://eightyeightthirty.one).

This project crawls the links between [88x31s](https://tekeye.uk/computer_history/powered-by) on the Internet, which are small badges on websites that link to other websites. It's split into three projects:

- A host server (Rust/Axum) that manages work between scraper nodes and talks to a Redis database
- A scraper (Rust) that talks to the server, fetches URLs, and returns information
- A web app (TypeScript/React) to render the graph

Websites are scanned for images, and images that match the 88x31 resolution and link to another site are logged. It respects robots.txt and is aware of redirects.

Scrapers can either run a WebDriver or just parse the HTML - note that the latter will break discovery for websites that use JavaScript to create the button elements (e.g. React apps).

## Opting out

The scrapers respect robots.txt, so block this user agent:

```text
"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 eightyeightthirtyone/1.0.0 (https://github.com/NotNite/eightyeightthirtyone)
```

Note that this only somewhat works:

- You will still appear on the graph if anyone else links to you.
- Previous entries in the database are not deleted - please email me your domain and affected URLs if known (email available [on my website](https://notnite.com)).

## Credits & contact

This project wouldn't be possible without the following people:

- [![notnite](https://notnite.com/buttons/notnite.png)](https://notnite.com/)
  - for starting the project, hosting the website and server
- [![adryd](https://adryd.com/static/buttons/adryd.png)](https://adryd.com)
  - for her help on the frontend, designing the project's 88x31, hosting a scraper node
- [![breq](https://breq.dev/badges/breq.png)](https://breq.dev/)
  - for her help designing the Redis database schema

Thanks!
