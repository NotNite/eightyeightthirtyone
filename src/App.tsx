import { useWindowSize } from "@react-hook/window-size";
import React from "react";
import ForceGraph, {
  ForceGraphMethods,
  GraphData,
  LinkObject,
  NodeObject
} from "react-force-graph-2d";

/* eslint-disable @typescript-eslint/ban-types */
type CustomNodeType = {};
type CustomLinkType = {};
type CustomGraphData = GraphData<
  NodeObject<CustomNodeType>,
  LinkObject<CustomNodeType, CustomLinkType>
>;
type GraphRef = ForceGraphMethods<
  NodeObject<CustomNodeType>,
  LinkObject<CustomNodeType, CustomLinkType>
>;

type Link = {
  url: string;
  image: string;
  image_path: string;
};

type DomainInfo = {
  links: Link[];
};

type ScrapedGraph = {
  domains: Record<string, DomainInfo>;
  redirects: Record<string, string>;
  visited: Record<string, number>;
};

function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export default function App() {
  const [origGraph, setOrigGraph] = React.useState<ScrapedGraph | undefined>(
    undefined
  );
  const [redirects, setRedirects] = React.useState<
    Map<string, string> | undefined
  >(undefined);
  const [graphData, setGraphData] = React.useState<CustomGraphData | undefined>(
    undefined
  );

  const graphRef = React.useRef<GraphRef>();
  const [width, height] = useWindowSize();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [linkedFrom, setLinkedFrom] = React.useState<string[]>([]);
  const [linksTo, setLinksTo] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (origGraph != null && selected != null && redirects != null) {
      let linkedTo: string[] = [];
      for (const [domain, data] of Object.entries(origGraph.domains)) {
        if (hostname(domain) === selected) {
          linkedTo = linkedTo.concat(data.links.map((x) => hostname(x.url)));
        }
      }
      setLinksTo(
        Array.from(new Set(linkedTo)).map((x) => redirects.get(x) ?? x)
      );

      const redirectsToSelected = Object.entries(origGraph.redirects)
        .filter((x) => hostname(x[1]) === selected)
        .map((x) => hostname(x[0]));

      const linkedFrom: string[] = [];

      for (const [domain, data] of Object.entries(origGraph.domains)) {
        const realDomain = redirects.get(hostname(domain)) ?? hostname(domain);
        for (const link of data.links) {
          const realLink = hostname(link.url);
          if (realLink === selected || redirectsToSelected.includes(realLink)) {
            linkedFrom.push(realDomain);
          }
        }
      }
      setLinkedFrom(Array.from(new Set(linkedFrom)));
    }
  }, [origGraph, selected, redirects]);

  React.useEffect(() => {
    async function createGraphData() {
      const graph: ScrapedGraph = await fetch("/graph.json").then((x) =>
        x.json()
      );
      setOrigGraph(graph);

      const redirects = new Map<string, string>();
      for (const [oldUrl, newUrl] of Object.entries(graph.redirects)) {
        redirects.set(hostname(oldUrl), hostname(newUrl));
      }
      setRedirects(redirects);

      let domains = Object.keys(graph.domains);
      domains = domains
        .concat(
          Object.values(graph.domains)
            .map((x) => x.links)
            .flat()
            .map((x) => x.url)
        )
        .map(hostname)
        .map((x) => redirects.get(x) ?? x);
      domains = [...new Set(domains)].filter((x) => x !== "");

      const nodes: CustomNodeType[] = domains.map((domain) => ({
        id: domain,
        name: domain,
        val: 1
      }));
      const links: CustomLinkType[] = Object.entries(graph.domains)
        .map(
          ([source, targets]) =>
            targets.links
              .map((target) => {
                const sourceHostname = hostname(source);
                let targetHostname = hostname(target.url);
                targetHostname =
                  redirects.get(targetHostname) ?? targetHostname;
                if (sourceHostname === "" || targetHostname === "") return null;
                return {
                  source: sourceHostname,
                  target: targetHostname
                };
              })
              .filter((x) => x != null) as CustomLinkType[]
        )
        .flat();
      setGraphData({ nodes, links });
    }

    createGraphData();
  }, []);

  function select(domain: string) {
    const node = graphData?.nodes.find((x) => x.id === domain);
    if (node == null) return;
    setSelected(node.id as string);
    graphRef.current?.centerAt(node.x!, node.y!, 1000);
    graphRef.current?.zoom(8, 1000);
  }

  const color = "grey";
  const colorChooser = (link: LinkObject<CustomNodeType, CustomLinkType>) => {
    if (origGraph == null) return color;

    // @ts-expect-error cbf to type
    const source = link.source.id as string;
    // @ts-expect-error cbf to type
    const target = link.target.id as string;

    if (selected != null && source === selected) return "aqua";
    if (selected != null && target === selected) return "blue";

    const isLinkedTo = (source: string, target: string) =>
      origGraph.domains[source]?.links.find(
        (x) =>
          hostname(x.url) === target ||
          redirects?.get(hostname(x.url)) === target
      ) != null;

    const sourceToTarget = isLinkedTo(source, target);
    const targetToSource = isLinkedTo(target, source);
    if (sourceToTarget && targetToSource) return "white";
    return color;
  };

  return (
    <>
      <ForceGraph
        graphData={graphData}
        enableNodeDrag={false}
        ref={graphRef}
        nodeAutoColorBy="id"
        linkHoverPrecision={30}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        backgroundColor="#000000"
        linkColor={colorChooser}
        linkDirectionalArrowColor={colorChooser}
        onNodeClick={(node) => {
          setSelected(node.id as string);
        }}
        onBackgroundClick={() => {
          setSelected(null);
        }}
        width={width}
        height={height}
      />

      <div className="controls">
        <input
          type="text"
          placeholder="Search"
          onKeyDown={(e) => {
            if (e.key === "Enter" && graphData != null) {
              select(e.currentTarget.value);
            }
          }}
        />
        <span className="by">
          A{" "}
          <a href="https://github.com/NotNite/eightyeightthirtyone">project</a>{" "}
          by{" "}
          <a href="https://notnite.com/">
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

            <span>Links to:</span>
            <ul>
              {linksTo.map((x, i) => (
                <li key={i}>
                  <button onClick={() => select(x)}>{x}</button>
                </li>
              ))}
            </ul>

            <span>Linked from:</span>
            <ul>
              {linkedFrom.map((x, i) => (
                <li key={i}>
                  <button onClick={() => select(x)}>{x}</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
