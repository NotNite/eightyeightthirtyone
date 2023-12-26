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

export default function App() {
  const [origGraph, setOrigGraph] = React.useState<ScrapedGraph | null>(null);
  const [graph, setGraph] = React.useState<Graph | null>(null);
  const graphRef = React.useRef<CosmographRef>(null);

  const [filtered, setFiltered] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [separation, setSeparation] = React.useState<string[] | null>(null);
  const [extendedInfo, setExtendedInfo] = React.useState(false);

  React.useEffect(() => {
    async function createGraphData() {
      const origGraph: ScrapedGraph = await fetch(
        "/graph.json?t=" + Date.now()
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
    }

    createGraphData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pan(domain: string) {
    const node = graph?.nodes.find((x) => x.id === domain);
    if (node == null) return;
    graphRef.current?.fitViewByNodeIds([domain]);
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

  function select(domain: string | null, doPan: boolean) {
    setSelected(domain);
    setSeparation(null);
    if (domain != null) {
      if (doPan) pan(domain);
      doSelectFilter(domain);
    } else {
      graphRef.current?.unselectNodes();
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

  function pastel(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    return `hsl(${hash % 360}, 50%, 80%)`;
  }

  return (
    <>
      {graph != null && (
        <CosmographProvider nodes={graph.nodes} links={graph.links}>
          <Cosmograph
            nodeLabelColor="#ffffff"
            showDynamicLabels={false}
            className="graph"
            ref={graphRef}
            onClick={(e) => {
              select(e?.id ?? null, false);
            }}
            backgroundColor="#000000"
            nodeSize={1}
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

                return "white";
              }

              return pastel(node.id);
            }}
            linkColor={(link) => {
              if (
                filtered.length !== 0 &&
                !(
                  filtered.includes(link.source) &&
                  filtered.includes(link.target)
                )
              )
                return "transparent";

              const color = "#202020";
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

              if (sourceToTarget && targetToSource) return "white";

              return color;
            }}
          />

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
                  <a href="https://tekeye.uk/computer_history/powered-by">
                    88x31s
                  </a>{" "}
                  on the Internet, which are small badges on websites that link
                  to other websites.
                </p>

                <p>
                  Click on nodes to see more information. Press Space to focus
                  the node you've selected. Use the slider to filter degrees of
                  separation.
                </p>

                <p>
                  When a node is selected, the sidebar will contain information
                  about links, the node's buttons, and a pathfinder.
                </p>
              </div>
            )}

            <div className="buttonsAndStuff">
              <a href="#" onClick={() => setExtendedInfo(!extendedInfo)}>
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
                if (
                  selected == null ||
                  graph == null ||
                  graphRef.current == null ||
                  origGraph == null
                )
                  return;
                const value = parseInt(e.currentTarget.value);

                if (value === 0) {
                  setFiltered([]);
                } else {
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

            <input
              type="text"
              list="domains"
              placeholder="Search"
              onKeyDown={(e) => {
                if (e.key === "Enter" && graph != null) {
                  select(e.currentTarget.value, true);
                }
              }}
            />

            <span className="by">
              <a href="https://github.com/NotNite/eightyeightthirtyone">
                <img src="/88x31.png" alt="eightyeightthirty.one" />
              </a>
              <a href="https://notnite.com/">
                <img src="/notnite.png" alt="notnite" />
              </a>
            </span>
          </div>

          {selected != null && (
            <div className="infobox">
              <div className="infoboxInner">
                <a
                  href={`https://${selected}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <h3>{selected}</h3>
                </a>

                <span>Links to:</span>
                <ul>
                  {(origGraph?.linksTo[selected] ?? []).map((x, i) => (
                    <li key={i}>
                      <button onClick={() => select(x, true)}>{x}</button>
                    </li>
                  ))}
                </ul>

                <span>Linked from:</span>
                <ul>
                  {(origGraph?.linkedFrom[selected] ?? []).map((x, i) => (
                    <li key={i}>
                      <button onClick={() => select(x, true)}>{x}</button>
                    </li>
                  ))}
                </ul>

                <span>Badges:</span>
                <ul>
                  {(origGraph?.images[selected] ?? []).map((x, i) => (
                    <li key={i}>
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
                        <button onClick={() => select(x, true)}>{x}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </CosmographProvider>
      )}
    </>
  );
}
