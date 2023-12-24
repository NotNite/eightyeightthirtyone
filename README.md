# eightyeightthirtyone

![](https://namazu.photos/i/gnqd8knk.png)

Building a graph of the Internet, one button at a time. Website available [here](https://eightyeightthirty.one).

This is split into three programs:

- a host server that manages domains to scrape
- a scraper that talks to WebDrivers to report to the host server
- a React app to render the graph

Websites are scanned for images, and images that match the 88x31 resolution and link to another site are logged. It respects robots.txt and is aware of redirects.
