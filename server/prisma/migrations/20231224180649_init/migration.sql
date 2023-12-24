-- CreateTable
CREATE TABLE "Client" (
    "apiKey" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "Page" (
    "url" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "lastScraped" DATETIME
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "srcUrl" TEXT NOT NULL,
    "dstUrl" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL,
    CONSTRAINT "Link_srcUrl_fkey" FOREIGN KEY ("srcUrl") REFERENCES "Page" ("url") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Link_dstUrl_fkey" FOREIGN KEY ("dstUrl") REFERENCES "Page" ("url") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Redirect" (
    "from" TEXT NOT NULL PRIMARY KEY,
    "to" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_apiKey_key" ON "Client"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "Page_url_key" ON "Page"("url");

-- CreateIndex
CREATE UNIQUE INDEX "Redirect_from_key" ON "Redirect"("from");
