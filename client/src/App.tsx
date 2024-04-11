import {
  Cosmograph,
  CosmographRef,
  CosmographProvider
} from "@cosmograph/react";
import React from "react";

type ScrapedGraph = {
  linksTo: Record<string, string[]>;
  linkedFrom: Record<string, string[]>;
  images: Record<string, string[]>;
};

type CustomNode = { id: string };
type CustomLink = { source: string; target: string };

type Graph = {
  nodes: CustomNode[];
  links: CustomLink[];
};

const lastScrape = new Date("2024-04-10T12:30:00.000Z").toDateString();

export default function App() {
  const [origGraph, setOrigGraph] = React.useState<ScrapedGraph | null>(null);
  const [graph, setGraph] = React.useState<Graph | null>(null);
  const [webglSupported, setWebglSupported] = React.useState<boolean | null>(
    null
  );
  const graphRef = React.useRef<CosmographRef>(null);

  const [filtered, setFiltered] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [separation, setSeparation] = React.useState<string[] | null>(null);
  const [extendedInfo, setExtendedInfo] = React.useState(false);
  const [lightMode, setLightMode] = React.useState(
    window.matchMedia("(prefers-color-scheme: light)").matches
  );

  React.useEffect(() => {
    async function createGraphData() {
      const origGraph: ScrapedGraph = await fetch(
        "https://eightyeightthirty.one/graph.json?t=" + Date.now()
      ).then((x) => x.json());
      setOrigGraph(origGraph);

      let domains = Object.keys(origGraph.linksTo)
        .concat(Object.keys(origGraph.linkedFrom))
        .concat(Object.keys(origGraph.images));
      domains = [...new Set(domains)].filter((x) => x !== "");

      const nodes: Graph["nodes"] = domains.map((x) => ({
        id: x
      }));
      const links: Graph["links"] = [];

      for (const [domain, targets] of Object.entries(origGraph.linksTo)) {
        for (const target of targets) {
          if (domain === "" || target === "") continue;
          links.push({ source: domain, target });
        }
      }

      for (const [domain, targets] of Object.entries(origGraph.linkedFrom)) {
        for (const target of targets) {
          if (domain === "" || target === "") continue;
          links.push({ source: target, target: domain });
        }
      }

      setGraph({ nodes, links });
      if (window.location.hash) {
        select(window.location.hash.slice(1), true, false);
      }

      window.addEventListener("hashchange", (ev) => {
        ev.preventDefault();
        select(window.location.hash.slice(1), true, false);
      });
    }

    let webglSupported = false;

    // Detect if webgl is supported
    try {
      const canvas = document.createElement("canvas");
      webglSupported =
        !!window.WebGLRenderingContext &&
        (canvas.getContext("webgl") != null ||
          canvas.getContext("experimental-webgl") != null);
    } catch (e) {
      // noop
    }
    setWebglSupported(webglSupported);

    // For some reason if the graph fails to create, it nukes all react elements
    if (webglSupported) createGraphData();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pan(domain: string) {
    const node = graph?.nodes.find((x) => x.id === domain);
    if (node == null) return;
    graphRef.current?.zoomToNode(node);
  }

  function doSelectFilter(domain: string) {
    if (origGraph == null || graphRef.current == null) return;
    let filter = [domain];
    filter = filter.concat(origGraph.linksTo[domain] ?? []);
    filter = filter.concat(origGraph.linkedFrom[domain] ?? []);
    filter = filter.concat(separation ?? []);
    filter = [...new Set(filter)];
    graphRef.current?.selectNodes(filter.map((x) => ({ id: x })));
  }

  function select(domain: string | null, doPan?: boolean, doHash?: boolean) {
    setSeparation(null);
    if (domain != null && domain.length > 4) {
      setSelected(domain);
      if (doPan) pan(domain);
      if (doHash) window.location.hash = domain;
      doSelectFilter(domain);
    } else {
      if (doHash) window.location.hash = "";
      graphRef.current?.unselectNodes();
      setSelected(null);
    }
  }

  function bfs(from: string, to: string) {
    const visited = new Set<string>();
    const queue = [[from]];

    while (queue.length) {
      const path = queue.shift()!;
      const node = path[path.length - 1];

      if (node === to) return path;

      if (!visited.has(node)) {
        visited.add(node);
        for (const next of origGraph!.linksTo[node] ?? []) {
          queue.push([...path, next]);
        }
      }
    }

    return null;
  }

  React.useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key === " " && selected != null) pan(selected);
    };

    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  React.useEffect(() => {
    window
      .matchMedia("(prefers-color-scheme: light)")
      .addEventListener("change", ({ matches: isLight }) => {
        setLightMode(!isLight);
      });
  }, [lightMode]);

  function pastel(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    return `hsl(${hash % 360}, 50%, 80%)`;
  }

  if (webglSupported === false) {
    return (
      <div>
        WebGL is required to use this site, and it is unsupported or disabled in
        your browser. See{" "}
        <a href="http://get.webgl.org">http://get.webgl.org</a> for more
        information.
      </div>
    );
  }

  if (graph == null) {
    return (
      <div className="loadingScreen">
        <h2>Loading... Please wait!</h2>
      </div>
    );
  }

  return (
    <CosmographProvider nodes={graph.nodes} links={graph.links}>
      <div>
        <Cosmograph
          nodeLabelColor="#000000"
          showDynamicLabels={false}
          className="graph"
          ref={graphRef}
          onClick={(e) => {
            select(e?.id ?? null, false, true);
          }}
          backgroundColor={lightMode ? "#fcfcfc" : "#000000"}
          nodeSize={(node) => {
            if (filtered.length !== 0 && !filtered.includes(node.id)) return 0;

            return 1;
          }}
          linkWidth={2}
          linkArrowsSizeScale={2}
          linkGreyoutOpacity={0.25}
          nodeGreyoutOpacity={0.25}
          nodeColor={(node) => {
            if (filtered.length !== 0 && !filtered.includes(node.id))
              return "transparent";
            if (origGraph == null) return pastel(node.id);

            if (separation != null && separation.includes(node.id))
              return "red";

            const linksTo = origGraph.linksTo[node.id] ?? [];
            const linkedFrom = origGraph.linkedFrom[node.id] ?? [];
            if (selected != null) {
              if (node.id === selected) return "red";
              if (linksTo.includes(selected) && linkedFrom.includes(selected))
                return "cyan";
              if (linksTo.includes(selected)) return "green";
              if (linkedFrom.includes(selected)) return "blue";

              return lightMode ? "black" : "white";
            }

            return pastel(node.id);
          }}
          linkColor={(link) => {
            if (
              filtered.length !== 0 &&
              !(
                filtered.includes(link.source) && filtered.includes(link.target)
              )
            )
              return "transparent";

            const color = lightMode ? "#bfbfbf" : "#202020";
            if (origGraph == null) return color;

            const source = link.source;
            const target = link.target;

            if (
              separation != null &&
              separation.includes(source) &&
              separation.indexOf(source) === separation.indexOf(target) - 1
            )
              return "red";

            const isLinkedTo = (source: string, target: string) =>
              origGraph.linksTo[source]?.includes(target);
            const sourceToTarget = isLinkedTo(source, target);
            const targetToSource = isLinkedTo(target, source);

            if (
              selected != null &&
              (source === selected || target === selected)
            ) {
              if (sourceToTarget && targetToSource) return "cyan";
              if (source === selected && sourceToTarget) return "blue";
              return "green";
            }

            if (sourceToTarget && targetToSource)
              return lightMode ? "#444444" : "white";

            return color;
          }}
        />
      </div>

      <div className="controls">
        <datalist id="domains">
          {graph.nodes.map((x) => (
            <option key={x.id} value={x.id} />
          ))}
        </datalist>

        {extendedInfo && (
          <div className="about">
            <p>
              This site crawls the links between{" "}
              <a href="https://tekeye.uk/computer_history/powered-by">88x31s</a>{" "}
              on the Internet, which are small badges on websites that link to
              other websites.
            </p>

            <p>
              Click on nodes to see more information. Press Space to focus the
              node you've selected. Use the slider to filter degrees of
              separation.
            </p>

            <p>
              When a node is selected, the sidebar will contain information
              about links, the node's buttons, and a pathfinder.
            </p>

            <p>
              The last scrape was {lastScrape}
            </p>
          </div>
        )}

        <div className="buttonsAndStuff">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setExtendedInfo(!extendedInfo);
            }}
          >
            What is this?
          </a>
        </div>

        <input
          type="range"
          min="0"
          max="10"
          step="1"
          defaultValue="0"
          onChange={(e) => {
            const value = parseInt(e.currentTarget.value);

            if (value === 0) {
              setFiltered([]);
            } else {
              if (
                selected == null ||
                graph == null ||
                graphRef.current == null ||
                origGraph == null
              )
                return;

              let domains = [selected];

              for (let i = value; i > 0; i--) {
                for (const domain of domains) {
                  domains = domains.concat(origGraph.linksTo[domain] ?? []);
                }

                domains = [...new Set(domains)];
              }

              setFiltered(domains);
            }
          }}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const searchTerm = (e.target as HTMLFormElement).elements.namedItem(
              "searchTerm"
            ) as HTMLInputElement;
            if (graph != null) {
              select(searchTerm.value, true, true);
            }
          }}
          className="searchInput"
        >
          <input
            type="text"
            id="searchTerm"
            list="domains"
            placeholder="Search"
          />
          <button type="submit">Go!</button>
        </form>

        <button
          onClick={() => {
            graphRef.current?.fitView();
          }}
        >
          Reset View
        </button>

        <span className="by">
          <a
            href="https://github.com/NotNite/eightyeightthirtyone"
            className="hasBadge"
          >
            <img src="/88x31.png" alt="eightyeightthirty.one" />
          </a>
          <a href="https://notnite.com/" className="hasBadge">
            <img src="/notnite.png" alt="notnite" />
          </a>
        </span>
      </div>

      {selected != null && (
        <div className="infobox">
          <div className="infoboxInner">
            <a href={`https://${selected}`} target="_blank" rel="noreferrer">
              <h3>{selected}</h3>
            </a>

            <button
              className="clipboardButton"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
              }}
            >
              Copy node link to clipboard
            </button>
            <br />
            <br />

            <span>Links to:</span>
            <ul>
              {(origGraph?.linksTo[selected] ?? []).map((x, i) => (
                <li key={i}>
                  <button onClick={() => select(x, true, true)}>{x}</button>
                </li>
              ))}
            </ul>

            <span>Linked from:</span>
            <ul>
              {(origGraph?.linkedFrom[selected] ?? []).map((x, i) => (
                <li key={i}>
                  <button onClick={() => select(x, true, true)}>{x}</button>
                </li>
              ))}
            </ul>

            <span>Badges:</span>
            <ul className="badgesList">
              {(origGraph?.images[selected] ?? []).map((x, i) => (
                <li key={i} className="hasBadge">
                  <img
                    src={`${
                      import.meta.env.VITE_BADGES_HOST ??
                      "https://highway.eightyeightthirty.one"
                    }/badge/${x}`}
                    alt={x}
                  />
                </li>
              ))}
            </ul>

            <span>Separation:</span>
            <br />
            <input
              type="text"
              list="domains"
              placeholder="Search"
              onKeyDown={(e) => {
                if (e.key === "Enter" && graph != null) {
                  setSeparation(bfs(selected, e.currentTarget.value));
                  if (graphRef.current != null) {
                    graphRef.current.selectNodes([]);
                  }
                }
              }}
            />
            {separation != null && (
              <ul>
                {separation.map((x, i) => (
                  <li key={i}>
                    <button onClick={() => select(x, true, true)}>{x}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </CosmographProvider>
  );
}
