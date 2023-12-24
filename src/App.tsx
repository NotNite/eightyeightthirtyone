import { useWindowSize } from "@react-hook/window-size";
import React from "react";
import ForceGraph2D, {
  ForceGraphMethods as ForceGraphMethods2D,
  GraphData,
  LinkObject,
  NodeObject
} from "react-force-graph-2d";
import ForceGraph3D, {
  ForceGraphMethods as ForceGraphMethods3D
} from "react-force-graph-3d";

// eslint-disable-next-line @typescript-eslint/ban-types
type CustomNodeType = { id: string; name: string; val: number };
type CustomLinkType = { source: string; target: string };
type CustomGraphData = GraphData<
  NodeObject<CustomNodeType>,
  LinkObject<CustomNodeType, CustomLinkType>
>;

// Holy shit never do this ever
type GraphRef = ForceGraphMethods2D<
  NodeObject<CustomNodeType>,
  LinkObject<CustomNodeType, CustomLinkType>
> &
  ForceGraphMethods3D<
    NodeObject<CustomNodeType>,
    LinkObject<CustomNodeType, CustomLinkType>
  >;

type ScrapedGraph = {
  linksTo: Record<string, string[]>;
  linkedFrom: Record<string, string[]>;
  images: Record<string, string[]>;
};

export default function App() {
  const [origGraph, setOrigGraph] = React.useState<ScrapedGraph | undefined>(
    undefined
  );
  const [graphData, setGraphData] = React.useState<CustomGraphData | undefined>(
    undefined
  );
  const [filtered, setFiltered] = React.useState<string[]>([]);

  const graphRef = React.useRef<GraphRef>();
  const [width, height] = useWindowSize();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [separation, setSeparation] = React.useState<string[] | null>(null);
  const [three, setThree] = React.useState(false);

  React.useEffect(() => {
    async function createGraphData() {
      const graph: ScrapedGraph = await fetch(
        "/graph.json?t=" + Date.now()
      ).then((x) => x.json());
      setOrigGraph(graph);

      let domains = Object.keys(graph.linksTo)
        .concat(Object.keys(graph.linkedFrom))
        .concat(Object.keys(graph.images));
      domains = [...new Set(domains)].filter((x) => x !== "");

      const nodes: CustomNodeType[] = domains.map((domain) => ({
        id: domain,
        name: domain,
        val: 1
      }));

      const links: CustomLinkType[] = [];

      for (const [domain, targets] of Object.entries(graph.linksTo)) {
        for (const target of targets) {
          if (domain === "" || target === "") continue;
          links.push({ source: domain, target });
        }
      }

      for (const [domain, targets] of Object.entries(graph.linkedFrom)) {
        for (const target of targets) {
          if (domain === "" || target === "") continue;
          links.push({ source: target, target: domain });
        }
      }

      setGraphData({ nodes, links });
    }

    createGraphData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pan(domain: string) {
    const node = graphData?.nodes.find((x) => x.id === domain);
    if (node == null) return;

    if (three) {
      const distance = 40;
      const distRatio = 1 + distance / Math.hypot(node.x!, node.y!, node.z!);

      graphRef.current?.cameraPosition(
        {
          x: node.x! * distRatio,
          y: node.y! * distRatio,
          z: node.z! * distRatio
        },
        {
          x: node.x!,
          y: node.y!,
          z: node.z!
        },
        1000
      );
    } else {
      graphRef.current?.centerAt(node.x!, node.y!, 1000);
      graphRef.current?.zoom(8, 1000);
    }
  }

  function select(domain: string) {
    const node = graphData?.nodes.find((x) => x.id === domain);
    if (node == null) return;
    setSelected(node.id as string);
    pan(domain);
    setSeparation(null);
  }

  const color = "grey";
  const colorChooser = (link: LinkObject<CustomNodeType, CustomLinkType>) => {
    if (origGraph == null) return color;

    // @ts-expect-error cbf to type
    const source = link.source.id as string;
    // @ts-expect-error cbf to type
    const target = link.target.id as string;

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

    if (selected != null && (source === selected || target === selected)) {
      if (sourceToTarget && targetToSource) return "cyan";
      if (source === selected && sourceToTarget) return "blue";
      return "green";
    }

    if (sourceToTarget && targetToSource) return "white";

    return color;
  };

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

  const Component = three ? ForceGraph3D : ForceGraph2D;

  return (
    <>
      <Component
        graphData={graphData}
        enableNodeDrag={false}
        ref={graphRef}
        warmupTicks={60} // Simulate graph a bit before first draw
        cooldownTime={5000}
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
        nodeVisibility={(node: CustomNodeType) => {
          if (filtered.length === 0) return true;
          return filtered.includes(node.id as string);
        }}
        linkVisibility={(link: CustomLinkType) => {
          if (filtered.length === 0) return true;
          return (
            // @ts-expect-error cbf to type
            filtered.includes(link.source!.id as string) &&
            // @ts-expect-error cbf to type
            filtered.includes(link.target!.id as string)
          );
        }}
        width={width}
        height={height}
      />

      <div className="controls">
        <datalist id="domains">
          {graphData?.nodes.map((x) => (
            <option key={x.id} value={x.id} />
          ))}
        </datalist>

        <button onClick={() => setThree(!three)}>
          {three ? "Set to 2D" : "Set to 3D"}
        </button>

        <input
          type="range"
          min="0"
          max="25"
          step="1"
          defaultValue="0"
          onChange={(e) => {
            if (selected == null || graphData == null) return;
            const value = parseInt(e.currentTarget.value);

            if (value === 0) {
              setFiltered([]);
            } else {
              let domains = [selected];

              for (let i = value; i > 0; i--) {
                for (const domain of domains) {
                  domains = domains.concat(origGraph?.linksTo[domain] ?? []);
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
            if (e.key === "Enter" && graphData != null) {
              select(e.currentTarget.value);
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
            <a href={`https://${selected}`} target="_blank" rel="noreferrer">
              <h3>{selected}</h3>
            </a>

            <span>Links to:</span>
            <ul>
              {(origGraph?.linksTo[selected] ?? []).map((x, i) => (
                <li key={i}>
                  <button onClick={() => select(x)}>{x}</button>
                </li>
              ))}
            </ul>

            <span>Linked from:</span>
            <ul>
              {(origGraph?.linkedFrom[selected] ?? []).map((x, i) => (
                <li key={i}>
                  <button onClick={() => select(x)}>{x}</button>
                </li>
              ))}
            </ul>

            <span>Badges:</span>
            <ul>
              {(origGraph?.images[selected] ?? []).map((x, i) => (
                <li key={i}>
                  <img src={x} alt={x} />
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
                if (e.key === "Enter" && graphData != null) {
                  setSeparation(bfs(selected, e.currentTarget.value));
                }
              }}
            />
            {separation != null && (
              <ul>
                {separation.map((x, i) => (
                  <li key={i}>
                    <button onClick={() => select(x)}>{x}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
